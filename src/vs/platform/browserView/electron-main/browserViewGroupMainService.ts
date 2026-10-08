/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator, IInstantiationService } from '../../instantiation/common/instantiation.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IBrowserViewGroupFilter, IBrowserViewGroupService } from '../common/browserViewGroup.js';
import { IBrowserViewCreationContext } from '../common/browserView.js';
import type { BrowserViewGroup } from './browserViewGroup.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../common/cdp/types.js';
import { CancellationError } from '../../../base/common/errors.js';

export const IBrowserViewGroupMainService = createDecorator<IBrowserViewGroupMainService>('browserViewGroupMainService');

export interface IBrowserViewGroupMainService extends IBrowserViewGroupService {
	readonly _serviceBrand: undefined;
}

/**
 * Main-process service that manages {@link BrowserViewGroup} instances.
 *
 * Implements {@link IBrowserViewGroupService} so it can be surfaced to
 * the workbench/shared process via {@link ProxyChannel}.
 */
export class BrowserViewGroupMainService extends Disposable implements IBrowserViewGroupMainService {
	declare readonly _serviceBrand: undefined;

	private readonly groups = this._register(new DisposableMap<string, BrowserViewGroup>());
	private groupConstructor: Promise<typeof BrowserViewGroup> | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	async createGroup(filter: IBrowserViewGroupFilter, targetContext: IBrowserViewCreationContext): Promise<string> {
		if (this._store.isDisposed) {
			throw new CancellationError();
		}
		const Group = await (this.groupConstructor ??= this._loadGroupConstructor().catch(error => {
			this.groupConstructor = undefined;
			throw error;
		}));
		if (this._store.isDisposed) {
			throw new CancellationError();
		}
		const id = generateUuid();
		const group = this.instantiationService.createInstance(Group, id, filter, targetContext);
		if (this._store.isDisposed) {
			group.dispose();
			throw new CancellationError();
		}
		this.groups.set(id, group);

		Event.once(group.onDidDestroy)(() => {
			this.groups.deleteAndLeak(id);
		});

		try {
			await group.activate();
			if (this.groups.get(id) !== group) {
				throw new CancellationError();
			}
			return id;
		} catch (error) {
			if (this.groups.get(id) === group) {
				this.groups.deleteAndDispose(id);
			}
			throw error;
		}
	}

	protected async _loadGroupConstructor(): Promise<typeof BrowserViewGroup> {
		return (await import('./browserViewGroup.js')).BrowserViewGroup;
	}

	async destroyGroup(groupId: string): Promise<void> {
		this.groups.deleteAndDispose(groupId);
	}

	async sendCDPMessage(groupId: string, message: CDPRequest): Promise<void> {
		return this._getGroup(groupId).debugger.sendMessage(message);
	}

	onDynamicDidDestroy(groupId: string): Event<void> {
		return this._getGroup(groupId).onDidDestroy;
	}

	onDynamicCDPMessage(groupId: string): Event<CDPResponse | CDPEvent> {
		return this._getGroup(groupId).debugger.onMessage;
	}

	/**
	 * Get a group or throw if not found.
	 */
	private _getGroup(groupId: string): BrowserViewGroup {
		const group = this.groups.get(groupId);
		if (!group) {
			throw new Error(`Browser view group ${groupId} not found`);
		}
		return group;
	}
}
