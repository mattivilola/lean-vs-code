/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Diagnostic only: capture renderer startup marks without changing the paired benchmark.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LAUNCH_MODES, launchApp, readApp } from './launch.mjs';
import { createControlVSIX, installControlExtension } from './control-extension.mjs';

const positional = [];
let launchMode = 'direct';
let reuseProfile = false;
let chromiumTrace;
let windowBounds;
let reportDelayMs = 0;
for (let index = 2; index < process.argv.length; index++) {
	const arg = process.argv[index];
	if (arg === '--reuse-profile') {
		reuseProfile = true;
	} else if (arg === '--launch-mode' || arg === '--chromium-trace' || arg === '--window-bounds' || arg === '--report-delay-ms') {
		const value = process.argv[++index];
		if (!value) {
			throw new Error(`Expected a value after ${arg}.`);
		}
		if (arg === '--launch-mode') {
			launchMode = value;
		} else if (arg === '--chromium-trace') {
			chromiumTrace = path.resolve(value);
		} else if (arg === '--report-delay-ms') {
			reportDelayMs = Number(value);
			if (!Number.isSafeInteger(reportDelayMs) || reportDelayMs < 0 || reportDelayMs > 10_000) {
				throw new Error('--report-delay-ms must be an integer between 0 and 10000.');
			}
		} else {
			const match = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(value);
			if (!match) {
				throw new Error('--window-bounds must be x,y,width,height in macOS points.');
			}
			const [x, y, width, height] = match.slice(1).map(Number);
			if (![x, y, width, height].every(Number.isSafeInteger) || width < 400 || height < 270) {
				throw new Error('--window-bounds needs safe integer coordinates, width >= 400, and height >= 270.');
			}
			windowBounds = { x, y, width, height };
		}
	} else if (arg.startsWith('--')) {
		throw new Error(`Unknown option: ${arg}`);
	} else {
		positional.push(arg);
	}
}
const [appPath, fixturePath, outputPath] = positional;
if (!appPath || !fixturePath || !outputPath) {
	console.error('Usage: node scripts/lean-perf/trace-startup.mjs [--launch-mode direct|cli|finder] [--reuse-profile] [--window-bounds x,y,width,height] [--report-delay-ms 0..10000] [--chromium-trace <file>] <App.app> <file> <output.json>');
	process.exit(2);
}
if (!LAUNCH_MODES.includes(launchMode)) {
	throw new Error(`--launch-mode must be one of: ${LAUNCH_MODES.join(', ')}.`);
}

const app = readApp(appPath, 'trace', 'Trace app');
const workbenchHtml = fs.readFileSync(path.join(app.appPath, 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'), 'utf8');
const hasWorkbenchModulePreload = workbenchHtml.includes('<link rel="modulepreload" href="../../../workbench/workbench.desktop.main.js">');
const fixture = path.resolve(fixturePath);
const output = path.resolve(outputPath);
fs.accessSync(fixture, fs.constants.R_OK);
fs.mkdirSync(path.dirname(output), { recursive: true });
if (chromiumTrace) {
	if (fs.existsSync(chromiumTrace)) {
		throw new Error(`Chromium trace output already exists: ${chromiumTrace}`);
	}
	fs.mkdirSync(path.dirname(chromiumTrace), { recursive: true });
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

async function findWorkbenchTarget(port, child) {
	for (let attempt = 0; attempt < 150; attempt++) {
		if (!child.isRunning()) {
			throw new Error('App exited before the workbench opened.');
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
			const targets = await response.json();
			const target = targets.find(value => value.type === 'page' && value.url.includes('workbench'));
			if (target?.webSocketDebuggerUrl) {
				return target.webSocketDebuggerUrl;
			}
		} catch {
			// The debug endpoint is not ready yet.
		}
		await delay(200);
	}
	throw new Error('Timed out waiting for the workbench debug target.');
}

async function connectDebugger(url) {
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	let nextId = 0;
	return {
		async evaluate(expression) {
			const id = ++nextId;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					socket.removeEventListener('message', onMessage);
					reject(new Error('Timed out reading startup marks.'));
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
						resolve(message.result?.result?.value);
					}
				}
				socket.addEventListener('message', onMessage);
				socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
			});
		},
		close() { socket.close(); }
	};
}

const port = await availablePort();
const profile = fs.mkdtempSync('/private/tmp/lean-startup-trace-');
if (windowBounds) {
	const storagePath = path.join(profile, 'user-data', 'User', 'globalStorage', 'storage.json');
	fs.mkdirSync(path.dirname(storagePath), { recursive: true });
	fs.writeFileSync(storagePath, JSON.stringify({ windowsState: {
		lastActiveWindow: { uiState: { mode: 1, ...windowBounds } },
		openedWindows: []
	} }) + '\n');
}
if (reuseProfile) {
	fs.mkdirSync(path.join(profile, 'user-data', 'User'), { recursive: true });
	fs.writeFileSync(path.join(profile, 'user-data', 'User', 'settings.json'), JSON.stringify({ 'window.restoreWindows': 'none' }) + '\n');
}
const extensionPath = path.join(profile, 'trace-extension');
const traceMarkerFile = path.join(profile, 'trace-active');
const traceReadyFile = path.join(profile, 'trace-ready');
const warmupReadyFile = path.join(profile, 'warmup-ready');
const warmupQuitFile = path.join(profile, 'warmup-quit');
fs.mkdirSync(extensionPath);
fs.writeFileSync(path.join(extensionPath, 'package.json'), JSON.stringify({
	name: 'lean-startup-trace', publisher: 'lean-perf', version: '0.0.1',
	engines: { vscode: '^1.80.0' }, main: './extension.js',
	capabilities: { untrustedWorkspaces: { supported: true }, virtualWorkspaces: false },
	activationEvents: ['onStartupFinished']
}));
fs.writeFileSync(path.join(extensionPath, 'extension.js'), `
const fs = require('node:fs');
const vscode = require('vscode');
async function activate() {
  try {
    if (!fs.existsSync(${JSON.stringify(traceMarkerFile)})) {
      fs.writeFileSync(${JSON.stringify(warmupReadyFile)}, '');
      const quitPoll = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(warmupQuitFile)})) {
          clearInterval(quitPoll);
          vscode.commands.executeCommand('workbench.action.quit');
        }
      }, 100);
      return;
    }
    fs.writeFileSync(${JSON.stringify(traceReadyFile)}, JSON.stringify({ activatedAtEpochMs: Date.now() }));
    await new Promise(resolve => setTimeout(resolve, ${reportDelayMs}));
    await vscode.commands.executeCommand('perfview.show');
    for (let attempt = 0; attempt < 100; attempt++) {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.uri.scheme === 'perf') {
        const content = editor.document.getText();
        if (content.includes('## System Info') && content.length > 500) {
          fs.writeFileSync(${JSON.stringify(`${output}.perf.md`)}, content);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Startup Performance editor did not finish loading.');
  } catch (error) {
    fs.writeFileSync(${JSON.stringify(`${output}.perf.md.error`)}, String(error));
  }
}
module.exports = { activate };
`);
const vsix = createControlVSIX(extensionPath, `${output}.control.vsix`);
installControlExtension(app, vsix, profile);
let child;
let debuggerClient;
try {
	const args = [
		'--new-window',
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--shared-data-dir=${path.join(profile, 'shared-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		'--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry',
		`--remote-debugging-port=${port}`,
		...(chromiumTrace ? ['--trace-startup', `--trace-startup-file=${chromiumTrace}`, '--trace-startup-duration=10'] : []),
		fixture
	];
	if (reuseProfile) {
		const warmupPort = await availablePort();
		const warmupArgs = args.filter(arg => !arg.startsWith('--remote-debugging-port=') && !arg.startsWith('--trace-startup'));
		warmupArgs.push(`--remote-debugging-port=${warmupPort}`);
		const warmup = await launchApp(app, warmupArgs, { mode: launchMode, env: process.env, logPath: `${output}.warmup.app.log`, profileMarker: path.join(profile, 'user-data') });
		try {
			await warmup.rootPid();
			const target = await findWorkbenchTarget(warmupPort, warmup);
			const client = await connectDebugger(target);
			try {
				let loaded = false;
				for (let attempt = 0; attempt < 150; attempt++) {
					const marks = await client.evaluate('globalThis.MonacoPerformanceMarks?.getMarks() ?? []');
					if (marks.some(value => value.name === 'code/didLoadExtensions')) {
						loaded = true;
						break;
					}
					await delay(200);
				}
				if (!loaded) {
					throw new Error('Warm-up did not finish loading extensions.');
				}
				for (let attempt = 0; attempt < 75 && !fs.existsSync(warmupReadyFile); attempt++) {
					await delay(200);
				}
				if (!fs.existsSync(warmupReadyFile)) {
					throw new Error('Warm-up control extension did not activate.');
				}
				fs.writeFileSync(warmupQuitFile, '');
				for (let attempt = 0; attempt < 150 && warmup.isRunning(); attempt++) {
					await delay(100);
				}
				if (warmup.isRunning()) {
					throw new Error('Warm-up did not quit cleanly; established-profile cache state is unreliable.');
				}
			} finally {
				client.close();
			}
		} finally {
			await warmup.terminate();
		}
	}
	fs.writeFileSync(traceMarkerFile, '');
	child = await launchApp(app, args, { mode: launchMode, env: process.env, logPath: `${output}.app.log`, profileMarker: path.join(profile, 'user-data') });
	await child.rootPid();
	const targetUrl = await findWorkbenchTarget(port, child);
	debuggerClient = await connectDebugger(targetUrl);
	let marks = [];
	for (let attempt = 0; attempt < 150; attempt++) {
		marks = await debuggerClient.evaluate('globalThis.MonacoPerformanceMarks?.getMarks() ?? []');
		if (marks.some(value => value.name === 'code/didLoadExtensions')) {
			break;
		}
		await delay(200);
	}
	if (!marks.some(value => value.name === 'code/didLoadExtensions')) {
		throw new Error('Timed out waiting for extension-load completion mark.');
	}
	for (let attempt = 0; attempt < 150 && !fs.existsSync(traceReadyFile); attempt++) {
		if (!child.isRunning()) {
			throw new Error('App exited before the trace extension activated.');
		}
		await delay(200);
	}
	if (!fs.existsSync(traceReadyFile)) {
		throw new Error('Timed out waiting for trace extension activation.');
	}
	marks = await debuggerClient.evaluate('globalThis.MonacoPerformanceMarks?.getMarks() ?? []');
	const rendererTimeOrigin = await debuggerClient.evaluate('performance.timeOrigin');
	const resourceTimings = await debuggerClient.evaluate(`performance.getEntriesByType('resource').map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, startTime: entry.startTime, duration: entry.duration, responseEnd: entry.responseEnd, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize }))`);
	const navigationTimings = await debuggerClient.evaluate(`performance.getEntriesByType('navigation').map(entry => ({ startTime: entry.startTime, domInteractive: entry.domInteractive, domContentLoadedEventEnd: entry.domContentLoadedEventEnd, loadEventEnd: entry.loadEventEnd, duration: entry.duration }))`);
	const controlExtensionActivation = JSON.parse(fs.readFileSync(traceReadyFile, 'utf8'));
	fs.writeFileSync(output, JSON.stringify({ app: app.appPath, productCommit: app.commit, fixture, profile, launchMode, profileCondition: reuseProfile ? 'established' : 'fresh', windowBounds: windowBounds ?? null, hasWorkbenchModulePreload, controlExtensionInstall: 'vsix', spawnedAtEpochMs: child.spawnedAt, controlExtensionActivation, reportDelayMs, chromiumTrace: chromiumTrace ?? null, capturedAt: new Date().toISOString(), rendererTimeOrigin, marks, resourceTimings, navigationTimings }, null, 2) + '\n');
	console.log(`Captured ${marks.length} startup marks in ${output}`);
	for (let attempt = 0; attempt < 100 && !fs.existsSync(`${output}.perf.md`) && !fs.existsSync(`${output}.perf.md.error`); attempt++) {
		await delay(200);
	}
	if (fs.existsSync(`${output}.perf.md`)) {
		console.log(`Captured cross-process startup report in ${output}.perf.md`);
	} else {
		console.warn(`Cross-process report unavailable: ${output}.perf.md.error`);
	}
	if (chromiumTrace) {
		for (let attempt = 0; attempt < 75 && (!fs.existsSync(chromiumTrace) || fs.statSync(chromiumTrace).size === 0); attempt++) {
			await delay(200);
		}
		if (!fs.existsSync(chromiumTrace) || fs.statSync(chromiumTrace).size === 0) {
			throw new Error(`Chromium did not write startup trace: ${chromiumTrace}`);
		}
	}
} finally {
	debuggerClient?.close();
	await child?.terminate();
}
