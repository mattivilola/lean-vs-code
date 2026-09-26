/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Diagnostic only: capture renderer startup marks without changing the paired benchmark.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [appPath, fixturePath, outputPath] = process.argv.slice(2);
if (!appPath || !fixturePath || !outputPath) {
	console.error('Usage: node scripts/lean-perf/trace-startup.mjs <App.app> <file> <output.json>');
	process.exit(2);
}

const app = path.resolve(appPath);
const fixture = path.resolve(fixturePath);
const output = path.resolve(outputPath);
const product = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8'));
const executable = path.join(app, 'Contents/MacOS', product.nameShort);
fs.accessSync(executable, fs.constants.X_OK);
fs.accessSync(fixture, fs.constants.R_OK);
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

async function findWorkbenchTarget(port, child) {
	for (let attempt = 0; attempt < 150; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`App exited before the workbench opened: ${child.exitCode ?? child.signalCode}`);
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-startup-trace-'));
const extensionPath = path.join(profile, 'trace-extension');
fs.mkdirSync(extensionPath);
fs.writeFileSync(path.join(extensionPath, 'package.json'), JSON.stringify({
	name: 'lean-startup-trace', publisher: 'lean-perf', version: '0.0.1',
	engines: { vscode: '^1.80.0' }, main: './extension.js',
	activationEvents: ['onStartupFinished']
}));
fs.writeFileSync(path.join(extensionPath, 'extension.js'), `
const fs = require('node:fs');
const vscode = require('vscode');
async function activate() {
  try {
    await vscode.commands.executeCommand('perfview.show');
    for (let attempt = 0; attempt < 100; attempt++) {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.uri.scheme === 'perf') {
        const content = editor.document.getText();
        if (content.includes('## System Info') && content.length > 500) {
          fs.writeFileSync(process.env.LEAN_TRACE_PERF_OUTPUT, content);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Startup Performance editor did not finish loading.');
  } catch (error) {
    fs.writeFileSync(process.env.LEAN_TRACE_PERF_OUTPUT + '.error', String(error));
  }
}
module.exports = { activate };
`);
const log = fs.openSync(`${output}.app.log`, 'w');
let child;
let debuggerClient;
try {
	child = spawn(executable, [
		'--new-window',
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--shared-data-dir=${path.join(profile, 'shared-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		`--extensionDevelopmentPath=${extensionPath}`,
		'--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry',
		`--remote-debugging-port=${port}`,
		fixture
	], { stdio: ['ignore', log, log], env: { ...process.env, LEAN_TRACE_PERF_OUTPUT: `${output}.perf.md` } });
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
	fs.writeFileSync(output, JSON.stringify({ app, fixture, profile, capturedAt: new Date().toISOString(), marks }, null, 2) + '\n');
	console.log(`Captured ${marks.length} startup marks in ${output}`);
	for (let attempt = 0; attempt < 100 && !fs.existsSync(`${output}.perf.md`) && !fs.existsSync(`${output}.perf.md.error`); attempt++) {
		await delay(200);
	}
	if (fs.existsSync(`${output}.perf.md`)) {
		console.log(`Captured cross-process startup report in ${output}.perf.md`);
	} else {
		console.warn(`Cross-process report unavailable: ${output}.perf.md.error`);
	}
} finally {
	debuggerClient?.close();
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill('SIGTERM');
		await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(3000)]);
	}
	fs.closeSync(log);
}
