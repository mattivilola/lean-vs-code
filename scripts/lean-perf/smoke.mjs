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
import { LAUNCH_MODES, launchApp } from './launch.mjs';
import { createControlVSIX } from './control-extension.mjs';
import {
	makeFixtureContent,
	createExtension,
	parseArgs,
	parseWindowBounds,
	parseFootprintBytes,
	parsePsRows,
	percentile,
	readApp,
	selectProcessTree,
	seedWindowBounds
} from './benchmark.mjs';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-perf-smoke-'));
try {
	assert.equal(makeFixtureContent().length, 100 * 1024);
	assert.deepEqual(parseArgs(['--samples', '7', '--memory-idle-ms', '20']).samples, 7);
	assert.equal(parseArgs(['--git-workspace']).gitWorkspace, true);
	assert.equal(parseArgs(['--reuse-startup-profile']).reuseStartupProfile, true);
	assert.equal(parseArgs(['--startup-only']).startupOnly, true);
	assert.equal(parseArgs(['--memory-only']).memoryOnly, true);
	const compactBounds = { x: 16, y: 546, width: 560, height: 360 };
	assert.deepEqual(parseArgs(['--window-bounds', '16,546,560,360']).windowBounds, compactBounds);
	assert.deepEqual(parseWindowBounds('16,546,560,360'), compactBounds);
	assert.throws(() => parseWindowBounds('16,546,300,200'), /width >= 400/);
	const placementProfile = path.join(temporaryRoot, 'placement-profile');
	seedWindowBounds(placementProfile, compactBounds);
	const placementStorage = JSON.parse(fs.readFileSync(path.join(placementProfile, 'user-data', 'User', 'globalStorage', 'storage.json'), 'utf8'));
	assert.deepEqual(placementStorage.windowsState.lastActiveWindow.uiState, { mode: 1, ...compactBounds });
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
	assert.deepEqual(LAUNCH_MODES, ['direct', 'cli', 'finder']);
	await assert.rejects(launchApp(readApp(appPath, 'smoke', 'Smoke app'), [`--user-data-dir=${temporaryRoot}/profile`], {
		mode: 'cli', profileMarker: `${temporaryRoot}/profile`, logPath: path.join(temporaryRoot, 'unused.log')
	}), /no executable CLI script/);
	const cliPath = path.join(resourcesPath, 'bin', 'smoke');
	fs.mkdirSync(path.dirname(cliPath), { recursive: true });
	fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(cliPath, 0o755);
	assert.equal(readApp(appPath, 'smoke', 'Smoke app').cliScript, cliPath);
	const bundledCliPath = path.join(resourcesPath, 'bin', 'code');
	fs.writeFileSync(bundledCliPath, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(bundledCliPath, 0o755);
	assert.equal(readApp(appPath, 'smoke', 'Smoke app').cliScript, bundledCliPath);
	const extensionPath = path.join(temporaryRoot, 'harness-extension');
	createExtension(extensionPath);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8')).capabilities, {
		untrustedWorkspaces: { supported: true }, virtualWorkspaces: false
	});
	const vsix = createControlVSIX(extensionPath, path.join(temporaryRoot, 'harness-extension.vsix'));
	const zipEntries = spawnSync('/usr/bin/unzip', ['-Z', '-1', vsix.path], { encoding: 'utf8' });
	assert.equal(zipEntries.status, 0, zipEntries.stderr);
	for (const entry of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json', 'extension/extension.js']) {
		assert.ok(zipEntries.stdout.split('\n').includes(entry), `Missing ${entry} in control VSIX`);
	}
	for (const entry of ['[Content_Types].xml', 'extension.vsixmanifest']) {
		const xmlCheck = spawnSync('/usr/bin/xmllint', ['--noout', path.join(`${vsix.path}.contents`, entry)], { encoding: 'utf8' });
		assert.equal(xmlCheck.status, 0, xmlCheck.stderr);
	}
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
	const baselineCliPath = path.join(baselineResourcesPath, 'bin', 'code');
	fs.mkdirSync(path.dirname(baselineCliPath), { recursive: true });
	fs.writeFileSync(baselineCliPath, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(baselineCliPath, 0o755);
	const outputRoot = path.join(temporaryRoot, 'must-not-be-created');
	const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark.mjs');
	const dryRun = spawnSync(process.execPath, [
		scriptPath,
		'--lean-app', appPath,
		'--oss-app', baselinePath,
		'--base-revision', 'a'.repeat(40),
		'--samples', '1',
		'--window-bounds', '16,546,560,360',
		'--memory-samples', '1',
		'--memory-idle-ms', '1',
		'--output-root', outputRoot,
		'--dry-run'
	], { encoding: 'utf8' });
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.equal(JSON.parse(dryRun.stdout).dryRun, true);
	assert.deepEqual(JSON.parse(dryRun.stdout).plan.windowBounds, compactBounds);
	assert.equal(fs.existsSync(outputRoot), false);
	const focusedDryRun = spawnSync(process.execPath, [
		scriptPath, '--lean-app', appPath, '--oss-app', baselinePath,
		'--base-revision', 'a'.repeat(40), '--startup-only', '--samples', '2', '--dry-run'
	], { encoding: 'utf8' });
	assert.equal(focusedDryRun.status, 0, focusedDryRun.stderr);
	assert.equal(JSON.parse(focusedDryRun.stdout).plan.existingWindowSamplesPerProduct, 0);
	assert.equal(JSON.parse(focusedDryRun.stdout).plan.memorySamplesPerProduct, 0);
	const incompatibleModes = spawnSync(process.execPath, [
		scriptPath, '--lean-app', appPath, '--oss-app', baselinePath,
		'--base-revision', 'a'.repeat(40), '--startup-only', '--memory-only', '--dry-run'
	], { encoding: 'utf8' });
	assert.notEqual(incompatibleModes.status, 0);
	assert.match(incompatibleModes.stderr, /cannot be combined/);

	const reportDir = path.join(temporaryRoot, 'startup-export-fixture');
	fs.mkdirSync(reportDir);
	const apps = ['lean', 'code-oss'].map(key => ({ key, label: key, version: '1.2.3', commit: 'a'.repeat(40) }));
	fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify({
		createdAt: '2026-09-28T00:00:00Z', comparisonBaseRevision: 'a'.repeat(40), machine: { architecture: 'arm64' },
		apps, controlExtensionInstall: 'vsix', settings: { startupOnly: true, samples: 2, launchMode: 'cli', profileCondition: 'established' }
	}));
	const metrics = {};
	for (const app of apps) {
		metrics[`${app.key}.launchToEditableFile`] = { count: 2, failed: 0, p50: 100 };
		metrics[`${app.key}.existingWindowFileOpen`] = { count: 0, failed: 0 };
		metrics[`${app.key}.wholeProcessTreeMemory`] = { count: 0, failed: 0 };
	}
	fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify({ metrics }));
	const exportSamples = apps.flatMap(app => [
		{ type: 'launchWarmup', subject: app.key, sample: 0, elapsedMs: 100, profileRelativePath: '/private/secret' },
		...[1, 2].map(sample => ({ type: 'launchToEditableFile', subject: app.key, sample, elapsedMs: 100 + sample, profileRelativePath: '/private/secret' }))
	]);
	const exportScript = path.join(path.dirname(scriptPath), 'export-public.mjs');
	fs.writeFileSync(path.join(reportDir, 'samples.jsonl'), `${exportSamples.map(JSON.stringify).join('\n')}\n`);
	const publicPath = path.join(reportDir, 'public.json');
	const exportResult = spawnSync(process.execPath, [exportScript, reportDir, publicPath], { encoding: 'utf8' });
	assert.equal(exportResult.status, 0, exportResult.stderr);
	assert.equal(JSON.parse(fs.readFileSync(publicPath, 'utf8')).samples.length, 4);
	assert.equal(fs.readFileSync(publicPath, 'utf8').includes('/private/secret'), false);
	fs.writeFileSync(path.join(reportDir, 'samples.jsonl'), `${exportSamples.slice(1).map(JSON.stringify).join('\n')}\n`);
	const incomplete = spawnSync(process.execPath, [exportScript, reportDir, path.join(reportDir, 'incomplete.json')], { encoding: 'utf8' });
	assert.notEqual(incomplete.status, 0);
	assert.match(incomplete.stderr, /incomplete editable-file startup comparison/);

	process.stdout.write('lean-perf smoke checks passed (fake app bundles only; no app was launched).\n');
} finally {
	fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
