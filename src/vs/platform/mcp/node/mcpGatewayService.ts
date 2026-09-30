/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { DeferredPromise } from '../../../base/common/async.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogger, ILoggerService } from '../../log/common/log.js';
import { IMcpGatewayInfo, IMcpGatewayServerDescriptor, IMcpGatewayServerInfo, IMcpGatewayService, IMcpGatewaySingleServerInvoker, IMcpGatewayToolInvoker } from '../common/mcpGateway.js';
import { McpGatewayRoute } from './mcpGatewayRoute.js';

/**
 * Node.js implementation of the MCP Gateway Service.
 *
 * Creates and manages an HTTP server on localhost that provides MCP gateway endpoints.
 * The server is shared among all gateways and uses ref-counting for lifecycle management.
 */
export class McpGatewayService extends Disposable implements IMcpGatewayService {
	declare readonly _serviceBrand: undefined;

	private _server: http.Server | undefined;
	private _port: number | undefined;
	/** All active routes keyed by their route UUID */
	private readonly _routes = new Map<string, McpGatewayRoute>();
	/** Maps gatewayId → set of route UUIDs belonging to that gateway */
	private readonly _gatewayRoutes = new Map<string, Set<string>>();
	/** Maps gatewayId → serverId → routeId for reverse lookup */
	private readonly _gatewayServerRoutes = new Map<string, Map<string, string>>();
	/** Maps gatewayId to clientId for tracking ownership */
	private readonly _gatewayToClient = new Map<string, unknown>();
	/** Per-gateway disposables (e.g. event listeners) */
	private readonly _gatewayDisposables = new Map<string, DisposableStore>();
	private _serverStartPromise: Promise<void> | undefined;
	private _cancelServerStart: (() => void) | undefined;
	private readonly _pendingGatewayCreates = new Set<{ clientId: unknown; canceled: boolean }>();
	private readonly _logger: ILogger;

	constructor(
		@ILoggerService loggerService: ILoggerService,
	) {
		super();
		this._logger = this._register(loggerService.createLogger('mcpGateway', { name: 'MCP Gateway', logLevel: 'always' }));
		this._logger.info('[McpGatewayService] Initialized');
	}

	async createGateway(clientId: unknown, toolInvoker?: IMcpGatewayToolInvoker): Promise<IMcpGatewayInfo> {
		const pending = { clientId, canceled: false };
		this._pendingGatewayCreates.add(pending);
		try {
			// Do not publish a gateway if its owner disconnects during server startup.
			await this._ensureServer();
			this._throwIfDisposed();
			if (pending.canceled) {
				if (this._routes.size === 0 && this._pendingGatewayCreates.size === 1) {
					this._stopServer();
				}
				throw new Error('[McpGatewayService] Client disconnected during gateway creation');
			}
			return this._createGateway(clientId, toolInvoker);
		} finally {
			this._pendingGatewayCreates.delete(pending);
		}
	}

	private _createGateway(clientId: unknown, toolInvoker?: IMcpGatewayToolInvoker): IMcpGatewayInfo {
		if (this._port === undefined) {
			throw new Error('[McpGatewayService] Server failed to start, port is undefined');
		}

		if (!toolInvoker) {
			throw new Error('[McpGatewayService] Tool invoker is required to create gateway');
		}

		const gatewayId = generateUuid();
		const routeIds = new Set<string>();
		const serverRouteMap = new Map<string, string>();
		this._gatewayRoutes.set(gatewayId, routeIds);
		this._gatewayServerRoutes.set(gatewayId, serverRouteMap);

		const disposables = new DisposableStore();
		this._gatewayDisposables.set(gatewayId, disposables);

		try {
			// Create initial server routes
			const serverDescriptors = toolInvoker.listServers();
			const servers: IMcpGatewayServerInfo[] = [];
			for (const descriptor of serverDescriptors) {
				const serverInfo = this._createRouteForServer(gatewayId, descriptor.id, descriptor.label, toolInvoker, routeIds, serverRouteMap);
				servers.push(serverInfo);
			}

			// Track client ownership
			if (clientId) {
				this._gatewayToClient.set(gatewayId, clientId);
				this._logger.info(`[McpGatewayService] Created gateway ${gatewayId} with ${servers.length} server(s) for client ${clientId}`);
			} else {
				this._logger.warn(`[McpGatewayService] Created gateway ${gatewayId} with ${servers.length} server(s) without client tracking`);
			}

			// Listen for server changes to dynamically add/remove routes
			const onDidChangeServers = disposables.add(new Emitter<readonly IMcpGatewayServerInfo[]>());
			disposables.add(toolInvoker.onDidChangeServers(newDescriptors => {
				this._refreshGatewayServers(gatewayId, newDescriptors, toolInvoker, routeIds, serverRouteMap, onDidChangeServers);
			}));

			return {
				servers,
				onDidChangeServers: onDidChangeServers.event,
				gatewayId,
			};
		} catch (error) {
			// Clean up partially-created state on failure
			this._cleanupGateway(gatewayId);
			throw error;
		}
	}

	private _refreshGatewayServers(
		gatewayId: string,
		newDescriptors: readonly IMcpGatewayServerDescriptor[],
		toolInvoker: IMcpGatewayToolInvoker,
		routeIds: Set<string>,
		serverRouteMap: Map<string, string>,
		onDidChangeServers: Emitter<readonly IMcpGatewayServerInfo[]>,
	): void {
		// Bail out if the gateway has been disposed
		if (!this._gatewayRoutes.has(gatewayId)) {
			return;
		}

		const newServerIds = new Set(newDescriptors.map(d => d.id));
		const existingServerIds = new Set(serverRouteMap.keys());

		// Remove routes for servers that are gone
		for (const serverId of existingServerIds) {
			if (!newServerIds.has(serverId)) {
				const routeId = serverRouteMap.get(serverId);
				if (routeId) {
					this._disposeRoute(routeId);
					routeIds.delete(routeId);
					serverRouteMap.delete(serverId);
				}
			}
		}

		// Add routes for new servers, and update labels for existing ones.
		for (const descriptor of newDescriptors) {
			if (!existingServerIds.has(descriptor.id)) {
				this._createRouteForServer(gatewayId, descriptor.id, descriptor.label, toolInvoker, routeIds, serverRouteMap);
				continue;
			}

			const routeId = serverRouteMap.get(descriptor.id);
			const route = routeId ? this._routes.get(routeId) : undefined;
			if (route && route.label !== descriptor.label) {
				route.label = descriptor.label;
			}
		}

		const updatedServers = this._getGatewayServers(gatewayId);
		this._logger.info(`[McpGatewayService] Gateway ${gatewayId} servers changed: ${updatedServers.length} server(s)`);
		onDidChangeServers.fire(updatedServers);
	}

	private _cleanupGateway(gatewayId: string): void {
		const routeIds = this._gatewayRoutes.get(gatewayId);
		if (routeIds) {
			for (const routeId of routeIds) {
				this._disposeRoute(routeId);
			}
		}
		this._gatewayRoutes.delete(gatewayId);
		this._gatewayServerRoutes.delete(gatewayId);
		this._gatewayToClient.delete(gatewayId);
		this._gatewayDisposables.get(gatewayId)?.dispose();
		this._gatewayDisposables.delete(gatewayId);
	}

	private _createRouteForServer(
		gatewayId: string,
		serverId: string,
		label: string,
		toolInvoker: IMcpGatewayToolInvoker,
		routeIds: Set<string>,
		serverRouteMap: Map<string, string>,
	): IMcpGatewayServerInfo {
		const routeId = generateUuid();

		// Create a single-server invoker that delegates to the aggregating invoker
		const singleServerInvoker: IMcpGatewaySingleServerInvoker = {
			onDidChangeTools: toolInvoker.onDidChangeTools,
			onDidChangeResources: toolInvoker.onDidChangeResources,
			listTools: () => toolInvoker.listToolsForServer(serverId),
			callTool: (name, args) => toolInvoker.callToolForServer(serverId, name, args),
			listResources: () => toolInvoker.listResourcesForServer(serverId),
			readResource: uri => toolInvoker.readResourceForServer(serverId, uri),
			listResourceTemplates: () => toolInvoker.listResourceTemplatesForServer(serverId),
		};

		const route = new McpGatewayRoute(routeId, this._logger, singleServerInvoker, label);
		this._routes.set(routeId, route);
		routeIds.add(routeId);
		serverRouteMap.set(serverId, routeId);

		const address = URI.parse(`http://127.0.0.1:${this._port}/gateway/${routeId}`);
		this._logger.info(`[McpGatewayService] Created route ${routeId} for server '${label}' (${serverId}) at ${address}`);

		return { label, address };
	}

	private _getGatewayServers(gatewayId: string): IMcpGatewayServerInfo[] {
		const serverRouteMap = this._gatewayServerRoutes.get(gatewayId);
		if (!serverRouteMap) {
			return [];
		}
		const servers: IMcpGatewayServerInfo[] = [];
		for (const [_serverId, routeId] of serverRouteMap) {
			const route = this._routes.get(routeId);
			if (route) {
				servers.push({
					label: route.label,
					address: URI.parse(`http://127.0.0.1:${this._port}/gateway/${routeId}`),
				});
			}
		}
		return servers;
	}

	private _disposeRoute(routeId: string): void {
		const route = this._routes.get(routeId);
		if (route) {
			route.dispose();
			this._routes.delete(routeId);
			this._logger.info(`[McpGatewayService] Disposed route: ${routeId}`);
		}
	}

	async disposeGateway(gatewayId: string): Promise<void> {
		if (!this._gatewayRoutes.has(gatewayId)) {
			this._logger.warn(`[McpGatewayService] Attempted to dispose unknown gateway: ${gatewayId}`);
			return;
		}

		this._cleanupGateway(gatewayId);
		this._logger.info(`[McpGatewayService] Disposed gateway: ${gatewayId} (remaining routes: ${this._routes.size})`);

		// If no more routes, shut down the server
		if (this._routes.size === 0) {
			this._stopServer();
		}
	}

	disposeGatewaysForClient(clientId: unknown): void {
		for (const pending of this._pendingGatewayCreates) {
			if (pending.clientId === clientId) {
				pending.canceled = true;
			}
		}
		const gatewaysToDispose: string[] = [];

		for (const [gatewayId, ownerClientId] of this._gatewayToClient) {
			if (ownerClientId === clientId) {
				gatewaysToDispose.push(gatewayId);
			}
		}

		if (gatewaysToDispose.length > 0) {
			this._logger.info(`[McpGatewayService] Disposing ${gatewaysToDispose.length} gateway(s) for disconnected client ${clientId}`);

			for (const gatewayId of gatewaysToDispose) {
				this._cleanupGateway(gatewayId);
			}

			// If no more routes, shut down the server
			if (this._routes.size === 0) {
				this._stopServer();
			}
		}
	}

	private _throwIfDisposed(): void {
		if (this._store.isDisposed) {
			throw new Error('[McpGatewayService] Service is disposed');
		}
	}

	private async _ensureServer(): Promise<void> {
		this._throwIfDisposed();
		if (this._server?.listening) {
			return;
		}

		// If server is already starting, wait for it
		if (this._serverStartPromise) {
			return this._serverStartPromise;
		}

		this._serverStartPromise = this._startServer();
		try {
			await this._serverStartPromise;
		} finally {
			this._serverStartPromise = undefined;
		}
	}

	private async _startServer(): Promise<void> {
		const createServer = await this._loadHttpServerConstructor();
		this._throwIfDisposed();
		const deferredPromise = new DeferredPromise<void>();

		const server = createServer((req, res) => {
			this._handleRequest(req, res);
		});
		this._server = server;

		const portTimeout = setTimeout(() => {
			deferredPromise.error(new Error('[McpGatewayService] Timeout waiting for server to start'));
		}, 5000);
		const cancelServerStart = () => {
			clearTimeout(portTimeout);
			if (!deferredPromise.isSettled) {
				deferredPromise.error(new Error('[McpGatewayService] Server stopped during startup'));
			}
		};
		this._cancelServerStart = cancelServerStart;

		server.on('listening', () => {
			if (this._store.isDisposed || this._server !== server) {
				cancelServerStart();
				return;
			}
			const address = server.address();
			if (typeof address === 'string') {
				this._port = parseInt(address);
			} else if (address instanceof Object) {
				this._port = address.port;
			} else {
				clearTimeout(portTimeout);
				deferredPromise.error(new Error('[McpGatewayService] Unable to determine port'));
				return;
			}

			clearTimeout(portTimeout);
			this._logger.info(`[McpGatewayService] Server started on port ${this._port}`);
			deferredPromise.complete();
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (this._store.isDisposed || this._server !== server) {
				cancelServerStart();
				return;
			}
			if (err.code === 'EADDRINUSE') {
				this._logger.warn('[McpGatewayService] Port in use, retrying with random port...');
				// Try with a random port
				server.listen(0, '127.0.0.1');
				return;
			}
			clearTimeout(portTimeout);
			this._logger.error(`[McpGatewayService] Server error: ${err}`);
			deferredPromise.error(err);
		});

		// Use dynamic port assignment (port 0)
		server.listen(0, '127.0.0.1');

		return deferredPromise.p.finally(() => {
			clearTimeout(portTimeout);
			if (this._cancelServerStart === cancelServerStart) {
				this._cancelServerStart = undefined;
			}
		});
	}

	protected async _loadHttpServerConstructor(): Promise<typeof import('http').createServer> {
		return (await import('http')).createServer; // Lazy due to https://github.com/nodejs/node/issues/59686
	}

	private _stopServer(): void {
		this._cancelServerStart?.();
		this._cancelServerStart = undefined;
		if (!this._server) {
			return;
		}

		this._logger.info('[McpGatewayService] Stopping server (no more routes)');

		this._server.close(err => {
			if (err) {
				this._logger.error(`[McpGatewayService] Error closing server: ${err}`);
			} else {
				this._logger.info('[McpGatewayService] Server stopped');
			}
		});

		this._server = undefined;
		this._port = undefined;
	}

	private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		const url = new URL(req.url!, `http://${req.headers.host}`);
		const pathParts = url.pathname.split('/').filter(Boolean);

		this._logger.debug(`[McpGatewayService] ${req.method} ${url.pathname} (active routes: ${this._routes.size})`);

		// Expected path: /gateway/{routeId}
		if (pathParts.length >= 2 && pathParts[0] === 'gateway') {
			const routeId = pathParts[1];
			const route = this._routes.get(routeId);

			if (route) {
				route.handleRequest(req, res);
				return;
			}
		}

		// Not found
		this._logger.warn(`[McpGatewayService] ${req.method} ${url.pathname}: route not found`);
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Gateway not found' }));
	}

	override dispose(): void {
		this._logger.info(`[McpGatewayService] Disposing service (routes: ${this._routes.size})`);
		this._stopServer();
		for (const route of this._routes.values()) {
			route.dispose();
		}
		this._routes.clear();
		this._gatewayRoutes.clear();
		this._gatewayServerRoutes.clear();
		this._gatewayToClient.clear();
		for (const disposables of this._gatewayDisposables.values()) {
			disposables.dispose();
		}
		this._gatewayDisposables.clear();
		super.dispose();
	}
}
