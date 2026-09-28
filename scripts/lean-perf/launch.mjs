/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const LAUNCH_MODES = ['direct', 'cli', 'finder'];

function executableFile(filePath) {
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

export function readApp(appPath, key, label) {
	const absolutePath = path.resolve(appPath);
	const appStat = fs.statSync(absolutePath, { throwIfNoEntry: false });
	if (!appStat?.isDirectory()) {
		throw new Error(`${label} app path is not a directory: ${absolutePath}`);
	}
	const product = JSON.parse(fs.readFileSync(path.join(absolutePath, 'Contents', 'Resources', 'app', 'product.json'), 'utf8'));
	const executableCandidates = [product.nameShort, 'Electron']
		.filter((value, index, values) => typeof value === 'string' && value.length > 0 && values.indexOf(value) === index)
		.map(name => path.join(absolutePath, 'Contents', 'MacOS', name));
	const executable = executableCandidates.find(executableFile);
	if (!executable) {
		throw new Error(`${label} app has no executable listed in product.json or named Electron.`);
	}
	const binPath = path.join(absolutePath, 'Contents', 'Resources', 'app', 'bin');
	const cliCandidates = [path.join(binPath, 'code'), product.applicationName && path.join(binPath, product.applicationName)].filter(Boolean);
	return {
		key, label, appPath: absolutePath, executable,
		cliScript: cliCandidates.find(executableFile) ?? null,
		nameShort: product.nameShort ?? null,
		applicationName: product.applicationName ?? null,
		version: product.version ?? null,
		commit: product.commit ?? null,
		quality: product.quality ?? null
	};
}

function matchingRoots(app, profileMarker) {
	const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`ps failed: ${result.stderr.trim()}`);
	}
	const rows = result.stdout.split(/\r?\n/).map(line => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
		return match && { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
	}).filter(Boolean);
	const matches = rows.filter(row => row.command.startsWith(app.executable + ' ') || row.command === app.executable)
		.filter(row => row.command.includes(`--user-data-dir=${profileMarker}`) && !row.command.includes('/out/cli.js'));
	const pids = new Set(matches.map(row => row.pid));
	return matches.filter(row => !pids.has(row.ppid)).map(row => row.pid);
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function launchApp(app, args, { mode = 'direct', env = process.env, logPath, profileMarker, allowExistingRoot = false }) {
	if (!LAUNCH_MODES.includes(mode)) {
		throw new Error(`Unknown launch mode: ${mode}`);
	}
	if (mode === 'cli' && !app.cliScript) {
		throw new Error(`${app.label} has no executable CLI script at Contents/Resources/app/bin/code or bin/${app.applicationName ?? '<applicationName>'}.`);
	}
	if (!profileMarker || !args.some(arg => arg === `--user-data-dir=${profileMarker}`)) {
		throw new Error('Launch requires a unique --user-data-dir profileMarker in args.');
	}
	const priorRoots = mode === 'direct' ? new Set() : new Set(matchingRoots(app, profileMarker));
	if (priorRoots.size && !allowExistingRoot) {
		throw new Error(`${app.label} still has a running process for ${profileMarker}; the previous trial did not fully stop.`);
	}
	const fd = fs.openSync(logPath, 'a');
	let child;
	const spawnedAt = Date.now();
	try {
		const command = mode === 'direct' ? app.executable : mode === 'cli' ? app.cliScript : '/usr/bin/open';
		const launchArgs = mode === 'finder' ? ['-n', '-a', app.appPath, '--args', ...args] : args;
		child = spawn(command, launchArgs, {
			stdio: ['ignore', fd, fd],
			env: mode === 'cli' ? { ...env, VSCODE_CLI: undefined } : env
		});
		await new Promise((resolve, reject) => {
			child.once('spawn', resolve);
			child.once('error', reject);
		});
	} finally {
		fs.closeSync(fd);
	}
	let root = mode === 'direct' ? child.pid : null;
	let owned = mode === 'direct';
	async function rootPid() {
		if (root && alive(root)) {
			return root;
		}
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const roots = matchingRoots(app, profileMarker);
			const newRoot = roots.find(pid => !priorRoots.has(pid));
			if (newRoot || roots.length) {
				root = newRoot ?? roots[0];
				owned = !!newRoot;
				return root;
			}
			if (child.exitCode !== null && child.exitCode !== 0) {
				throw new Error(`${mode} launcher exited with code ${child.exitCode}.`);
			}
			await delay(20);
		}
		throw new Error(`Timed out finding ${app.label} main process for ${profileMarker}.`);
	}
	return {
		mode, spawnedAt, rootPid,
		async launcherExit(timeoutMs = 2000) {
			if (child.exitCode !== null || child.signalCode !== null) {
				return { code: child.exitCode, signal: child.signalCode };
			}
			return Promise.race([
				new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
				delay(timeoutMs).then(() => null)
			]);
		},
		isRunning() { return root ? alive(root) : child.exitCode === null && child.signalCode === null; },
		async terminate() {
			if (!owned || !root || !alive(root)) {
				return;
			}
			// Recheck the profile marker before every signal to avoid PID reuse.
			if (!matchingRoots(app, profileMarker).includes(root)) {
				return;
			}
			try {
				process.kill(root, 'SIGTERM');
			} catch (error) {
				if (error.code === 'ESRCH') {
					return;
				}
				throw error;
			}
			const deadline = Date.now() + 3000;
			while (alive(root) && Date.now() < deadline) {
				await delay(20);
			}
			if (alive(root) && matchingRoots(app, profileMarker).includes(root)) {
				try {
					process.kill(root, 'SIGKILL');
				} catch (error) {
					if (error.code !== 'ESRCH') {
						throw error;
					}
				}
			}
		}
	};
}
