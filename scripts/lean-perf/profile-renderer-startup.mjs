/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Diagnostic only: attach to the first renderer as it starts and sample V8
// until the workbench reports that installed extensions are registered.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [appPath, outputPath] = process.argv.slice(2);
if (!appPath || !outputPath) {
	console.error('Usage: node scripts/lean-perf/profile-renderer-startup.mjs <App.app> <output.json>');
	process.exit(2);
}

const app = path.resolve(appPath);
const output = path.resolve(outputPath);
const product = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8'));
const executable = path.join(app, 'Contents/MacOS', product.nameShort);
fs.accessSync(executable, fs.constants.X_OK);
fs.mkdirSync(path.dirname(output), { recursive: true });

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

const port = await availablePort();
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-renderer-profile-'));
const fixture = path.join(profileDir, 'fixture.txt');
fs.writeFileSync(fixture, 'Lean VS Code renderer profile\n'.repeat(3600));
const log = fs.openSync(`${output}.app.log`, 'w');
let child;
let client;
try {
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

	let rendererSession;
	let attachedAt;
	let profilerStartedAt;
	let profilerStartedResolve;
	let profilerStartedReject;
	const profilerStarted = new Promise((resolve, reject) => {
		profilerStartedResolve = resolve;
		profilerStartedReject = reject;
	});
	client.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
		void (async () => {
			if (targetInfo.type === 'page' && !rendererSession) {
				rendererSession = sessionId;
				attachedAt = new Date().toISOString();
				console.log(`Attached to page target: ${targetInfo.url || '(new page)'}`);
				await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
				await client.send('Profiler.enable', {}, sessionId);
				await client.send('Profiler.start', {}, sessionId);
				profilerStartedAt = new Date().toISOString();
				profilerStartedResolve();
			} else {
				await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
			}
		})().catch(profilerStartedReject);
	});
	await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
	await Promise.race([profilerStarted, delay(15000).then(() => { throw new Error('No renderer attached for profiling.'); })]);

	let marks;
	for (let attempt = 0; attempt < 250; attempt++) {
		const response = await client.send('Runtime.evaluate', {
			expression: 'globalThis.MonacoPerformanceMarks?.getMarks() ?? []',
			returnByValue: true
		}, rendererSession);
		marks = response.result?.value;
		if (Array.isArray(marks) && marks.some(mark => mark.name === 'code/didLoadExtensions')) {
			break;
		}
		await delay(100);
	}
	if (!Array.isArray(marks) || !marks.some(mark => mark.name === 'code/didLoadExtensions')) {
		throw new Error('Timed out waiting for extension registration completion.');
	}
	const { profile } = await client.send('Profiler.stop', {}, rendererSession);
	if (!profile?.nodes?.length || !profile?.samples?.length) {
		throw new Error('Renderer CPU profile contained no samples.');
	}
	fs.writeFileSync(output, JSON.stringify({
		kind: 'renderer-startup-cpu-diagnostic',
		app,
		productCommit: product.commit,
		attachedAt,
		profilerStartedAt,
		capturedAt: new Date().toISOString(),
		fixtureBytes: fs.statSync(fixture).size,
		profile,
		marks
	}, null, 2) + '\n');
	console.log(`Captured ${profile.samples.length} V8 samples and ${marks.length} workbench marks in ${output}`);
} finally {
	client?.close();
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill('SIGTERM');
		await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(3000)]);
	}
	fs.closeSync(log);
}
