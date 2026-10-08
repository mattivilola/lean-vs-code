/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { InstantiationService } from '../../../instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../instantiation/common/serviceCollection.js';
import { IBrowserViewCreationContext } from '../../common/browserView.js';
import { IBrowserViewGroupFilter } from '../../common/browserViewGroup.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../common/cdp/types.js';
import type { BrowserViewGroup } from '../../electron-main/browserViewGroup.js';
import { BrowserViewGroupMainService } from '../../electron-main/browserViewGroupMainService.js';

// This main-process service has a Node-only test fixture; no Electron app is started.
suite('BrowserViewGroupMainService lazy creation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const context: IBrowserViewCreationContext = {
		host: { windowId: 1 }, owner: { type: 'user' }, session: 'test-session'
	};

	function fixture() {
		const instances: RecordingGroup[] = [];
		let onConstructed: (() => void) | undefined;
		let activation: () => Promise<void> = async () => { };
		class RecordingGroup extends Disposable {
			private readonly destroyed = this._register(new Emitter<void>());
			readonly onDidDestroy = this.destroyed.event;
			private readonly messages = this._register(new Emitter<CDPResponse | CDPEvent>());
			readonly requests: CDPRequest[] = [];
			readonly debugger = {
				onMessage: this.messages.event,
				sendMessage: async (request: CDPRequest) => { this.requests.push(request); }
			};
			disposeCount = 0;
			constructor(readonly id: string, readonly filter: IBrowserViewGroupFilter, readonly targetContext: IBrowserViewCreationContext) {
				super();
				instances.push(this);
				onConstructed?.();
			}
			activate(): Promise<void> { return activation(); }
			fireMessage(message: CDPResponse | CDPEvent): void { this.messages.fire(message); }
			override dispose(): void {
				if (!this._store.isDisposed) {
					this.disposeCount++;
					this.destroyed.fire();
				}
				super.dispose();
			}
		}
		const Constructor = RecordingGroup as unknown as typeof BrowserViewGroup;
		class TestService extends BrowserViewGroupMainService {
			loadCount = 0;
			loader: () => Promise<typeof BrowserViewGroup> = async () => Constructor;
			protected override _loadGroupConstructor(): Promise<typeof BrowserViewGroup> {
				this.loadCount++;
				return this.loader();
			}
		}
		const instantiation = store.add(new InstantiationService(new ServiceCollection()));
		const service = store.add(new TestService(instantiation));
		return {
			service, instances, Constructor,
			setActivation: (callback: () => Promise<void>) => { activation = callback; },
			onConstructed: (callback: () => void) => { onConstructed = callback; }
		};
	}

	test('idle service does not load; concurrent requests share a load and keep separate groups', async () => {
		const f = fixture();
		assert.strictEqual(f.service.loadCount, 0);
		const gate = new DeferredPromise<typeof BrowserViewGroup>();
		f.service.loader = () => gate.p;
		const filter = { browserIds: ['browser'] };
		const first = f.service.createGroup(filter, context);
		const second = f.service.createGroup({ audience: { type: 'agent' } }, context);
		assert.strictEqual(f.service.loadCount, 1);
		assert.strictEqual(f.instances.length, 0);
		await gate.complete(f.Constructor);
		const ids = await Promise.all([first, second]);
		assert.notStrictEqual(ids[0], ids[1]);
		assert.strictEqual(f.instances.length, 2);
		assert.strictEqual(f.instances[0].filter, filter);
		assert.strictEqual(f.instances[0].targetContext, context);
		await f.service.createGroup({}, context);
		assert.strictEqual(f.service.loadCount, 1);
	});

	test('a disposed idle service rejects without loading', async () => {
		const f = fixture();
		f.service.dispose();
		await assert.rejects(f.service.createGroup({}, context), isCancellationError);
		assert.strictEqual(f.service.loadCount, 0);
	});

	test('shutdown during loading prevents late construction for every waiting request', async () => {
		const f = fixture();
		const gate = new DeferredPromise<typeof BrowserViewGroup>();
		f.service.loader = () => gate.p;
		const checks = [
			assert.rejects(f.service.createGroup({}, context), isCancellationError),
			assert.rejects(f.service.createGroup({}, context), isCancellationError)
		];
		f.service.dispose();
		await gate.complete(f.Constructor);
		await Promise.all(checks);
		assert.strictEqual(f.instances.length, 0);
	});

	test('a failed shared load rejects all waiters and allows retry', async () => {
		const f = fixture();
		const gate = new DeferredPromise<typeof BrowserViewGroup>();
		f.service.loader = () => gate.p;
		const checks = [
			assert.rejects(f.service.createGroup({}, context), /load failed/),
			assert.rejects(f.service.createGroup({}, context), /load failed/)
		];
		await gate.error(new Error('load failed'));
		await Promise.all(checks);
		assert.strictEqual(f.instances.length, 0);
		f.service.loader = async () => f.Constructor;
		await f.service.createGroup({}, context);
		assert.strictEqual(f.service.loadCount, 2);
	});

	test('reentrant shutdown during construction disposes the new group', async () => {
		const f = fixture();
		f.onConstructed(() => f.service.dispose());
		await assert.rejects(f.service.createGroup({}, context), isCancellationError);
		assert.strictEqual(f.instances[0].disposeCount, 1);
	});

	test('failed activation removes and disposes the group', async () => {
		const f = fixture();
		f.setActivation(async () => { throw new Error('activation failed'); });
		await assert.rejects(f.service.createGroup({}, context), /activation failed/);
		const group = f.instances[0];
		assert.strictEqual(group.disposeCount, 1);
		assert.throws(() => f.service.onDynamicDidDestroy(group.id), /not found/);
	});

	test('shutdown during activation does not return a dead group', async () => {
		const f = fixture();
		const gate = new DeferredPromise<void>();
		f.setActivation(() => gate.p);
		const pending = f.service.createGroup({}, context);
		const rejected = assert.rejects(pending, isCancellationError);
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(f.instances.length, 1);
		f.service.dispose();
		await gate.complete();
		await rejected;
		assert.strictEqual(f.instances[0].disposeCount, 1);
	});

	test('explicit destruction during activation cancels the create result', async () => {
		const f = fixture();
		const gate = new DeferredPromise<void>();
		f.setActivation(() => gate.p);
		const rejected = assert.rejects(f.service.createGroup({}, context), isCancellationError);
		await Promise.resolve();
		await Promise.resolve();
		await f.service.destroyGroup(f.instances[0].id);
		await gate.complete();
		await rejected;
		assert.strictEqual(f.instances[0].disposeCount, 1);
	});

	test('dynamic events and CDP forwarding remain available after first creation', async () => {
		const f = fixture();
		const id = await f.service.createGroup({}, context);
		const group = f.instances[0];
		const message: CDPEvent = { method: 'Target.targetCreated', params: {} };
		const received = Event.toPromise(f.service.onDynamicCDPMessage(id));
		group.fireMessage(message);
		assert.strictEqual(await received, message);
		const request: CDPRequest = { id: 1, method: 'Target.getTargets' };
		await f.service.sendCDPMessage(id, request);
		assert.deepStrictEqual(group.requests, [request]);
		const destroyed = Event.toPromise(f.service.onDynamicDidDestroy(id));
		await f.service.destroyGroup(id);
		await destroyed;
		assert.strictEqual(group.disposeCount, 1);
		await assert.rejects(f.service.sendCDPMessage(id, request), /not found/);
	});
});
