/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { IChannel, IPCServer } from '../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IMainProcessService } from '../../../ipc/common/mainProcessService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAgentNetworkFilterService } from '../../../networkFilter/common/networkFilterService.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { PlaywrightChannel } from '../../node/playwrightChannel.js';
import { PlaywrightService } from '../../node/playwrightService.js';

type IPCConnection = IPCServer<string>['connections'][number];

suite('PlaywrightChannel', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createFixture() {
		const disconnected = store.add(new Emitter<IPCConnection>());
		const instances: RecordingService[] = [];
		let constructed: (() => void) | undefined;
		class RecordingService extends PlaywrightService {
			readonly calls: string[][] = [];
			disposeCount = 0;
			readonly options: number;
			readonly affinity: boolean;
			constructor(...args: ConstructorParameters<typeof PlaywrightService>) {
				super(...args);
				this.options = args[0];
				this.affinity = args[1];
				instances.push(this);
				constructed?.();
			}
			override async getSummary(sessionId: string, pageId: string): Promise<string> {
				this.calls.push(['summary', sessionId, pageId]);
				if (pageId === 'throw') {
					throw new Error('Test operation failed');
				}
				return `${this.options}:${sessionId}:${pageId}`;
			}
			override async disposeSession(sessionId: string): Promise<void> {
				this.calls.push(['disposeSession', sessionId]);
			}
			override dispose(): void {
				this.disposeCount++;
				super.dispose();
			}
		}
		class TestChannel extends PlaywrightChannel {
			loadCount = 0;
			loader: () => Promise<typeof PlaywrightService> = async () => RecordingService;
			useRealLoader(): void { this.loader = () => super._loadServiceConstructor(); }
			protected override _loadServiceConstructor(): Promise<typeof PlaywrightService> {
				this.loadCount++;
				return this.loader();
			}
		}
		const server = new class extends mock<IPCServer<string>>() {
			override onDidRemoveConnection = disconnected.event;
		}();
		const mainProcessService = new class extends mock<IMainProcessService>() {
			override getChannel(): IChannel { return new class extends mock<IChannel>() { }(); }
		}();
		const channel = store.add(new TestChannel(server, mainProcessService, new NullLogService(), new class extends mock<IAgentNetworkFilterService>() { }(), NullTelemetryService));
		return {
			channel, instances, Service: RecordingService,
			initialize: (ctx = 'window', windowId = 1, affinity = true) => channel.call(ctx, '__initialize', { windowId, useSessionStorageAffinity: affinity }),
			disconnect: (ctx = 'window') => disconnected.fire(new class extends mock<IPCConnection>() { override ctx = ctx; }()),
			onConstructed: (callback: () => void) => { constructed = callback; },
		};
	}

	test('initialization stays synchronous and preserves first options without loading', async () => {
		const f = createFixture();
		const initialized = f.initialize('window', 7, false);
		void f.initialize('window', 9, true);
		assert.strictEqual(f.channel.loadCount, 0);
		assert.throws(() => f.channel.call('other', 'getSummary'), /Window not initialized/);
		assert.throws(() => f.channel.call('bad', '__initialize', { windowId: 1 }), /Invalid argument/);
		const summary = f.channel.call('window', 'getSummary', ['session', 'page']);
		await initialized;
		assert.strictEqual(await summary, '7:session:page');
		assert.strictEqual(f.instances[0].affinity, false);
	});

	test('unsupported events reject synchronously before, during and after loading', async () => {
		const f = createFixture();
		assert.throws(() => f.channel.listen('window', 'onSomething'), /Window not initialized/);
		void f.initialize();
		assert.throws(() => f.channel.listen('window', 'onSomething'), /Event not found/);
		assert.strictEqual(f.channel.loadCount, 0);
		const gate = new DeferredPromise<typeof PlaywrightService>();
		f.channel.loader = () => gate.p;
		const pending = f.channel.call('window', 'getSummary', ['s', 'p']);
		assert.throws(() => f.channel.listen('window', 'onSomething'), /Event not found/);
		await gate.complete(f.Service);
		await pending;
		assert.throws(() => f.channel.listen('window', 'onSomething'), /Event not found/);
		await assert.rejects(f.channel.call('window', 'unknownMethod'), /Method not found/);
	});

	test('concurrent operations share construction and preserve receiver, arguments and failures', async () => {
		const f = createFixture();
		void f.initialize();
		const summaries = await Promise.all([
			f.channel.call('window', 'getSummary', ['s1', 'p1']),
			f.channel.call('window', 'getSummary', ['s2', 'p2']),
		]);
		assert.deepStrictEqual(summaries, ['1:s1:p1', '1:s2:p2']);
		assert.strictEqual(f.channel.loadCount, 1);
		assert.strictEqual(f.instances.length, 1);
		await assert.rejects(f.channel.call('window', 'getSummary', ['s', 'throw']), /Test operation failed/);
	});

	test('contexts have independent instances and disconnect disposes only its instance', async () => {
		const f = createFixture();
		void f.initialize('one', 1);
		void f.initialize('two', 2);
		assert.deepStrictEqual(await Promise.all([
			f.channel.call('one', 'getSummary', ['s', 'p']),
			f.channel.call('two', 'getSummary', ['s', 'p']),
		]), ['1:s:p', '2:s:p']);
		f.disconnect('one');
		assert.deepStrictEqual(f.instances.map(i => i.disposeCount), [1, 0]);
		assert.strictEqual(await f.channel.call('two', 'getSummary', ['s', 'next']), '2:s:next');
	});

	test('failed module load rejects concurrent callers and can retry', async () => {
		const f = createFixture();
		void f.initialize();
		f.channel.loader = async () => { throw new Error('Test load failure'); };
		const results = await Promise.allSettled([
			f.channel.call('window', 'getSummary', ['s', 'p']),
			f.channel.call('window', 'getSummary', ['s', 'p']),
		]);
		assert.ok(results.every(result => result.status === 'rejected' && /Test load failure/.test(String(result.reason))));
		f.channel.loader = async () => f.Service;
		assert.strictEqual(await f.channel.call('window', 'getSummary', ['s', 'p']), '1:s:p');
		assert.strictEqual(f.channel.loadCount, 2);
	});

	test('late loading cannot overwrite a reconnected context', async () => {
		const f = createFixture();
		void f.initialize();
		const gate = new DeferredPromise<typeof PlaywrightService>();
		f.channel.loader = () => gate.p;
		const old = f.channel.call('window', 'getSummary', ['s', 'old']);
		f.disconnect();
		void f.initialize('window', 2);
		f.channel.loader = async () => f.Service;
		assert.strictEqual(await f.channel.call('window', 'getSummary', ['s', 'new']), '2:s:new');
		await gate.complete(f.Service);
		await assert.rejects(old, /Window disconnected/);
		assert.strictEqual(f.instances.length, 1);
		assert.strictEqual(f.instances[0].disposeCount, 0);
	});

	test('disconnect between construction and dispatch prevents stale operations', async () => {
		const f = createFixture();
		void f.initialize();
		f.onConstructed(() => queueMicrotask(() => f.disconnect()));
		await assert.rejects(f.channel.call('window', 'getSummary', ['s', 'p']), /Window disconnected/);
		assert.deepStrictEqual(f.instances[0].calls, []);
		assert.strictEqual(f.instances[0].disposeCount, 1);
	});

	test('channel disposal during loading prevents late construction', async () => {
		const f = createFixture();
		void f.initialize();
		const gate = new DeferredPromise<typeof PlaywrightService>();
		f.channel.loader = () => gate.p;
		const pending = f.channel.call('window', 'getSummary', ['s', 'p']);
		f.channel.dispose();
		await gate.complete(f.Service);
		await assert.rejects(pending, /Window disconnected/);
		assert.strictEqual(f.instances.length, 0);
		assert.throws(() => f.initialize(), /channel is disposed/);
	});

	test('idle session cleanup avoids loading but pending cleanup preserves operation order', async () => {
		const f = createFixture();
		void f.initialize();
		await f.channel.call('window', 'disposeSession', ['idle']);
		assert.strictEqual(f.channel.loadCount, 0);
		const gate = new DeferredPromise<typeof PlaywrightService>();
		f.channel.loader = () => gate.p;
		const first = f.channel.call('window', 'getSummary', ['s', 'p']);
		const cleanup = f.channel.call('window', 'disposeSession', ['s']);
		await gate.complete(f.Service);
		await Promise.all([first, cleanup]);
		assert.deepStrictEqual(f.instances[0].calls, [['summary', 's', 'p'], ['disposeSession', 's']]);
		f.channel.dispose();
		assert.strictEqual(f.instances[0].disposeCount, 1);
	});

	test('real first-use module loads and preserves method errors without launching a browser', async () => {
		const f = createFixture();
		void f.initialize();
		f.channel.useRealLoader();
		await assert.rejects(f.channel.call('window', 'unknownMethod'), /Method not found/);
		await f.channel.call('window', 'disposeSession', ['unused']);
	});
});
