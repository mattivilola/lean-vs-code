/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, toDisposable } from '../../../base/common/lifecycle.js';
import { IPCServer, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { ILogService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IAgentNetworkFilterService } from '../../networkFilter/common/networkFilterService.js';
import { BrowserViewGroupRemoteService } from './browserViewGroupRemoteService.js';
import type { PlaywrightService } from './playwrightService.js';
import { IPlaywrightServiceInitializeOptions } from '../common/playwrightService.js';

interface IPlaywrightContext {
	readonly options: IPlaywrightServiceInitializeOptions;
	pending?: Promise<PlaywrightService>;
}

/**
 * IPC channel for the Playwright service.
 *
 * Each connected window gets its own {@link PlaywrightService},
 * keyed by the opaque IPC connection context. The client sends an
 * `__initialize` call with its window ID before any other
 * method calls. Options are registered synchronously; the implementation loads
 * on the first operation. When a window disconnects the instance is disposed.
 */
export class PlaywrightChannel extends Disposable implements IServerChannel<string> {

	private readonly _instances = this._register(new DisposableMap<string, PlaywrightService>());
	private readonly _contexts = new Map<string, IPlaywrightContext>();
	private readonly browserViewGroupRemoteService: BrowserViewGroupRemoteService;

	constructor(
		ipcServer: IPCServer<string>,
		mainProcessService: IMainProcessService,
		private readonly logService: ILogService,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		private readonly telemetryService: ITelemetryService,
	) {
		super();
		this.browserViewGroupRemoteService = new BrowserViewGroupRemoteService(mainProcessService);
		this._register(toDisposable(() => this._contexts.clear()));
		this._register(ipcServer.onDidRemoveConnection(c => {
			this._contexts.delete(c.ctx);
			this._instances.deleteAndDispose(c.ctx);
		}));
	}

	listen<T>(ctx: string, event: string): Event<T> {
		if (!this._contexts.has(ctx)) {
			throw new Error(`Window not initialized for context: ${ctx}`);
		}
		// IPlaywrightService has no events; listening must not load the implementation.
		throw new Error(`Event not found: ${event}`);
	}

	call<T>(ctx: string, command: string, arg?: unknown): Promise<T> {
		// The client does not await initialization: register options before returning.
		if (command === '__initialize') {
			if (!isPlaywrightServiceInitializeOptions(arg)) {
				throw new Error('Invalid argument for __initialize: expected window options');
			}
			if (this._store.isDisposed) {
				throw new Error('Playwright channel is disposed');
			}
			if (!this._contexts.has(ctx)) {
				this._contexts.set(ctx, { options: { windowId: arg.windowId, useSessionStorageAffinity: arg.useSessionStorageAffinity } });
			}
			return Promise.resolve(undefined as T);
		}

		const context = this._contexts.get(ctx);
		if (!context) {
			throw new Error(`Window not initialized for context: ${ctx}`);
		}
		if (command === 'disposeSession' && !this._instances.has(ctx) && !context.pending) {
			return Promise.resolve(undefined as T);
		}
		return this._call(ctx, context, command, arg);
	}

	private async _call<T>(ctx: string, context: IPlaywrightContext, command: string, arg?: unknown): Promise<T> {
		let instance = this._instances.get(ctx);
		if (!instance) {
			if (!context.pending) {
				const pending = this._createInstance(ctx, context).finally(() => {
					if (context.pending === pending) {
						context.pending = undefined;
					}
				});
				context.pending = pending;
			}
			instance = await context.pending;
		}
		this._checkContext(ctx, context);

		const target = (instance as unknown as Record<string, unknown>)[command];
		if (typeof target !== 'function') {
			throw new Error(`Method not found: ${command}`);
		}

		const methodArgs = Array.isArray(arg) ? arg : [];
		let res = target.apply(instance, methodArgs);
		if (!(res instanceof Promise)) {
			res = Promise.resolve(res);
		}
		return res;
	}

	private _checkContext(ctx: string, context: IPlaywrightContext): void {
		if (this._store.isDisposed || this._contexts.get(ctx) !== context) {
			throw new Error(`Window disconnected for context: ${ctx}`);
		}
	}

	private async _createInstance(ctx: string, context: IPlaywrightContext): Promise<PlaywrightService> {
		const Service = await this._loadServiceConstructor();
		this._checkContext(ctx, context);
		const instance = new Service(context.options.windowId, context.options.useSessionStorageAffinity, this.browserViewGroupRemoteService, this.logService, this.agentNetworkFilterService, this.telemetryService);
		try {
			this._checkContext(ctx, context);
			this._instances.set(ctx, instance);
			return instance;
		} catch (error) {
			instance.dispose();
			throw error;
		}
	}

	protected async _loadServiceConstructor(): Promise<typeof PlaywrightService> {
		return (await import('./playwrightService.js')).PlaywrightService;
	}
}

function isPlaywrightServiceInitializeOptions(value: unknown): value is IPlaywrightServiceInitializeOptions {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<IPlaywrightServiceInitializeOptions>;
	return typeof candidate.windowId === 'number'
		&& typeof candidate.useSessionStorageAffinity === 'boolean';
}
