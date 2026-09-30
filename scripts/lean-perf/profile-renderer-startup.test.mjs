/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseArgs, startRendererProfiler } from './profile-renderer-startup.mjs';

const workbenchURL = 'vscode-file://vscode-app/fixture/out/vs/code/electron-browser/workbench/workbench.html';
const attachment = {
	sessionId: 'renderer-session', waitingForDebugger: true,
	targetInfo: { targetId: 'renderer-target', type: 'page', url: workbenchURL }
};
const options = { attempts: 3, poll: async () => {}, now: () => 'test-clock' };

function debuggerMock(states = [{ url: workbenchURL }], failMethod) {
	const calls = [];
	return {
		calls,
		async send(method, params, sessionId) {
			calls.push({ method, params, sessionId });
			if (method === failMethod) {
				throw new Error(`${method} rejected`);
			}
			if (method === 'Runtime.evaluate') {
				const state = states.shift();
				return state?.exceptionDetails ? state : { result: { value: state } };
			}
			return {};
		}
	};
}

test('accepts compact bounds and rejects malformed or unsupported arguments before app access', () => {
	assert.deepEqual(parseArgs(['--window-bounds', '16,546,560,360', 'Lean.app', 'profile.json']), {
		app: path.resolve('Lean.app'), output: path.resolve('profile.json'),
		windowBounds: { x: 16, y: 546, width: 560, height: 360 }
	});
	for (const argv of [[], ['Lean.app'], ['Lean.app', 'profile.json', 'extra'], ['--unknown'],
		['--window-bounds'], ['--window-bounds', '0,0,20,20', 'Lean.app', 'profile.json']]) {
		assert.throws(() => parseArgs(argv));
	}
	assert.deepEqual(parseArgs(['--help']), { help: true });
});

test('starts the profiler before releasing a paused renderer and preserves the session', async () => {
	const client = debuggerMock();
	assert.deepEqual(await startRendererProfiler(client, attachment, options), {
		sessionId: 'renderer-session', targetId: 'renderer-target', targetURL: workbenchURL,
		attachedAt: 'test-clock', profilerStartedAt: 'test-clock', waitingForDebugger: true,
		captureCoverage: 'paused-renderer-at-attach'
	});
	assert.deepEqual(client.calls.map(({ method, sessionId }) => [method, sessionId]), [
		['Profiler.enable', 'renderer-session'], ['Profiler.start', 'renderer-session'],
		['Runtime.runIfWaitingForDebugger', 'renderer-session'], ['Runtime.evaluate', 'renderer-session']
	]);
});

test('labels a renderer that was already running as a partial capture', async () => {
	const result = await startRendererProfiler(debuggerMock(), { ...attachment, waitingForDebugger: false }, options);
	assert.deepEqual([result.waitingForDebugger, result.captureCoverage], [false, 'partial-renderer-already-running']);
});

test('resumes known utility and external page targets without profiling them', async () => {
	for (const targetInfo of [
		{ ...attachment.targetInfo, type: 'worker' },
		{ ...attachment.targetInfo, url: 'vscode-file://vscode-app/shared-process.html' },
		{ ...attachment.targetInfo, url: `https://example.org${new URL(workbenchURL).pathname}` }
	]) {
		const client = debuggerMock();
		assert.equal(await startRendererProfiler(client, { ...attachment, targetInfo }, options), undefined);
		assert.deepEqual(client.calls.map(call => call.method), ['Runtime.runIfWaitingForDebugger']);
	}
});

test('an initially blank target is accepted only after it becomes the actual workbench', async () => {
	const client = debuggerMock([{ url: 'about:blank' }, { exceptionDetails: { text: 'Navigation in progress' } }, { url: workbenchURL }]);
	const result = await startRendererProfiler(client, {
		...attachment, targetInfo: { ...attachment.targetInfo, url: '' }
	}, options);
	assert.equal(result.targetURL, workbenchURL);
	assert.equal(client.calls.filter(call => call.method === 'Runtime.evaluate').length, 3);
});

test('stops and discards a blank target that navigates to a utility page', async () => {
	const client = debuggerMock([{ url: 'about:blank' }, { url: 'vscode-file://vscode-app/shared-process.html' }]);
	const result = await startRendererProfiler(client, {
		...attachment, targetInfo: { ...attachment.targetInfo, url: 'about:blank' }
	}, options);
	assert.equal(result, undefined);
	assert.deepEqual(client.calls.map(call => call.method), [
		'Profiler.enable', 'Profiler.start', 'Runtime.runIfWaitingForDebugger',
		'Runtime.evaluate', 'Runtime.evaluate', 'Profiler.stop'
	]);
});

test('always resumes the target and reports an error if profiler setup fails', async () => {
	for (const failMethod of ['Profiler.enable', 'Profiler.start']) {
		const client = debuggerMock([], failMethod);
		await assert.rejects(startRendererProfiler(client, attachment, options), new RegExp(`${failMethod} rejected`));
		assert.equal(client.calls.at(-1).method, 'Runtime.runIfWaitingForDebugger');
		assert.equal(client.calls.some(call => call.method === 'Runtime.evaluate'), false);
	}
});

test('stops sampling after bounded blank-target polling instead of accepting an unrelated page', async () => {
	const client = debuggerMock([{ url: 'about:blank' }, { url: '' }, undefined]);
	assert.equal(await startRendererProfiler(client, attachment, options), undefined);
	assert.deepEqual(client.calls.map(call => call.method), [
		'Profiler.enable', 'Profiler.start', 'Runtime.runIfWaitingForDebugger',
		'Runtime.evaluate', 'Runtime.evaluate', 'Runtime.evaluate', 'Profiler.stop'
	]);
});
