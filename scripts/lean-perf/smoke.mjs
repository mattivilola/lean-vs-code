/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	makeFixtureContent,
	createExtension,
	parseArgs,
	parseFootprintBytes,
	parsePsRows,
	percentile,
	readApp,
	selectProcessTree
} from './benchmark.mjs';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-perf-smoke-'));
try {
	assert.equal(makeFixtureContent().length, 100 * 1024);
	assert.deepEqual(parseArgs(['--samples', '7', '--memory-idle-ms', '20']).samples, 7);
	assert.equal(parseArgs(['--git-workspace']).gitWorkspace, true);
	assert.equal(parseFootprintBytes('Auxiliary data:\n    phys_footprint: 123456 bytes\n'), 123456);
	assert.equal(percentile([9, 2, 5, 1], 0.5), 2);
	assert.equal(percentile([9, 2, 5, 1], 0.95), 9);
	assert.throws(() => parseFootprintBytes('No footprint data'), /phys_footprint/);

	const rows = parsePsRows([
		'100 1 2048 /Applications/Lean VS Code.app/Contents/MacOS/Electron',
		'101 100 1024 /Applications/Lean VS Code.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper',
		'102 101 512 /usr/bin/node',
		'200 1 4096 /Applications/Other.app/Contents/MacOS/Other'
	].join('\n'));
	assert.deepEqual(selectProcessTree(rows, 100).map(row => row.pid), [100, 101, 102]);

	const appPath = path.join(temporaryRoot, 'Smoke.app');
	const macOSPath = path.join(appPath, 'Contents', 'MacOS');
	const resourcesPath = path.join(appPath, 'Contents', 'Resources', 'app');
	fs.mkdirSync(macOSPath, { recursive: true });
	fs.mkdirSync(resourcesPath, { recursive: true });
	fs.writeFileSync(path.join(resourcesPath, 'product.json'), JSON.stringify({
		nameShort: 'Smoke', applicationName: 'smoke', version: '1.2.3', commit: 'a'.repeat(40)
	}));
	fs.writeFileSync(path.join(macOSPath, 'Smoke'), 'smoke fixture');
	fs.chmodSync(path.join(macOSPath, 'Smoke'), 0o755);
	assert.equal(readApp(appPath, 'smoke', 'Smoke app').commit, 'a'.repeat(40));
	const extensionPath = path.join(temporaryRoot, 'harness-extension');
	createExtension(extensionPath);
	const extensionCheck = spawnSync(process.execPath, ['--check', path.join(extensionPath, 'extension.js')], { encoding: 'utf8' });
	assert.equal(extensionCheck.status, 0, extensionCheck.stderr);

	const baselinePath = path.join(temporaryRoot, 'Baseline.app');
	const baselineMacOSPath = path.join(baselinePath, 'Contents', 'MacOS');
	const baselineResourcesPath = path.join(baselinePath, 'Contents', 'Resources', 'app');
	fs.mkdirSync(baselineMacOSPath, { recursive: true });
	fs.mkdirSync(baselineResourcesPath, { recursive: true });
	fs.writeFileSync(path.join(baselineResourcesPath, 'product.json'), JSON.stringify({ nameShort: 'Baseline', version: '1.2.3' }));
	fs.writeFileSync(path.join(baselineMacOSPath, 'Baseline'), 'smoke fixture');
	fs.chmodSync(path.join(baselineMacOSPath, 'Baseline'), 0o755);
	const outputRoot = path.join(temporaryRoot, 'must-not-be-created');
	const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark.mjs');
	const dryRun = spawnSync(process.execPath, [
		scriptPath,
		'--lean-app', appPath,
		'--oss-app', baselinePath,
		'--base-revision', 'a'.repeat(40),
		'--samples', '1',
		'--memory-samples', '1',
		'--memory-idle-ms', '1',
		'--output-root', outputRoot,
		'--dry-run'
	], { encoding: 'utf8' });
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.equal(JSON.parse(dryRun.stdout).dryRun, true);
	assert.equal(fs.existsSync(outputRoot), false);

	process.stdout.write('lean-perf smoke checks passed (fake app bundles only; no app was launched).\n');
} finally {
	fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
