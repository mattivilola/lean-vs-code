/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLoggerService } from '../../../log/common/log.js';
import { IMcpGatewayServerDescriptor, IMcpGatewayToolInvoker } from '../../common/mcpGateway.js';
import { McpGatewayService } from '../../node/mcpGatewayService.js';
import type { McpGatewayRoute } from '../../node/mcpGatewayRoute.js';

suite('McpGatewayService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createInvoker() {
		const onDidChangeServers = store.add(new Emitter<readonly IMcpGatewayServerDescriptor[]>());
		const onDidChangeTools = store.add(new Emitter<void>());
		const invoker: IMcpGatewayToolInvoker = {
			onDidChangeServers: onDidChangeServers.event,
			onDidChangeTools: onDidChangeTools.event,
			onDidChangeResources: Event.None,
			listServers: () => [{ id: 'one', label: 'First server' }],
			listToolsForServer: async () => [{ name: 'hello', inputSchema: { type: 'object' } }],
			callToolForServer: async (serverId, name) => ({ content: [{ type: 'text', text: `${serverId}:${name}` }] }),
			listResourcesForServer: async () => [],
			readResourceForServer: async () => ({ contents: [] }),
			listResourceTemplatesForServer: async () => [],
		};
		return { invoker, onDidChangeServers, onDidChangeTools };
	}

	function createService() {
		return store.add(new McpGatewayService(store.add(new NullLoggerService())));
	}

	async function initialize(address: string) {
		const response = await fetch(address, {
			method: 'POST',
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
				protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
			} }),
		});
		assert.strictEqual(response.status, 200);
		const sessionId = response.headers.get('mcp-session-id');
		assert.ok(sessionId);
		const result = await response.json() as { result: { protocolVersion: string } };
		assert.strictEqual(result.result.protocolVersion, '2025-11-25');
		const initialized = await fetch(address, {
			method: 'POST', headers: { 'mcp-session-id': sessionId },
			body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
		});
		assert.strictEqual(initialized.status, 202);
		return sessionId;
	}

	test('first gateway accepts initialize and tool requests', async () => {
		const service = createService();
		const { invoker } = createInvoker();
		const gateway = await service.createGateway('client', invoker);
		const address = gateway.servers[0].address.toString();
		const sessionId = await initialize(address);
		const response = await fetch(address, {
			method: 'POST', headers: { 'mcp-session-id': sessionId },
			body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'hello', arguments: {} } }),
		});
		assert.strictEqual(response.status, 200);
		assert.deepStrictEqual(await response.json(), {
			jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'one:hello' }] },
		});
		await service.disposeGateway(gateway.gatewayId);
	});

	test('SSE stream closes when its session is deleted', async () => {
		const service = createService();
		const { invoker, onDidChangeTools } = createInvoker();
		const gateway = await service.createGateway('client', invoker);
		const address = gateway.servers[0].address.toString();
		const sessionId = await initialize(address);
		const response = await fetch(address, { headers: { 'mcp-session-id': sessionId } });
		assert.strictEqual(response.headers.get('content-type'), 'text/event-stream');
		const reader = response.body!.getReader();
		try {
			const initial = await reader.read();
			assert.strictEqual(new TextDecoder().decode(initial.value), ': connected\n\n');
			onDidChangeTools.fire();
			const notification = await reader.read();
			assert.match(new TextDecoder().decode(notification.value), /notifications\/tools\/list_changed/);
			const deletion = await fetch(address, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
			assert.strictEqual(deletion.status, 204);
			assert.strictEqual((await reader.read()).done, true);
			const stale = await fetch(address, { headers: { 'mcp-session-id': sessionId } });
			assert.strictEqual(stale.status, 404);
			await stale.text();
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
	});

	test('concurrent gateways share a server and accept synchronous route changes', async () => {
		const service = createService();
		const { invoker, onDidChangeServers } = createInvoker();
		const gateways = await Promise.all([service.createGateway('one', invoker), service.createGateway('two', invoker)]);
		assert.strictEqual(gateways[0].servers[0].address.authority, gateways[1].servers[0].address.authority);
		let labels: string[] = [];
		let newAddress: string | undefined;
		store.add(gateways[1].onDidChangeServers(servers => {
			labels = servers.map(server => server.label);
			newAddress = servers[1]?.address.toString();
		}));
		onDidChangeServers.fire([{ id: 'one', label: 'Renamed' }, { id: 'two', label: 'Added' }]);
		assert.deepStrictEqual(labels, ['Renamed', 'Added']);
		assert.ok(newAddress);
		await initialize(newAddress);
		service.disposeGatewaysForClient('one');
		await initialize(gateways[1].servers[0].address.toString());
	});

	test('disposal during first load rejects creation and later calls', async () => {
		const service = createService();
		const pending = service.createGateway('client', createInvoker().invoker);
		service.dispose();
		await assert.rejects(pending, /Service is disposed/);
		await assert.rejects(service.createGateway('client', createInvoker().invoker), /Service is disposed/);
	});

	test('client disconnect during load cancels only its pending gateway', async () => {
		const service = createService();
		const { invoker } = createInvoker();
		const canceled = service.createGateway('gone', invoker);
		const retained = service.createGateway('present', invoker);
		service.disposeGatewaysForClient('gone');
		await assert.rejects(canceled, /Client disconnected/);
		const gateway = await retained;
		await initialize(gateway.servers[0].address.toString());
	});

	test('retry after all pending clients disconnect starts a usable server', async () => {
		const service = createService();
		const { invoker } = createInvoker();
		const canceled = service.createGateway('gone', invoker);
		service.disposeGatewaysForClient('gone');
		await assert.rejects(canceled, /Client disconnected/);
		const gateway = await service.createGateway('next', invoker);
		await initialize(gateway.servers[0].address.toString());
	});

	test('module-load failure propagates and a later attempt can retry', async () => {
		class FailingFirstLoadService extends McpGatewayService {
			private first = true;
			protected override async _loadRouteConstructor(): Promise<typeof McpGatewayRoute> {
				if (this.first) {
					this.first = false;
					throw new Error('Test module-load failure');
				}
				return super._loadRouteConstructor();
			}
		}
		const service = store.add(new FailingFirstLoadService(store.add(new NullLoggerService())));
		const { invoker } = createInvoker();
		await assert.rejects(service.createGateway('client', invoker), /Test module-load failure/);
		const gateway = await service.createGateway('client', invoker);
		await initialize(gateway.servers[0].address.toString());
	});
});
