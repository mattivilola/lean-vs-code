/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Focused diagnostic comparison only. Release speed claims use the paired benchmark.
import fs from 'node:fs';
import path from 'node:path';

const [controlPath, candidatePath] = process.argv.slice(2);
if (!controlPath || !candidatePath || process.argv.length !== 4) {
	console.error('Usage: node scripts/lean-perf/analyze-preload-traces.mjs <control-trace.json> <candidate-trace.json>');
	process.exit(2);
}

function readTrace(file) {
	const trace = JSON.parse(fs.readFileSync(file, 'utf8'));
	for (const field of ['app', 'productCommit', 'fixture', 'launchMode', 'profileCondition', 'controlExtensionInstall']) {
		if (typeof trace[field] !== 'string') {
			throw new Error(`${file}: missing ${field}`);
		}
	}
	for (const field of ['spawnedAtEpochMs', 'rendererTimeOrigin']) {
		if (!Number.isFinite(trace[field])) {
			throw new Error(`${file}: missing ${field}`);
		}
	}
	if (!Number.isFinite(trace.controlExtensionActivation?.activatedAtEpochMs) || !Array.isArray(trace.marks) || !Array.isArray(trace.resourceTimings)) {
		throw new Error(`${file}: missing extension activation, marks, or resource timings`);
	}
	if (typeof trace.hasWorkbenchModulePreload !== 'boolean') {
		throw new Error(`${file}: missing preload state`);
	}
	return trace;
}

const control = readTrace(controlPath);
const candidate = readTrace(candidatePath);
for (const field of ['productCommit', 'fixture', 'launchMode', 'profileCondition', 'controlExtensionInstall']) {
	if (control[field] !== candidate[field]) {
		throw new Error(`Unmatched ${field}: ${control[field]} versus ${candidate[field]}`);
	}
}
if (JSON.stringify(control.windowBounds ?? null) !== JSON.stringify(candidate.windowBounds ?? null)) {
	throw new Error('Unmatched window bounds');
}
if (path.resolve(control.app) === path.resolve(candidate.app)) {
	throw new Error('Control and candidate traces use the same app path');
}
if (control.hasWorkbenchModulePreload || !candidate.hasWorkbenchModulePreload) {
	throw new Error('Expected a control without modulepreload and a candidate with modulepreload');
}

function mark(trace, name) {
	const value = trace.marks.find(entry => entry.name === name)?.startTime;
	if (!Number.isFinite(value)) {
		throw new Error(`${trace.app}: missing ${name}`);
	}
	return value;
}

function moduleResource(trace) {
	const entries = trace.resourceTimings.filter(entry => {
		try {
			return new URL(entry.name).pathname.endsWith('/workbench.desktop.main.js');
		} catch {
			return false;
		}
	});
	const first = entries[0];
	return {
		count: entries.length,
		initiatorTypes: entries.map(entry => entry.initiatorType),
		startBeforeImportMs: first ? mark(trace, 'code/willLoadWorkbenchMain') - (trace.rendererTimeOrigin + first.startTime) : null,
		responseEndBeforeImportMs: first ? mark(trace, 'code/willLoadWorkbenchMain') - (trace.rendererTimeOrigin + first.responseEnd) : null,
		durationMs: first?.duration ?? null
	};
}

function summarize(trace) {
	const rendererStart = mark(trace, 'code/didStartRenderer');
	const importStart = mark(trace, 'code/willLoadWorkbenchMain');
	const importEnd = mark(trace, 'code/didLoadWorkbenchMain');
	const extensionActivation = trace.controlExtensionActivation.activatedAtEpochMs;
	if (importStart < rendererStart || importEnd < importStart || extensionActivation < trace.spawnedAtEpochMs) {
		throw new Error(`${trace.app}: startup timestamps are out of order`);
	}
	return {
		app: trace.app,
		rendererStartToImportMs: importStart - rendererStart,
		workbenchImportMs: importEnd - importStart,
		spawnToControlExtensionActivationMs: extensionActivation - trace.spawnedAtEpochMs,
		moduleResource: moduleResource(trace)
	};
}

const before = summarize(control);
const after = summarize(candidate);
console.log(JSON.stringify({
	kind: 'focused-preload-diagnostic',
	productCommit: control.productCommit,
	profileCondition: control.profileCondition,
	launchMode: control.launchMode,
	control: before,
	candidate: after,
	candidateMinusControlMs: {
		rendererStartToImport: after.rendererStartToImportMs - before.rendererStartToImportMs,
		workbenchImport: after.workbenchImportMs - before.workbenchImportMs,
		spawnToControlExtensionActivation: after.spawnToControlExtensionActivationMs - before.spawnToControlExtensionActivationMs
	},
	interpretation: 'Single traces can identify preload timing and duplicate requests, not a reliable speed gain. Control-extension activation is later than and distinct from an extension-backed editable-file result. Use matched editable-file trials before retaining the candidate; public claims require the original Code-OSS comparator.'
}, null, 2));
