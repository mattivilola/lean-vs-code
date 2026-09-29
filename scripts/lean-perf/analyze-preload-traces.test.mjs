/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const analyzer = fileURLToPath(new URL('./analyze-preload-traces.mjs', import.meta.url));
const fixture = '/private/tmp/preload-fixture.txt';

function trace(app, profileCondition, hasWorkbenchModulePreload, importEnd, activatedAtEpochMs, resourceStart, resourceEnd) {
	return {
		app, productCommit: 'same-commit', fixture, launchMode: 'direct', profileCondition, hasWorkbenchModulePreload,
		controlExtensionInstall: 'vsix', windowBounds: { x: 16, y: 546, width: 560, height: 360 },
		spawnedAtEpochMs: 500, rendererTimeOrigin: 900,
		controlExtensionActivation: { activatedAtEpochMs },
		marks: [
			{ name: 'code/didStartRenderer', startTime: 1000 },
			{ name: 'code/willLoadWorkbenchMain', startTime: 1100 },
			{ name: 'code/didLoadWorkbenchMain', startTime: importEnd }
		],
		resourceTimings: [{ name: 'vscode-file://vscode-app/out/vs/workbench/workbench.desktop.main.js', initiatorType: 'link', startTime: resourceStart, responseEnd: resourceEnd, duration: resourceEnd - resourceStart }]
	};
}

test('reports stage differences and rejects mismatched profile conditions', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-preload-analysis-'));
	try {
		const controlPath = path.join(dir, 'control.json');
		const candidatePath = path.join(dir, 'candidate.json');
		fs.writeFileSync(controlPath, JSON.stringify(trace('/tmp/control.app', 'fresh', false, 1200, 1600, 210, 240)));
		fs.writeFileSync(candidatePath, JSON.stringify(trace('/tmp/candidate.app', 'fresh', true, 1180, 1500, 150, 190)));
		const result = spawnSync(process.execPath, [analyzer, controlPath, candidatePath], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.candidateMinusControlMs.workbenchImport, -20);
		assert.equal(report.candidateMinusControlMs.spawnToControlExtensionActivation, -100);
		assert.equal(report.control.moduleResource.responseEndBeforeImportMs, -40);
		assert.equal(report.candidate.moduleResource.responseEndBeforeImportMs, 10);

		fs.writeFileSync(candidatePath, JSON.stringify(trace('/tmp/candidate.app', 'established', true, 1180, 1500, 150, 190)));
		const mismatch = spawnSync(process.execPath, [analyzer, controlPath, candidatePath], { encoding: 'utf8' });
		assert.notEqual(mismatch.status, 0);
		assert.match(mismatch.stderr, /Unmatched profileCondition/);

		fs.writeFileSync(candidatePath, JSON.stringify(trace('/tmp/candidate.app', 'fresh', false, 1180, 1500, 150, 190)));
		const reversed = spawnSync(process.execPath, [analyzer, controlPath, candidatePath], { encoding: 'utf8' });
		assert.notEqual(reversed.status, 0);
		assert.match(reversed.stderr, /Expected a control without modulepreload/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
