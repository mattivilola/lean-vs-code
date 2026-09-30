/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Diagnostic only: attach to the workbench renderer and sample V8
// until the workbench reports that installed extensions are registered.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseWindowBounds, seedWindowBounds } from './benchmark.mjs';

function usage() {
	return 'Usage: node scripts/lean-perf/profile-renderer-startup.mjs [--window-bounds x,y,w,h] <App.app> <output.json>';
}

export function parseArgs(argv) {
	const positional = [];
	let windowBounds;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--window-bounds') {
			windowBounds = parseWindowBounds(argv[++i] ?? '');
		} else if (argv[i] === '--help' || argv[i] === '-h') {
			return { help: true };
		} else if (argv[i].startsWith('-')) {
			throw new Error(`Unknown option: ${argv[i]}`);
		} else {
			positional.push(argv[i]);
		}
	}
	if (positional.length !== 2) {
		throw new Error('Provide exactly an app path and an output path.');
	}
	return { app: path.resolve(positional[0]), output: path.resolve(positional[1]), windowBounds };
}

function isBlankURL(url) {
	return !url || url === 'about:blank';
}

function isWorkbenchURL(url) {
	try {
		const parsed = new URL(url);
		return ['file:', 'vscode-file:'].includes(parsed.protocol)
			&& parsed.pathname.endsWith('/vs/code/electron-browser/workbench/workbench.html');
	} catch {
		return false;
	}
}

async function readRendererState(client, sessionId) {
	const response = await client.send('Runtime.evaluate', {
		expression: '({ url: globalThis.location.href, marks: globalThis.MonacoPerformanceMarks?.getMarks() ?? [], rendererTimeOrigin: globalThis.performance.timeOrigin })',
		returnByValue: true
	}, sessionId);
	// An initial about:blank document can disappear during navigation. Poll again.
	return response.exceptionDetails ? undefined : response.result?.value;
}

/** Start sampling before resuming, then verify the target is the editor rather than a utility page. */
export async function startRendererProfiler(client, attachment, { attempts = 150, poll = () => delay(100), now = () => new Date().toISOString() } = {}) {
	const { sessionId, targetInfo, waitingForDebugger } = attachment;
	if (targetInfo.type !== 'page' || (!isBlankURL(targetInfo.url) && !isWorkbenchURL(targetInfo.url))) {
		await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
		return undefined;
	}
	const attachedAt = now();
	let profilerStartedAt;
	try {
		await client.send('Profiler.enable', {}, sessionId);
		await client.send('Profiler.start', {}, sessionId);
		profilerStartedAt = now();
	} finally {
		// Never leave a task-owned target paused if profiler setup fails.
		await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
	}
	for (let attempt = 0; attempt < attempts; attempt++) {
		const state = await readRendererState(client, sessionId);
		if (state && isWorkbenchURL(state.url)) {
			return {
				sessionId, targetId: targetInfo.targetId, targetURL: state.url, attachedAt, profilerStartedAt,
				waitingForDebugger: waitingForDebugger === true,
				captureCoverage: waitingForDebugger === true ? 'paused-renderer-at-attach' : 'partial-renderer-already-running'
			};
		}
		if (state && !isBlankURL(state.url)) {
			await client.send('Profiler.stop', {}, sessionId);
			return undefined;
		}
		await poll();
	}
	await client.send('Profiler.stop', {}, sessionId);
	return undefined;
}

async function withTimeout(promise, timeoutMs, message) {
	let timer;
	try {
		return await Promise.race([promise, new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		})]);
	} finally {
		clearTimeout(timer);
	}
}

async function availablePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(address.port));
		});
	});
}

async function browserDebuggerUrl(port, child) {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`App exited before its debugger opened: ${child.exitCode ?? child.signalCode}`);
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(250) });
			const version = await response.json();
			if (version.webSocketDebuggerUrl) {
				return version.webSocketDebuggerUrl;
			}
		} catch {
			// The browser process has not started its debugging endpoint yet.
		}
		await delay(10);
	}
	throw new Error('Timed out waiting for the browser debugging endpoint.');
}

class DebuggerClient {
	constructor(url) {
		this.socket = new WebSocket(url);
		this.pending = new Map();
		this.listeners = new Map();
		this.nextId = 0;
		this.socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);
			if (message.id) {
				const pending = this.pending.get(message.id);
				if (!pending) {
					return;
				}
				this.pending.delete(message.id);
				clearTimeout(pending.timer);
				if (message.error) {
					pending.reject(new Error(`${pending.method}: ${message.error.message}`));
				} else {
					pending.resolve(message.result);
				}
				return;
			}
			for (const listener of this.listeners.get(message.method) ?? []) {
				listener(message.params ?? {}, message.sessionId);
			}
		});
	}

	async open() {
		await new Promise((resolve, reject) => {
			this.socket.addEventListener('open', resolve, { once: true });
			this.socket.addEventListener('error', reject, { once: true });
		});
	}

	on(method, listener) {
		const listeners = this.listeners.get(method) ?? [];
		listeners.push(listener);
		this.listeners.set(method, listeners);
	}

	send(method, params = {}, sessionId) {
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out.`));
			}, 10000);
			this.pending.set(id, { resolve, reject, timer, method });
			this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	}

	close() {
		this.socket.close();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Debugger connection closed.'));
		}
		this.pending.clear();
	}
}

async function run({ app, output, windowBounds }) {
	const product = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8'));
	const executable = path.join(app, 'Contents/MacOS', product.nameShort);
	fs.accessSync(executable, fs.constants.X_OK);
	fs.mkdirSync(path.dirname(output), { recursive: true });
	const port = await availablePort();
	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-renderer-profile-'));
	seedWindowBounds(profileDir, windowBounds);
	const fixture = path.join(profileDir, 'fixture.txt');
	fs.writeFileSync(fixture, 'Lean VS Code renderer profile\n'.repeat(3600));
	const log = fs.openSync(`${output}.app.log`, 'w');
	let child;
	let client;
	try {
		const spawnedAtEpochMs = Date.now();
		child = spawn(executable, [
			'--new-window',
			`--user-data-dir=${path.join(profileDir, 'user-data')}`,
			`--shared-data-dir=${path.join(profileDir, 'shared-data')}`,
			`--extensions-dir=${path.join(profileDir, 'extensions')}`,
			'--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry',
			`--remote-debugging-port=${port}`,
			fixture
		], { stdio: ['ignore', log, log] });
		client = new DebuggerClient(await browserDebuggerUrl(port, child));
		await client.open();

		let selectedRenderer;
		let rendererResolve;
		let rendererReject;
		const rendererReady = new Promise((resolve, reject) => {
			rendererResolve = resolve;
			rendererReject = reject;
		});
		client.on('Target.attachedToTarget', attachment => {
			void (async () => {
				if (selectedRenderer) {
					await client.send('Runtime.runIfWaitingForDebugger', {}, attachment.sessionId);
					return;
				}
				const renderer = await startRendererProfiler(client, attachment);
				if (!renderer) {
					return;
				}
				if (selectedRenderer) {
					await client.send('Profiler.stop', {}, renderer.sessionId);
					return;
				}
				selectedRenderer = renderer;
				rendererResolve(renderer);
			})().catch(rendererReject);
		});
		// The listener is already installed: existing targets can attach immediately.
		const [, renderer] = await withTimeout(Promise.all([
			client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }), rendererReady
		]), 15000, 'No verified workbench renderer attached for profiling.');
		console.log(`Profiling ${renderer.targetURL} (${renderer.captureCoverage})`);

		let state;
		for (let attempt = 0; attempt < 250; attempt++) {
			state = await readRendererState(client, renderer.sessionId);
			if (state && !isWorkbenchURL(state.url)) {
				throw new Error('Profiled target navigated away from the workbench.');
			}
			if (Array.isArray(state?.marks) && state.marks.some(mark => mark.name === 'code/didLoadExtensions')) {
				break;
			}
			await delay(100);
		}
		if (!Array.isArray(state?.marks) || !state.marks.some(mark => mark.name === 'code/didLoadExtensions')) {
			throw new Error('Timed out waiting for extension registration completion.');
		}
		const { profile } = await client.send('Profiler.stop', {}, renderer.sessionId);
		if (!profile?.nodes?.length || !profile?.samples?.length) {
			throw new Error('Renderer CPU profile contained no samples.');
		}
		fs.writeFileSync(output, JSON.stringify({
			kind: 'renderer-startup-cpu-diagnostic', app, productCommit: product.commit,
			launchMode: 'direct', profileCondition: 'fresh', windowBounds: windowBounds ?? null,
			spawnedAtEpochMs, ...renderer, rendererTimeOrigin: state.rendererTimeOrigin,
			fullAppStartupCaptured: false,
			endpoint: 'code/didLoadExtensions (extension registration, not activation or file editability)',
			capturedAt: new Date().toISOString(), fixtureBytes: fs.statSync(fixture).size,
			profile, marks: state.marks
		}, null, 2) + '\n');
		console.log(`Captured ${profile.samples.length} V8 samples and ${state.marks.length} workbench marks in ${output}`);
	} finally {
		client?.close();
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
			try {
				await withTimeout(new Promise(resolve => child.once('close', resolve)), 3000, 'App did not exit after SIGTERM.');
			} catch (error) {
				console.error(`Task-owned diagnostic app PID ${child.pid}: ${error.message}`);
			}
		}
		fs.closeSync(log);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) {
			console.log(usage());
		} else {
			await run(options);
		}
	} catch (error) {
		console.error(`${error.message}\n${usage()}`);
		process.exitCode = 1;
	}
}
