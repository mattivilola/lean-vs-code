/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_ROOT = path.join(SCRIPT_DIR, 'results');
const FIXTURE_BYTES = 100 * 1024;
const READY_TIMEOUT_MS = 120_000;
const MEMORY_IDLE_MS = 30_000;
const MEMORY_SAMPLES = 3;
const EXISTING_WINDOW_WARMUP_MS = 5_000;
const GIT_WORKSPACE_FILES = 10_000;

const SUBJECTS = [
	{ key: 'lean', label: 'Lean VS Code', option: '--lean-app' },
	{ key: 'code-oss', label: 'Code-OSS', option: '--oss-app' }
];

/** @typedef {{ pid: number, ppid: number, rssKiB: number, name: string }} ProcessRow */

function usage() {
	return `Usage:
  node scripts/lean-perf/benchmark.mjs --lean-app <Lean.app> --oss-app <Code-OSS.app> --base-revision <40-char-sha> [options]

Options:
  --samples <n>                 Startup and existing-window samples per product (default: 30)
  --memory-samples <n>          Idle process-tree memory snapshots per product (default: 3)
  --memory-idle-ms <n>          Wait after editable file readiness before memory sampling (default: 30000)
  --output-root <path>          Parent directory for a unique results directory
  --lean-label <text>           Display label for the first app (default: Lean VS Code)
  --oss-label <text>            Display label for the comparison app (default: Code-OSS)
  --git-workspace               Open the fixture inside a generated Git workspace
  --startup-timeout-ms <n>      Maximum wait for an editable editor (default: 120000)
  --dry-run                     Validate apps and print the plan without launching them
  -h, --help                    Show this help

Run node scripts/lean-perf/smoke.mjs for the no-app smoke check.`;
}

function parseArgs(argv) {
	const result = {
		leanApp: undefined,
		ossApp: undefined,
		baseRevision: undefined,
		samples: 30,
		memorySamples: MEMORY_SAMPLES,
		memoryIdleMs: MEMORY_IDLE_MS,
		outputRoot: DEFAULT_OUTPUT_ROOT,
		leanLabel: 'Lean VS Code',
		ossLabel: 'Code-OSS',
		gitWorkspace: false,
		startupTimeoutMs: READY_TIMEOUT_MS,
		dryRun: false,
		help: false
	};
	const valueOptions = new Map([
		['--lean-app', 'leanApp'],
		['--oss-app', 'ossApp'],
		['--base-revision', 'baseRevision'],
		['--samples', 'samples'],
		['--memory-samples', 'memorySamples'],
		['--memory-idle-ms', 'memoryIdleMs'],
		['--output-root', 'outputRoot'],
		['--lean-label', 'leanLabel'],
		['--oss-label', 'ossLabel'],
		['--startup-timeout-ms', 'startupTimeoutMs']
	]);

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '-h' || arg === '--help') {
			result.help = true;
			continue;
		}
		if (arg === '--dry-run') {
			result.dryRun = true;
			continue;
		}
		if (arg === '--git-workspace') {
			result.gitWorkspace = true;
			continue;
		}
		const key = valueOptions.get(arg);
		if (!key) {
			throw new Error(`Unknown option: ${arg}`);
		}
		const value = argv[++index];
		if (!value || value.startsWith('--')) {
			throw new Error(`Expected a value after ${arg}`);
		}
		result[key] = key === 'samples' || key === 'memorySamples' || key === 'memoryIdleMs' || key === 'startupTimeoutMs'
			? parsePositiveInteger(value, arg)
			: value;
	}
	return result;
}

function parsePositiveInteger(value, option) {
	if (!/^\d+$/.test(value) || Number(value) < 1) {
		throw new Error(`${option} must be a positive integer.`);
	}
	return Number(value);
}

function validateOptions(options) {
	if (!options.leanApp || !options.ossApp || !options.baseRevision) {
		throw new Error('Provide --lean-app, --oss-app, and --base-revision.');
	}
	if (!/^[0-9a-f]{40}$/i.test(options.baseRevision)) {
		throw new Error('--base-revision must be a 40-character Git SHA.');
	}
	if (process.platform !== 'darwin' || process.arch !== 'arm64') {
		throw new Error('This harness supports macOS Apple Silicon only.');
	}
}

function readApp(appPath, key, label) {
	const absolutePath = path.resolve(appPath);
	const appStat = fs.statSync(absolutePath, { throwIfNoEntry: false });
	if (!appStat?.isDirectory()) {
		throw new Error(`${label} app path is not a directory: ${absolutePath}`);
	}
	const productPath = path.join(absolutePath, 'Contents', 'Resources', 'app', 'product.json');
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	const executableCandidates = [product.nameShort, 'Electron']
		.filter((value, index, values) => typeof value === 'string' && value.length > 0 && values.indexOf(value) === index)
		.map(name => path.join(absolutePath, 'Contents', 'MacOS', name));
	const executable = executableCandidates.find(candidate => {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return fs.statSync(candidate).isFile();
		} catch {
			return false;
		}
	});
	if (!executable) {
		throw new Error(`${label} app has no executable listed in product.json or named Electron.`);
	}
	return {
		key,
		label,
		appPath: absolutePath,
		executable,
		nameShort: product.nameShort ?? null,
		applicationName: product.applicationName ?? null,
		version: product.version ?? null,
		commit: product.commit ?? null,
		quality: product.quality ?? null
	};
}

function makeFixtureContent() {
	const line = "// Lean VS Code performance fixture. This file is plain text.\n";
	const block = Buffer.from(line.repeat(Math.ceil(FIXTURE_BYTES / Buffer.byteLength(line))), 'utf8');
	return block.subarray(0, FIXTURE_BYTES);
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function appendJsonLine(filePath, value) {
	fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function percentile(values, fraction) {
	assert.ok(fraction > 0 && fraction <= 1);
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

function summarize(values) {
	const finite = values.filter(Number.isFinite);
	return {
		count: finite.length,
		p50: percentile(finite, 0.5),
		p95: percentile(finite, 0.95),
		min: finite.length ? Math.min(...finite) : null,
		max: finite.length ? Math.max(...finite) : null
	};
}

function parseFootprintBytes(output) {
	const match = output.match(/^\s*phys_footprint\s*:\s*([\d,]+)(?:\s*(?:bytes?|B))?\s*$/im);
	if (!match) {
		throw new Error('footprint output did not contain a phys_footprint value.');
	}
	return Number(match[1].replaceAll(',', ''));
}

function parsePsRows(output) {
	const rows = [];
	for (const line of output.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const fields = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
		if (!fields) {
			continue;
		}
		rows.push({
			pid: Number(fields[1]),
			ppid: Number(fields[2]),
			rssKiB: Number(fields[3]),
			name: path.basename(fields[4].trim())
		});
	}
	return rows;
}

function selectProcessTree(rows, rootPid) {
	const byParent = new Map();
	for (const row of rows) {
		const children = byParent.get(row.ppid) ?? [];
		children.push(row);
		byParent.set(row.ppid, children);
	}
	const found = new Map();
	const pending = [rootPid];
	while (pending.length) {
		const pid = pending.pop();
		if (found.has(pid)) {
			continue;
		}
		const row = rows.find(candidate => candidate.pid === pid);
		if (!row) {
			continue;
		}
		found.set(pid, row);
		for (const child of byParent.get(pid) ?? []) {
			pending.push(child.pid);
		}
	}
	return [...found.values()].sort((left, right) => left.pid - right.pid);
}

function runCapture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
		...options
	});
	if (result.error) {
		throw result.error;
	}
	return result;
}

function getProcessTree(rootPid) {
	const result = runCapture('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm=']);
	if (result.status !== 0) {
		throw new Error(`ps failed: ${(result.stderr || result.stdout).trim()}`);
	}
	const tree = selectProcessTree(parsePsRows(result.stdout), rootPid);
	if (tree.length === 0) {
		throw new Error(`Could not find app root PID ${rootPid} in the process table.`);
	}
	return tree;
}

function sampleFootprint(pid) {
	const result = runCapture('/usr/bin/footprint', ['-p', String(pid), '--format', 'bytes', '--noCategories']);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout || `exit status ${result.status}`).trim().slice(0, 500);
		return { bytes: null, error: detail };
	}
	try {
		return { bytes: parseFootprintBytes(result.stdout), error: null };
	} catch (error) {
		return { bytes: null, error: error.message };
	}
}

function appArguments(app, profile, extensionPath, controlDir, startupFile, workspaceFolder) {
	const args = [
		'--new-window',
		`--user-data-dir=${path.join(profile, 'user-data')}`,
		`--shared-data-dir=${path.join(profile, 'shared-data')}`,
		`--extensions-dir=${path.join(profile, 'extensions')}`,
		`--extensionDevelopmentPath=${extensionPath}`,
		'--skip-welcome',
		'--skip-release-notes',
		'--disable-updates',
		'--disable-telemetry',
		...(workspaceFolder ? [`--folder-uri=${pathToFileURL(workspaceFolder).toString()}`] : []),
		startupFile
	];
	return {
		args,
		env: {
			...process.env,
			LEAN_PERF_CONTROL_DIR: controlDir,
			LEAN_PERF_STARTUP_FILE: startupFile
		}
	};
}

function startApp(app, profile, extensionPath, controlDir, startupFile, workspaceFolder) {
	fs.mkdirSync(path.join(profile, 'user-data'), { recursive: true });
	fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
	fs.mkdirSync(controlDir, { recursive: true });
	return launchApp(app, profile, extensionPath, controlDir, startupFile, workspaceFolder);
}

function launchApp(app, profile, extensionPath, controlDir, startupFile, workspaceFolder) {
	const launch = appArguments(app, profile, extensionPath, controlDir, startupFile, workspaceFolder);
	const logFd = fs.openSync(path.join(controlDir, 'app.log'), 'a');
	try {
		return spawn(app.executable, launch.args, { stdio: ['ignore', logFd, logFd], env: launch.env });
	} finally {
		fs.closeSync(logFd);
	}
}

async function waitForPath(filePath, child, timeoutMs, description) {
	const started = performance.now();
	while (performance.now() - started < timeoutMs) {
		if (fs.existsSync(filePath)) {
			try {
				return JSON.parse(fs.readFileSync(filePath, 'utf8'));
			} catch (error) {
				if (!(error instanceof SyntaxError)) {
					throw error;
				}
			}
		}
		if (filePath.endsWith('startup-ready.json')) {
			const errorFile = path.join(path.dirname(filePath), 'startup-error.json');
			if (fs.existsSync(errorFile)) {
				const detail = JSON.parse(fs.readFileSync(errorFile, 'utf8'));
				throw new Error(`${description}: ${detail.error}`);
			}
		}
		if (child?.exitCode !== null && child?.exitCode !== undefined) {
			throw new Error(`${description}: app process exited with code ${child.exitCode}.`);
		}
		if (child?.signalCode) {
			throw new Error(`${description}: app process exited with signal ${child.signalCode}.`);
		}
		await delay(10);
	}
	throw new Error(`${description}: timed out after ${timeoutMs} ms.`);
}

function spawnError(child) {
	return new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('spawn', resolve);
	});
}

function childExit(child) {
	return new Promise(resolve => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve({ code: child.exitCode, signal: child.signalCode });
			return;
		}
		child.once('exit', (code, signal) => resolve({ code, signal }));
	});
}

async function requestControl(controlFile, request, timeoutMs = 10_000) {
	const control = await waitForPath(controlFile, undefined, timeoutMs, 'Extension control server');
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		let buffer = '';
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error('Timed out waiting for the extension control response.'));
		}, timeoutMs);
		socket.once('error', error => {
			clearTimeout(timer);
			reject(error);
		});
		socket.on('data', chunk => {
			buffer += chunk.toString('utf8');
			const newline = buffer.indexOf('\n');
			if (newline < 0) {
				return;
			}
			clearTimeout(timer);
			try {
				resolve(JSON.parse(buffer.slice(0, newline)));
			} catch (error) {
				reject(error);
			}
			socket.end();
		});
		socket.connect(control.port, '127.0.0.1', () => socket.write(`${JSON.stringify(request)}\n`));
	});
}

async function terminateSession(child, controlFile) {
	if (!child.pid) {
		return;
	}
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	try {
		await requestControl(controlFile, { action: 'quit' }, 3000);
	} catch {
		// Startup may have failed before the extension control socket was ready.
	}
	const gracefulExit = await Promise.race([
		childExit(child),
		delay(15_000).then(() => null)
	]);
	if (gracefulExit) {
		return;
	}
	let tree = [];
	try {
		tree = getProcessTree(child.pid);
	} catch {
		tree = [{ pid: child.pid }];
	}
	for (const row of [...tree].sort((left, right) => right.pid - left.pid)) {
		try {
			process.kill(row.pid, 'SIGTERM');
		} catch {
			// The process may have exited between the process snapshot and signal.
		}
	}
	await Promise.race([childExit(child), delay(3000)]);
}

async function runLaunchSample(app, appIndex, sampleIndex, fixturePath, profileRoot, extensionPath, runDir, options) {
	const warmup = sampleIndex < 0;
	const sampleNumber = warmup ? 0 : sampleIndex + 1;
	const trialName = warmup ? 'startup-warmup' : `startup-${String(sampleNumber).padStart(3, '0')}`;
	const trialDir = path.join(runDir, 'trials', `${trialName}-${app.key}`);
	const profile = path.join(profileRoot, trialName);
	const controlDir = path.join(trialDir, 'control');
	const readyFile = path.join(controlDir, 'startup-ready.json');
	fs.mkdirSync(trialDir, { recursive: true });
	fs.mkdirSync(path.join(profile, 'user-data'), { recursive: true });
	fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
	fs.mkdirSync(controlDir, { recursive: true });
	const startedAt = new Date().toISOString();
	const started = performance.now();
	const child = launchApp(app, profile, extensionPath, controlDir, fixturePath, options.gitWorkspace ? path.dirname(fixturePath) : undefined);
	let sample;
	try {
		await spawnError(child);
		const marker = await waitForPath(readyFile, child, options.startupTimeoutMs, 'Startup-to-editable-file');
		sample = {
			type: warmup ? 'launchWarmup' : 'launchToEditableFile',
			subject: app.key,
			sample: sampleNumber,
			order: appIndex + 1,
			startedAt,
			elapsedMs: Number((performance.now() - started).toFixed(3)),
			readiness: marker,
			profileRelativePath: path.relative(runDir, profile)
		};
	} catch (error) {
		sample = {
			type: warmup ? 'launchWarmup' : 'launchToEditableFile',
			subject: app.key,
			sample: sampleNumber,
			order: appIndex + 1,
			startedAt,
			elapsedMs: null,
			error: error.message,
			profileRelativePath: path.relative(runDir, profile)
		};
	} finally {
		await terminateSession(child, path.join(controlDir, 'control.json'));
	}
	return sample;
}


function createExtension(extensionPath) {
	fs.mkdirSync(extensionPath, { recursive: true });
	fs.writeFileSync(path.join(extensionPath, 'package.json'), JSON.stringify({
		name: 'lean-perf-control',
		displayName: 'Lean Perf Control',
		publisher: 'lean-perf',
		version: '0.0.1',
		engines: { vscode: '^1.80.0' },
		main: './extension.js',
		activationEvents: ['onStartupFinished']
	}, null, 2) + '\n', { flag: 'wx' });
	fs.writeFileSync(path.join(extensionPath, 'extension.js'), extensionSource(), { flag: 'wx' });
}

function extensionSource() {
	return `/* Generated by scripts/lean-perf/benchmark.mjs. */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');

const controlDir = process.env.LEAN_PERF_CONTROL_DIR;
const startupFile = process.env.LEAN_PERF_STARTUP_FILE;
const pending = new Map();
const probeToken = '__LEAN_PERF_EDITABILITY_PROBE__';
let startupDone = false;
let checking = false;

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value) + '\\n');
}

function sameFile(left, right) {
	return path.resolve(left) === path.resolve(right);
}

async function verifyEditable(editor, expectedPath) {
	if (!editor || !editor.document || !sameFile(editor.document.uri.fsPath, expectedPath) || editor.document.isClosed) {
		return false;
	}
	const originalText = editor.document.getText();
	const position = new vscode.Position(0, 0);
	const inserted = await editor.edit(builder => builder.insert(position, probeToken));
	if (!inserted) {
		throw new Error('VS Code rejected the editability probe insertion.');
	}
	try {
		const removed = await editor.edit(builder => builder.delete(new vscode.Range(position, new vscode.Position(0, probeToken.length))));
		if (!removed) {
			throw new Error('VS Code rejected the editability probe removal.');
		}
	} finally {
		if (editor.document.getText() !== originalText) {
			const end = editor.document.positionAt(editor.document.getText().length);
			const restored = await editor.edit(builder => builder.replace(new vscode.Range(new vscode.Position(0, 0), end), originalText));
			if (!restored || editor.document.getText() !== originalText) {
				throw new Error('VS Code could not restore the benchmark fixture contents.');
			}
		}
		if (editor.document.isDirty) {
			const saved = await editor.document.save();
			// An auto-save may win the race and make save() return false. The
			// actual gate is that our probe has left the disk file unchanged.
			if (!saved && fs.readFileSync(expectedPath, 'utf8') !== originalText) {
				throw new Error('VS Code could not restore the benchmark fixture to disk.');
			}
		}
	}
	return true;
}

async function checkEditor(editor) {
	if (checking || !editor) {
		return;
	}
	checking = true;
	try {
		if (!startupDone && startupFile && sameFile(editor.document.uri.fsPath, startupFile)) {
			if (await verifyEditable(editor, startupFile)) {
				startupDone = true;
				writeJson(path.join(controlDir, 'startup-ready.json'), {
					filePath: startupFile,
					editable: true,
					readiness: 'active TextEditor plus reversible TextEditor.edit probe'
				});
			}
		}
		for (const [id, item] of pending) {
			if (item.processing || !sameFile(editor.document.uri.fsPath, item.filePath)) {
				continue;
			}
			item.processing = true;
			try {
				if (await verifyEditable(editor, item.filePath)) {
					pending.delete(id);
					writeJson(item.resultPath, {
						id,
						filePath: item.filePath,
						editable: true,
						readiness: 'active TextEditor plus reversible TextEditor.edit probe'
					});
				}
			} catch (error) {
				pending.delete(id);
				writeJson(item.resultPath, { id, filePath: item.filePath, editable: false, error: String(error) });
			}
		}
	} catch (error) {
		if (!startupDone && startupFile && editor && sameFile(editor.document.uri.fsPath, startupFile)) {
			writeJson(path.join(controlDir, 'startup-error.json'), { error: String(error) });
		}
	} finally {
		checking = false;
	}
}

function activate() {
	if (!controlDir) {
		return;
	}
	const server = net.createServer(socket => {
		let buffer = '';
		socket.on('data', chunk => {
			buffer += chunk.toString('utf8');
			const newline = buffer.indexOf('\\n');
			if (newline < 0) {
				return;
			}
			let message;
			try {
				message = JSON.parse(buffer.slice(0, newline));
			} catch (error) {
				socket.end(JSON.stringify({ error: String(error) }) + '\\n');
				return;
			}
			if (message.action === 'arm' && typeof message.id === 'string' && typeof message.filePath === 'string' && typeof message.resultPath === 'string') {
				pending.set(message.id, { filePath: message.filePath, resultPath: message.resultPath, processing: false });
				socket.end(JSON.stringify({ armed: true, id: message.id }) + '\\n');
				return;
			}
			if (message.action === 'cancel' && typeof message.id === 'string') {
				pending.delete(message.id);
				socket.end(JSON.stringify({ canceled: true, id: message.id }) + '\\n');
				return;
			}
			if (message.action === 'quit') {
				socket.end(JSON.stringify({ quitting: true }) + '\\n');
				setTimeout(() => vscode.commands.executeCommand('workbench.action.quit'), 100);
				return;
			}
			socket.end(JSON.stringify({ error: 'Unsupported control action.' }) + '\\n');
		});
	});
	server.listen(0, '127.0.0.1', () => {
		const address = server.address();
		writeJson(path.join(controlDir, 'control.json'), { port: address.port });
		vscode.window.onDidChangeActiveTextEditor(editor => { void checkEditor(editor); });
		void checkEditor(vscode.window.activeTextEditor);
	});
}

function deactivate() {}

module.exports = { activate, deactivate };
`;
}

function appMetadata(apps, baseRevision, options) {
	return {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		comparisonBaseRevision: baseRevision,
		note: 'comparisonBaseRevision is supplied by the operator; product.json commit values are recorded separately and are not treated as proof of a shared source base.',
		machine: {
			platform: process.platform,
			osRelease: os.release(),
			architecture: os.arch(),
			cpuModel: os.cpus()[0]?.model ?? null,
			logicalCpuCount: os.cpus().length,
			totalMemoryBytes: os.totalmem(),
			nodeVersion: process.version
		},
		settings: {
			samples: options.samples,
			memorySamples: options.memorySamples,
			memoryIdleMs: options.memoryIdleMs,
			memorySampleIntervalMs: options.memorySampleIntervalMs,
			existingWindowWarmupMs: EXISTING_WINDOW_WARMUP_MS,
			warmupLaunchesPerProduct: 1,
			startupTimeoutMs: options.startupTimeoutMs,
			fixtureBytes: FIXTURE_BYTES,
			fixtureReadBeforeMeasurement: true,
			gitWorkspace: options.gitWorkspace,
			gitWorkspaceTrackedFiles: options.gitWorkspace ? GIT_WORKSPACE_FILES + 1 : 0,
			userExtensions: 'isolated empty extensions-dir plus the same harness control extension loaded from --extensionDevelopmentPath',
			launchFlags: ['--new-window', '--shared-data-dir', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry'],
			existingWindowMethod: 'launch the app executable with --reuse-window and the file path; readiness is measured by the control extension',
			processEnvironment: 'inherits the invoking environment; values are not recorded in this report'
		},
		apps
	};
}

async function waitForReady(app, fixturePath, profile, extensionPath, controlDir, options) {
	const child = startApp(app, profile, extensionPath, controlDir, fixturePath, options.gitWorkspace ? path.dirname(fixturePath) : undefined);
	try {
		await spawnError(child);
		const marker = await waitForPath(path.join(controlDir, 'startup-ready.json'), child, options.startupTimeoutMs, 'App readiness');
		return { child, marker, readyAt: performance.now() };
	} catch (error) {
		await terminateSession(child, path.join(controlDir, 'control.json'));
		throw error;
	}
}

async function captureMemory(app, sampleIndex, child, options) {
	const sampleStarted = performance.now();
	const capturedAt = new Date().toISOString();
	const idleAfterReadyMs = Number((sampleStarted - options.readyAt).toFixed(3));
	const tree = getProcessTree(child.pid);
	const processes = tree.map(row => {
		const footprint = sampleFootprint(row.pid);
		return {
			pid: row.pid,
			ppid: row.ppid,
			name: row.name,
			rssKiB: row.rssKiB,
			physicalFootprintBytes: footprint.bytes,
			...(footprint.error ? { footprintError: footprint.error } : {})
		};
	});
	const complete = processes.length > 0 && processes.every(row => Number.isFinite(row.physicalFootprintBytes));
	return {
		type: 'wholeProcessTreeMemory',
		subject: app.key,
		sample: sampleIndex + 1,
		capturedAt,
		idleAfterReadyMs,
		captureDurationMs: Number((performance.now() - sampleStarted).toFixed(3)),
		processCount: processes.length,
		physicalFootprintBytes: complete ? processes.reduce((sum, row) => sum + row.physicalFootprintBytes, 0) : null,
		rssBytesDiagnostic: processes.length ? processes.reduce((sum, row) => sum + row.rssKiB * 1024, 0) : null,
		metricMethod: 'sum of per-PID macOS footprint phys_footprint values for the app process tree',
		processes,
		...(!complete ? { captureError: 'One or more process physical-footprint readings were unavailable.' } : {})
	};
}

async function runMemorySession(app, fixturePath, profileRoot, extensionPath, runDir, options) {
	const trialDir = path.join(runDir, 'trials', `memory-${app.key}`);
	const profile = path.join(profileRoot, `memory-${app.key}`);
	const controlDir = path.join(trialDir, 'control');
	fs.mkdirSync(trialDir, { recursive: true });
	let session;
	try {
		session = await waitForReady(app, fixturePath, profile, extensionPath, controlDir, options);
		await delay(options.memoryIdleMs);
		const samples = [];
		let lastSampleStartedAt = 0;
		for (let index = 0; index < options.memorySamples; index++) {
			const minimumStart = lastSampleStartedAt + options.memorySampleIntervalMs;
			if (performance.now() < minimumStart) {
				await delay(minimumStart - performance.now());
			}
			lastSampleStartedAt = performance.now();
			try {
				samples.push(await captureMemory(app, index, session.child, { ...options, readyAt: session.readyAt }));
			} catch (error) {
				samples.push({
					type: 'wholeProcessTreeMemory', subject: app.key, sample: index + 1,
					capturedAt: new Date().toISOString(), physicalFootprintBytes: null,
					rssBytesDiagnostic: null, metricMethod: 'sum of per-PID macOS footprint phys_footprint values for the app process tree',
					processes: [], captureError: error.message
				});
			}
		}
		return samples;
	} finally {
		if (session?.child) {
			await terminateSession(session.child, path.join(controlDir, 'control.json'));
		}
	}
}

function makeSummary(samples, apps) {
	const summary = {
		createdAt: new Date().toISOString(),
		percentileMethod: 'nearest rank: sorted[ceil(p * n) - 1]',
		metrics: {}
	};
	for (const app of apps) {
		const subjectSamples = samples.filter(sample => sample.subject === app.key);
		for (const [type, metric, unit] of [
			['launchToEditableFile', 'elapsedMs', 'ms'],
			['existingWindowFileOpen', 'elapsedMs', 'ms'],
			['wholeProcessTreeMemory', 'physicalFootprintBytes', 'bytes']
		]) {
			const values = subjectSamples.filter(sample => sample.type === type).map(sample => sample[metric]);
			const key = `${app.key}.${type}`;
			summary.metrics[key] = { unit, ...summarize(values) };
		}
	}
	return summary;
}

async function run(options) {
	validateOptions(options);
	const apps = SUBJECTS.map(subject => readApp(
		options[subject.key === 'lean' ? 'leanApp' : 'ossApp'],
		subject.key,
		options[subject.key === 'lean' ? 'leanLabel' : 'ossLabel']
	));
	const plan = {
		products: apps.map(app => ({ label: app.label, version: app.version, productCommit: app.commit, appPath: app.appPath })),
		comparisonBaseRevision: options.baseRevision,
		startupSamplesPerProduct: options.samples,
		warmupLaunchesPerProduct: 1,
		existingWindowSamplesPerProduct: options.samples,
		existingWindowWarmupMs: EXISTING_WINDOW_WARMUP_MS,
		memorySamplesPerProduct: options.memorySamples,
		memoryIdleMs: options.memoryIdleMs,
		outputRoot: path.resolve(options.outputRoot),
		gitWorkspace: options.gitWorkspace
	};
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({ dryRun: true, plan }, null, 2)}\n`);
		return;
	}

	const runId = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
	const runDir = path.join(path.resolve(options.outputRoot), runId);
	fs.mkdirSync(path.dirname(runDir), { recursive: true });
	fs.mkdirSync(runDir, { recursive: false });
	fs.mkdirSync(path.join(runDir, 'fixtures'), { recursive: true });
	// Electron's single-instance Unix socket lives beneath user-data-dir. Keep
	// profiles short enough for macOS's 104-byte Unix-domain socket path limit.
	const profileRoot = fs.mkdtempSync('/private/tmp/lean-perf-');
	const rawSamplesPath = path.join(runDir, 'samples.jsonl');
	fs.writeFileSync(rawSamplesPath, '', { flag: 'wx' });
	const extensionPath = path.join(runDir, 'harness-extension');
	createExtension(extensionPath);
	const workspaceFolder = options.gitWorkspace ? path.join(runDir, 'fixtures', 'git-workspace') : undefined;
	if (workspaceFolder) {
		fs.mkdirSync(workspaceFolder, { recursive: true });
		const init = runCapture('git', ['init', '-q', workspaceFolder]);
		if (init.status !== 0) {
			throw new Error(`Could not initialize fixture Git workspace: ${init.stderr.trim()}`);
		}
	}
	const fixturePath = path.join(workspaceFolder ?? path.join(runDir, 'fixtures'), 'editable-100KiB.txt');
	fs.writeFileSync(fixturePath, makeFixtureContent(), { flag: 'wx' });
	fs.readFileSync(fixturePath); // Warm the fixture contents before timed trials.
	if (workspaceFolder) {
		for (let index = 0; index < GIT_WORKSPACE_FILES; index++) {
			const directory = path.join(workspaceFolder, 'src', String(Math.floor(index / 1000)).padStart(2, '0'));
			fs.mkdirSync(directory, { recursive: true });
			fs.writeFileSync(path.join(directory, `file-${String(index).padStart(5, '0')}.ts`), `export const value = ${index};\n`);
		}
		for (const args of [
			['-C', workspaceFolder, 'add', '.'],
			['-C', workspaceFolder, '-c', 'user.name=Lean Perf', '-c', 'user.email=lean-perf@example.invalid', 'commit', '-q', '-m', 'Benchmark fixture']
		]) {
			const result = runCapture('git', args);
			if (result.status !== 0) {
				throw new Error(`Could not prepare Git workspace: ${result.stderr.trim()}`);
			}
		}
	}

	const samples = [];
	const append = sample => {
		samples.push(sample);
		appendJsonLine(rawSamplesPath, sample);
	};
	const baseOptions = { ...options, memorySampleIntervalMs: 1000 };
	const manifest = appMetadata(apps, options.baseRevision, baseOptions);
	writeJson(path.join(runDir, 'manifest.json'), manifest);
	process.stdout.write(`Writing benchmark output to ${runDir}\n`);
	process.stdout.write('Running one startup warm-up per product; these are raw-only samples.\n');
	for (const [appIndex, app] of [...apps].reverse().entries()) {
		append(await runLaunchSample(app, appIndex, -1, fixturePath, path.join(profileRoot, app.key), extensionPath, runDir, baseOptions));
	}
	process.stdout.write(`Starting ${options.samples} alternating launch samples per product.\n`);

	for (let index = 0; index < options.samples; index++) {
		const order = index % 2 === 0 ? apps : [...apps].reverse();
		for (const [appIndex, app] of order.entries()) {
			append(await runLaunchSample(app, appIndex, index, fixturePath, path.join(profileRoot, app.key), extensionPath, runDir, baseOptions));
		}
	}

	process.stdout.write('Measuring existing-window file opens in alternating product order.\n');
	const activeProfiles = path.join(profileRoot, 'existing-window');
	const existingSessionApps = index => index % 2 === 0 ? apps : [...apps].reverse();
	const sessionStates = new Map();
	try {
		for (const app of apps) {
			const trialDir = path.join(runDir, 'trials', `existing-window-${app.key}`);
			const profile = path.join(activeProfiles, app.key);
			const controlDir = path.join(trialDir, 'control');
			fs.mkdirSync(trialDir, { recursive: true });
			const session = await waitForReady(app, fixturePath, profile, extensionPath, controlDir, baseOptions);
			sessionStates.set(app.key, { app, child: session.child, profile, controlDir });
		}
		await delay(EXISTING_WINDOW_WARMUP_MS);
		for (let index = 0; index < options.samples; index++) {
			for (const app of existingSessionApps(index)) {
				const state = sessionStates.get(app.key);
				const one = await runOneExistingOpen(state, index, runDir, baseOptions);
				append(one);
			}
		}
	} finally {
		for (const state of sessionStates.values()) {
			await terminateSession(state.child, path.join(state.controlDir, 'control.json'));
		}
	}

	process.stdout.write(`Waiting ${options.memoryIdleMs} ms before idle process-tree memory samples.\n`);
	for (const app of apps) {
		let memorySamples;
		try {
			memorySamples = await runMemorySession(app, fixturePath, path.join(profileRoot, 'memory'), extensionPath, runDir, baseOptions);
		} catch (error) {
			memorySamples = [{
				type: 'wholeProcessTreeMemory', subject: app.key, sample: 1,
				capturedAt: new Date().toISOString(), physicalFootprintBytes: null, rssBytesDiagnostic: null,
				metricMethod: 'sum of per-PID macOS footprint phys_footprint values for the app process tree',
				processes: [], captureError: error.message
			}];
		}
		for (const sample of memorySamples) {
			append(sample);
		}
	}

	const summary = makeSummary(samples, apps);
	writeJson(path.join(runDir, 'summary.json'), summary);
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.stdout.write(`Raw samples: ${rawSamplesPath}\nSummary: ${path.join(runDir, 'summary.json')}\n`);
}

async function runOneExistingOpen(state, sampleIndex, runDir, options) {
	const { app, child, profile, controlDir } = state;
	const id = `${app.key}-${String(sampleIndex + 1).padStart(3, '0')}`;
	const targetPath = path.join(runDir, 'fixtures', ...(options.gitWorkspace ? ['git-workspace'] : []), `open-${app.key}-${String(sampleIndex + 1).padStart(3, '0')}.txt`);
	fs.writeFileSync(targetPath, makeFixtureContent(), { flag: 'wx' });
	fs.readFileSync(targetPath);
	const markerPath = path.join(controlDir, `open-${id}.json`);
	let cli;
	let startedAt = null;
	try {
		const armed = await requestControl(path.join(controlDir, 'control.json'), { action: 'arm', id, filePath: targetPath, resultPath: markerPath });
		if (!armed?.armed) {
			throw new Error(`Extension did not arm open sample ${id}.`);
		}
		const args = ['--reuse-window', `--user-data-dir=${path.join(profile, 'user-data')}`, `--shared-data-dir=${path.join(profile, 'shared-data')}`, `--extensions-dir=${path.join(profile, 'extensions')}`, targetPath];
		startedAt = new Date().toISOString();
		const start = performance.now();
		cli = spawn(app.executable, args, { stdio: 'ignore', env: process.env });
		await spawnError(cli);
		const marker = await waitForPath(markerPath, child, options.startupTimeoutMs, 'Existing-window file open');
		if (marker.editable !== true) {
			throw new Error(marker.error ?? 'The active editor did not accept the editability probe.');
		}
		const elapsedMs = Number((performance.now() - start).toFixed(3));
		const cliStatus = await Promise.race([childExit(cli), delay(2000).then(() => null)]);
		return {
			type: 'existingWindowFileOpen', subject: app.key, sample: sampleIndex + 1,
			elapsedMs, startedAt,
			readiness: marker, cliExit: cliStatus, fixtureBytes: FIXTURE_BYTES,
			profileRelativePath: path.relative(runDir, profile)
		};
	} catch (error) {
		try {
			await requestControl(path.join(controlDir, 'control.json'), { action: 'cancel', id }, 1000);
		} catch {
			// The session may already be closing.
		}
		return {
			type: 'existingWindowFileOpen', subject: app.key, sample: sampleIndex + 1,
			elapsedMs: null, startedAt: startedAt ?? new Date().toISOString(), error: error.message,
			cliExit: cli ? { code: cli.exitCode, signal: cli.signalCode } : null,
			fixtureBytes: FIXTURE_BYTES, profileRelativePath: path.relative(runDir, profile)
		};
	}
}

async function main() {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) {
			process.stdout.write(`${usage()}\n`);
			return;
		}
		await run(options);
	} catch (error) {
		process.stderr.write(`lean-perf: ${error.message}\n\n${usage()}\n`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	await main();
}

export {
	makeFixtureContent,
	createExtension,
	parseArgs,
	parseFootprintBytes,
	parsePsRows,
	percentile,
	readApp,
	selectProcessTree,
	validateOptions
};
