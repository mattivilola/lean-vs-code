/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { LazyQuickChatService } from '../../browser/lazyQuickChatService.js';
import type { QuickChatService } from '../../../chat/browser/widgetHosts/chatQuick.js';
import { IChatService } from '../../../chat/common/chatService/chatService.js';

suite('LazyQuickChatService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness() {
		const calls: { kind: string; options?: unknown }[] = [];
		const closeEmitter = disposables.add(new Emitter<void>());
		const delegate = {
			onDidClose: closeEmitter.event,
			focused: false,
			sessionResource: undefined,
			toggle: (options?: unknown) => calls.push({ kind: 'toggle', options }),
			open: (options?: unknown) => calls.push({ kind: 'open', options }),
			focus: () => calls.push({ kind: 'focus' }),
			close: () => calls.push({ kind: 'close' }),
			openInChatView: () => calls.push({ kind: 'openInChatView' }),
			dispose: () => calls.push({ kind: 'dispose' })
		} as unknown as QuickChatService;
		let resolveModule!: (value: typeof import('../../../chat/browser/widgetHosts/chatQuick.js')) => void;
		let rejectModule!: (error: Error) => void;
		const module = new Promise<typeof import('../../../chat/browser/widgetHosts/chatQuick.js')>((resolve, reject) => {
			resolveModule = resolve;
			rejectModule = reject;
		});
		class TestService extends LazyQuickChatService {
			protected override loadQuickChatModule() { return module; }
		}
		let constructions = 0;
		const instantiationService = { createInstance: () => { constructions++; return delegate; } } as unknown as IInstantiationService;
		const chatService = { isEnabled: () => true } as unknown as IChatService;
		const errors: unknown[] = [];
		const logService = { error: (...values: unknown[]) => errors.push(values) } as unknown as ILogService;
		const service = disposables.add(new TestService(instantiationService, chatService, logService));
		return {
			service, calls, errors,
			get constructions() { return constructions; },
			async resolve() {
				resolveModule({ QuickChatService: class { } as unknown as typeof QuickChatService });
				await module;
				await Promise.resolve();
			},
			async reject() {
				rejectModule(new Error('load failed'));
				try { await module; } catch { /* expected */ }
				await new Promise(resolve => setTimeout(resolve, 0));
			}
		};
	}

	test('replays a partial-query toggle through the original toggle method', async () => {
		const harness = createHarness();
		const options = { query: 'partial', isPartialQuery: true };
		harness.service.toggle(options);
		await harness.resolve();
		assert.deepStrictEqual(harness.calls, [{ kind: 'toggle', options }]);
	});

	test('a second toggle closes before the renderer loads', async () => {
		const harness = createHarness();
		let closes = 0;
		disposables.add(harness.service.onDidClose(() => closes++));
		harness.service.toggle();
		harness.service.toggle();
		await harness.resolve();
		assert.strictEqual(closes, 1);
		assert.strictEqual(harness.constructions, 0);
	});

	test('preserves submitted query and later focus while loading', async () => {
		const harness = createHarness();
		const options = { query: 'submit' };
		harness.service.open(options);
		harness.service.open();
		harness.service.focus();
		await harness.resolve();
		assert.deepStrictEqual(harness.calls, [
			{ kind: 'open', options }, { kind: 'open', options: undefined }, { kind: 'focus' }
		]);
	});

	test('cancels pending transfer on close and allows a later open', async () => {
		const harness = createHarness();
		let closes = 0;
		disposables.add(harness.service.onDidClose(() => closes++));
		harness.service.open({ query: 'old' });
		harness.service.openInChatView();
		harness.service.close();
		harness.service.open({ query: 'new' });
		await harness.resolve();
		assert.strictEqual(closes, 1);
		assert.deepStrictEqual(harness.calls, [{ kind: 'open', options: { query: 'new' } }]);
	});

	test('does not construct Quick Chat after disposal', async () => {
		const harness = createHarness();
		harness.service.open({ query: 'cancelled' });
		harness.service.dispose();
		await harness.resolve();
		assert.strictEqual(harness.constructions, 0);
	});

	test('reports a failed dynamic load and closes the pending request', async () => {
		const harness = createHarness();
		let closes = 0;
		disposables.add(harness.service.onDidClose(() => closes++));
		harness.service.open({ query: 'unavailable' });
		await harness.reject();
		assert.strictEqual(harness.errors.length, 1);
		assert.strictEqual(closes, 1);
		assert.strictEqual(harness.constructions, 0);
	});
});
