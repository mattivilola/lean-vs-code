/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { JsonRpcMessage, JsonRpcProtocol } from '../../../base/common/jsonRpcProtocol.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogger } from '../../log/common/log.js';
import { IMcpGatewaySingleServerInvoker } from '../common/mcpGateway.js';
import { isInitializeMessage, McpGatewaySession } from './mcpGatewaySession.js';

/**
 * Represents a single MCP gateway route for one MCP server.
 */
export class McpGatewayRoute extends Disposable {
	private readonly _sessions = new Map<string, McpGatewaySession>();

	private static readonly SessionHeaderName = 'mcp-session-id';

	constructor(
		public readonly routeId: string,
		private readonly _logger: ILogger,
		private readonly _serverInvoker: IMcpGatewaySingleServerInvoker,
		public label: string = '',
	) {
		super();
	}

	handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		this._logger.debug(`[McpGateway][route ${this.routeId}] ${req.method} request (sessions: ${this._sessions.size})`);

		if (req.method === 'POST') {
			void this._handlePost(req, res);
			return;
		}

		if (req.method === 'GET') {
			this._handleGet(req, res);
			return;
		}

		if (req.method === 'DELETE') {
			this._handleDelete(req, res);
			return;
		}

		this._respondHttpError(res, 405, 'Method not allowed');
	}

	public override dispose(): void {
		this._logger.info(`[McpGateway][route ${this.routeId}] Disposing route (sessions: ${this._sessions.size})`);
		for (const session of this._sessions.values()) {
			session.dispose();
		}
		this._sessions.clear();
		super.dispose();
	}

	private _handleDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
		const sessionId = this._getSessionId(req);
		if (!sessionId) {
			this._respondHttpError(res, 400, 'Missing Mcp-Session-Id header');
			return;
		}

		const session = this._sessions.get(sessionId);
		if (!session) {
			this._respondHttpError(res, 404, 'Session not found');
			return;
		}

		this._logger.info(`[McpGateway][route ${this.routeId}] Deleting session ${sessionId}`);
		session.dispose();
		this._sessions.delete(sessionId);
		res.writeHead(204);
		res.end();
	}

	private _handleGet(req: http.IncomingMessage, res: http.ServerResponse): void {
		const sessionId = this._getSessionId(req);
		if (!sessionId) {
			this._respondHttpError(res, 400, 'Missing Mcp-Session-Id header');
			return;
		}

		const session = this._sessions.get(sessionId);
		if (!session) {
			this._respondHttpError(res, 404, 'Session not found');
			return;
		}

		this._logger.info(`[McpGateway][route ${this.routeId}] SSE connection requested for session ${sessionId}`);
		session.attachSseClient(req, res);
	}

	private async _handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const body = await this._readRequestBody(req);
		if (body === undefined) {
			this._respondHttpError(res, 413, 'Payload too large');
			return;
		}

		this._logger.debug(`[McpGateway][route ${this.routeId}] Handling POST`);

		let message: JsonRpcMessage | JsonRpcMessage[];
		try {
			message = JSON.parse(body) as JsonRpcMessage | JsonRpcMessage[];
		} catch (error) {
			this._logger.warn(`[McpGateway][route ${this.routeId}] JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(JsonRpcProtocol.createParseError('Parse error', error instanceof Error ? error.message : String(error))));
			return;
		}

		const headerSessionId = this._getSessionId(req);
		const session = this._resolveSessionForPost(headerSessionId, message, res);
		if (!session) {
			return;
		}

		try {
			const responses = await session.handleIncoming(message);

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Mcp-Session-Id': session.id,
			};

			if (responses.length === 0) {
				this._logger.debug(`[McpGateway][route ${this.routeId}] POST response: 202 (no content)`);
				res.writeHead(202, headers);
				res.end();
				return;
			}

			const responseBody = JSON.stringify(Array.isArray(message) ? responses : responses[0]);
			this._logger.debug(`[McpGateway][route ${this.routeId}] POST response: 200, body: ${responseBody}`);
			res.writeHead(200, headers);
			res.end(responseBody);
		} catch (error) {
			this._logger.error('[McpGatewayService] Failed handling gateway request', error);
			this._respondHttpError(res, 500, 'Internal server error');
		}
	}

	private _resolveSessionForPost(headerSessionId: string | undefined, message: JsonRpcMessage | JsonRpcMessage[], res: http.ServerResponse): McpGatewaySession | undefined {
		if (headerSessionId) {
			const existing = this._sessions.get(headerSessionId);
			if (!existing) {
				this._logger.warn(`[McpGateway][route ${this.routeId}] Session not found: ${headerSessionId}`);
				this._respondHttpError(res, 404, 'Session not found');
				return undefined;
			}

			return existing;
		}

		if (!isInitializeMessage(message)) {
			this._respondHttpError(res, 400, 'Missing Mcp-Session-Id header');
			return undefined;
		}

		const sessionId = generateUuid();
		this._logger.info(`[McpGateway][route ${this.routeId}] Creating new session ${sessionId}`);
		const session = new McpGatewaySession(sessionId, this._logger, () => {
			this._sessions.delete(sessionId);
		}, this._serverInvoker);
		this._sessions.set(sessionId, session);
		return session;
	}

	private _respondHttpError(res: http.ServerResponse, statusCode: number, error: string): void {
		this._logger.debug(`[McpGateway][route ${this.routeId}] HTTP error response: ${statusCode} ${error}`);
		res.writeHead(statusCode, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: statusCode, message: error } } satisfies JsonRpcMessage));
	}

	private _getSessionId(req: http.IncomingMessage): string | undefined {
		const value = req.headers[McpGatewayRoute.SessionHeaderName];
		if (Array.isArray(value)) {
			return value[0];
		}

		return value;
	}

	private async _readRequestBody(req: http.IncomingMessage): Promise<string | undefined> {
		const chunks: Buffer[] = [];
		let size = 0;
		const maxBytes = 1024 * 1024;

		for await (const chunk of req) {
			const asBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += asBuffer.byteLength;
			if (size > maxBytes) {
				return undefined;
			}
			chunks.push(asBuffer);
		}

		return Buffer.concat(chunks).toString('utf8');
	}
}
