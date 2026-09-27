/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Diagnostic: stopped-process launch until the requested file's text is visible
// in the Monaco editor DOM, optionally followed by a verified synthetic edit.
// Keep both endpoints separate from the extension-backed edit probe.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { percentile, readApp } from './benchmark.mjs';

const valueOptions = new Set(['--lean-app', '--oss-app', '--base-revision', '--samples', '--output-root']);
const options = {};
for (let index = 2; index < process.argv.length; index++) {
	const key = process.argv[index];
	if (key === '--input-probe') {
		options[key] = true;
		continue;
	}
	const value = process.argv[++index];
	if (!valueOptions.has(key) || !value || value.startsWith('--')) {
		throw new Error(`Expected one value after ${key}.`);
	}
	options[key] = value;
}
for (const required of ['--lean-app', '--oss-app', '--base-revision']) {
	if (!options[required]) {
		throw new Error(`Missing ${required}.`);
	}
}
if (!/^[0-9a-f]{40}$/i.test(options['--base-revision'])) {
	throw new Error('--base-revision must be a 40-character Git SHA.');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
	throw new Error('This benchmark requires macOS Apple Silicon.');
}
const count = Number(options['--samples'] ?? 30);
if (!Number.isSafeInteger(count) || count < 1) {
	throw new Error('--samples must be a positive integer.');
}
const inputProbe = options['--input-probe'] === true;

const apps = [
	readApp(options['--lean-app'], 'lean', 'Lean VS Code'),
	readApp(options['--oss-app'], 'code-oss', 'Code-OSS')
];
const runDir = path.join(path.resolve(options['--output-root'] ?? '.build/lean-artifacts/visible-file-benchmarks'), `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`);
fs.mkdirSync(runDir, { recursive: true });
const rawPath = path.join(runDir, 'samples.jsonl');
fs.writeFileSync(rawPath, '');
fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
	createdAt: new Date().toISOString(),
	definition: inputProbe
		? 'Stopped-process spawn until synthetic text sent through Chrome DevTools Protocol appears in the requested file\'s visible Monaco editor line. The input is not saved. This tests UI edit response, not extension-host API readiness, a physical keyboard, or display photons.'
		: 'Stopped-process spawn to the requested unique text being visible in a nonzero-size Monaco editor view-lines DOM element, detected through the Chrome DevTools Protocol. This is a DOM visibility proxy, not an editable-file or hardware photon timestamp.',
	inputProbe,
	comparisonBaseRevision: options['--base-revision'],
	machine: { platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model, osRelease: os.release() },
	samplesPerApp: count,
	apps: apps.map(({ key, version, commit }) => ({ key, version, commit }))
}, null, 2) + '\n');

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

async function findWorkbenchTarget(port, child) {
	for (let attempt = 0; attempt < 150; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`App exited before opening a workbench: ${child.exitCode ?? child.signalCode}`);
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
			const targets = await response.json();
			const target = targets.find(value => value.type === 'page' && value.url.includes('workbench'));
			if (target?.webSocketDebuggerUrl) {
				return target.webSocketDebuggerUrl;
			}
		} catch {
			// The debugging endpoint may not exist until the first window starts.
		}
		await delay(20);
	}
	throw new Error('Timed out waiting for the workbench debugging target.');
}

async function connectDebugger(url) {
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	let nextId = 0;
	return {
		async send(method, params) {
			const id = ++nextId;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					socket.removeEventListener('message', onMessage);
					reject(new Error(`Timed out waiting for ${method}.`));
				}, 5000);
				function onMessage(event) {
					const message = JSON.parse(event.data);
					if (message.id !== id) {
						return;
					}
					clearTimeout(timer);
					socket.removeEventListener('message', onMessage);
					if (message.error || message.result?.exceptionDetails) {
						reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
					} else {
						resolve(message.result);
					}
				}
				socket.addEventListener('message', onMessage);
				socket.send(JSON.stringify({ id, method, params }));
			});
		},
		async evaluate(expression) {
			const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
			return result?.result?.value;
		},
		close() { socket.close(); }
	};
}

async function trial(app, index, order, warmup = false) {
	const name = `${warmup ? 'warmup' : String(index).padStart(3, '0')}-${app.key}`;
	// VS Code's macOS IPC socket has a strict path-length limit.
	const profile = fs.mkdtempSync('/private/tmp/lean-visible-');
	const fixture = path.join(runDir, 'fixtures', `${name}.txt`);
	fs.mkdirSync(path.dirname(fixture), { recursive: true });
	const marker = `LEAN_VISIBLE_${randomUUID().replaceAll('-', '')}`;
	const typedMarker = `LEAN_TYPED_${randomUUID().replaceAll('-', '')}`;
	fs.writeFileSync(fixture, `${marker}\n${'editor content\n'.repeat(7300)}`);
	const port = await availablePort();
	const logPath = path.join(runDir, `${name}.app.log`);
	const log = fs.openSync(logPath, 'w');
	const launchedAt = Date.now();
	const child = spawn(app.executable, [
		'--new-window',
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--shared-data-dir=${path.join(profile, 'shared-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		'--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry',
		`--remote-debugging-port=${port}`,
		fixture
	], { stdio: ['ignore', log, log] });
	fs.closeSync(log);
	let client;
	let elapsedMs = null;
	let error;
	try {
		client = await connectDebugger(await findWorkbenchTarget(port, child));
		const expression = `Array.from(document.querySelectorAll('.monaco-editor .view-lines')).some(el => el.textContent?.includes(${JSON.stringify(marker)}) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)`;
		const typedExpression = `Array.from(document.querySelectorAll('.monaco-editor .view-lines')).some(el => el.textContent?.includes(${JSON.stringify(typedMarker)}) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)`;
		const deadline = Date.now() + 30000;
		let visible = false;
		let inputAttempts = 0;
		while (Date.now() < deadline) {
			if (!visible) {
				visible = !!await client.evaluate(expression);
				if (visible && !inputProbe) {
					elapsedMs = Date.now() - launchedAt;
					break;
				}
			}
			if (visible && inputProbe) {
				if (await client.evaluate(typedExpression)) {
					elapsedMs = Date.now() - launchedAt;
					break;
				}
				const focused = await client.evaluate(`(() => { const input = document.querySelector('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea'); if (input) input.focus(); return document.activeElement === input || document.activeElement?.classList.contains('native-edit-context'); })()`);
				if (focused) {
					inputAttempts++;
					await client.send('Input.insertText', { text: typedMarker });
				}
			}
			if (child.exitCode !== null || child.signalCode !== null) {
				throw new Error(`App exited before requested content appeared: ${child.exitCode ?? child.signalCode}`);
			}
			await delay(20);
		}
		if (elapsedMs === null) {
			const diagnostic = inputProbe ? await client.evaluate(`({ inputCount: document.querySelectorAll('.monaco-editor textarea.inputarea, .monaco-editor .native-edit-context').length, activeClass: document.activeElement?.className, typedVisible: Array.from(document.querySelectorAll('.monaco-editor .view-lines')).some(el => el.textContent?.includes(${JSON.stringify(typedMarker)})) })`) : undefined;
			throw new Error(inputProbe ? `Timed out waiting for a verified synthetic edit in the visible Monaco editor (visible=${visible}, inputAttempts=${inputAttempts}, diagnostic=${JSON.stringify(diagnostic)}).` : 'Timed out waiting for requested text in visible Monaco editor lines.');
		}
	} catch (caught) {
		error = String(caught?.stack ?? caught);
	} finally {
		client?.close();
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGTERM');
			await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(3000)]);
		}
	}
	const sample = { subject: app.key, sample: index, order, warmup, elapsedMs, ...(error ? { error, appLog: logPath } : {}) };
	fs.appendFileSync(rawPath, JSON.stringify(sample) + '\n');
	return sample;
}

console.log(`Writing ${inputProbe ? 'first UI edit' : 'visible-file'} benchmark to ${runDir}`);
for (const app of apps) {
	const sample = await trial(app, 0, 0, true);
	console.log(`${app.key} warmup: ${sample.elapsedMs ?? sample.error}`);
	if (sample.error) {
		process.exitCode = 1;
		break;
	}
}
if (!process.exitCode) {
	const samples = [];
	for (let index = 1; index <= count; index++) {
		for (const [order, app] of (index % 2 ? apps : [...apps].reverse()).entries()) {
			const sample = await trial(app, index, order + 1);
			samples.push(sample);
			console.log(`${app.key} ${index}/${count}: ${sample.elapsedMs ?? sample.error}`);
		}
	}
	const metrics = {};
	for (const app of apps) {
		const values = samples.filter(sample => sample.subject === app.key && sample.elapsedMs !== null).map(sample => sample.elapsedMs);
		metrics[app.key] = { count: values.length, failed: count - values.length, p50: values.length ? percentile(values, 0.5) : null, p95: values.length ? percentile(values, 0.95) : null };
	}
	fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ metrics }, null, 2) + '\n');
	console.log(JSON.stringify(metrics, null, 2));
	if (Object.values(metrics).some(metric => metric.failed)) {
		process.exitCode = 1;
	}
}
