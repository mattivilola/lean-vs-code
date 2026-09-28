/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Export a reviewable benchmark report without local paths, PIDs, or app logs.
import fs from 'node:fs';
import path from 'node:path';

const [runArg, outputArg] = process.argv.slice(2);
if (!runArg || !outputArg) {
	console.error('Usage: node scripts/lean-perf/export-public.mjs <run-directory> <output.json>');
	process.exit(2);
}

const runDir = path.resolve(runArg);
const output = path.resolve(outputArg);
const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
const samples = fs.readFileSync(path.join(runDir, 'samples.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));

if (samples.some(sample => sample.error)) {
	throw new Error('Do not publish a benchmark with failed samples. Inspect the raw run first.');
}
for (const [name, metric] of Object.entries(summary.metrics)) {
	const skippedByFocusedRun = (manifest.settings?.memoryOnly && !name.endsWith('.wholeProcessTreeMemory'))
		|| (manifest.settings?.startupOnly && !name.endsWith('.launchToEditableFile'));
	if (metric.count < 1 && !skippedByFocusedRun) {
		throw new Error('Do not publish a benchmark with an empty metric.');
	}
}

const common = {
	schemaVersion: 1,
	createdAt: manifest.createdAt,
	comparisonBaseRevision: manifest.comparisonBaseRevision,
	machine: manifest.machine,
	apps: manifest.apps.map(({ key, label, version, commit }) => ({ key, label, version, commit })),
	metrics: Object.fromEntries(Object.entries(summary.metrics).filter(([, metric]) => metric.count > 0))
};

const report = manifest.scenario ? {
	...common,
	kind: 'first-use-workflow',
	scenario: manifest.scenario,
	definition: manifest.definition,
	settings: { samplesPerApp: manifest.samplesPerApp, pollIntervalMs: manifest.pollIntervalMs },
	samples: samples.map(({ type, subject, sample, order, elapsedMs, launchToWorkflowMs }) => ({
		type, subject, sample, order, elapsedMs, launchToWorkflowMs
	}))
} : manifest.settings?.memoryOnly ? {
	...common,
	kind: manifest.settings.memoryLaunches > 1 ? 'independent-app-tree-memory' : 'app-tree-memory-snapshots',
	settings: {
		memoryLaunchesPerApp: manifest.settings.memoryLaunches,
		memorySnapshotsPerLaunch: manifest.settings.memorySamples,
		idleAfterEditableFileMs: manifest.settings.memoryIdleMs,
		profileCondition: 'fresh isolated profile per launch',
		metricMethod: 'sum of per-PID macOS footprint phys_footprint values for the app process tree'
	},
	byRole: summary.byRole,
	samples: samples.filter(sample => sample.type === 'wholeProcessTreeMemory').map(({ subject, sample, memoryLaunch, physicalFootprintBytes, processCount, byRole }) => ({
		subject, sample, memoryLaunch, physicalFootprintBytes, processCount, byRole
	}))
} : manifest.settings?.startupOnly ? {
	...common,
	kind: 'extension-backed-file',
	settings: {
		samplesPerApp: manifest.settings.samples,
		launchMode: manifest.settings.launchMode,
		profileCondition: manifest.settings.profileCondition,
		controlExtensionInstall: manifest.controlExtensionInstall
	},
	samples: samples.filter(sample => sample.type === 'launchToEditableFile').map(({ subject, sample, elapsedMs }) => ({ subject, sample, elapsedMs }))
} : typeof manifest.inputProbe === 'boolean' ? {
	...common,
	kind: manifest.secondWindow ? 'second-window-first-ui-edit-diagnostic' : manifest.inputProbe ? 'first-ui-edit-diagnostic' : 'first-visible-file-diagnostic',
	definition: manifest.definition,
	settings: {
		samplesPerApp: manifest.samplesPerApp,
		warmupsPerApp: 1,
		pollIntervalMs: 20,
		remoteDebuggingPortEnabledForBothApps: true,
		macOSIdleSleepPreventedWithCaffeinate: true,
		warmCache: true
	},
	samples: samples.map(({ subject, sample, order, warmup, elapsedMs, firstWindowReadyMs }) => ({
		subject, sample, order, warmup, elapsedMs,
		...(manifest.secondWindow ? { firstWindowReadyMs } : {})
	}))
} : {
	...common,
	settings: manifest.settings,
	samples: samples.map(({ type, subject, sample, elapsedMs, physicalFootprintBytes, rssBytesDiagnostic, processCount }) => ({
		type, subject, sample,
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		...(physicalFootprintBytes !== undefined ? { physicalFootprintBytes } : {}),
		...(rssBytesDiagnostic !== undefined ? { rssBytesDiagnostic } : {}),
		...(processCount !== undefined ? { processCount } : {})
	}))
};

if (manifest.scenario && (samples.length !== 2 * manifest.samplesPerApp
	|| samples.some(sample => !Number.isFinite(sample.elapsedMs) || !Number.isFinite(sample.launchToWorkflowMs))
	|| Object.values(summary.metrics).some(metric => metric.count !== manifest.samplesPerApp || metric.failed !== 0))) {
	throw new Error('Do not publish an incomplete workflow benchmark.');
}
if (manifest.settings?.memoryOnly) {
	const memorySamples = samples.filter(sample => sample.type === 'wholeProcessTreeMemory');
	const expected = 2 * manifest.settings.memoryLaunches * manifest.settings.memorySamples;
	const captures = new Set(memorySamples.map(sample => `${sample.subject}:${sample.memoryLaunch}:${sample.sample}`));
	const complete = manifest.apps.every(app => {
		for (let launch = 1; launch <= manifest.settings.memoryLaunches; launch++) {
			for (let snapshot = 1; snapshot <= manifest.settings.memorySamples; snapshot++) {
				if (!captures.has(`${app.key}:${launch}:${snapshot}`)) { return false; }
			}
		}
		return summary.metrics[`${app.key}.wholeProcessTreeMemory`]?.count === manifest.settings.memoryLaunches * manifest.settings.memorySamples;
	});
	if (memorySamples.length !== expected || captures.size !== expected || !complete
		|| memorySamples.some(sample => !Number.isFinite(sample.physicalFootprintBytes) || !Number.isInteger(sample.memoryLaunch))) {
		throw new Error('Do not publish an incomplete memory comparison; inspect the raw launch and capture failures first.');
	}
}
if (manifest.settings?.startupOnly) {
	const timed = samples.filter(sample => sample.type === 'launchToEditableFile');
	const captures = new Set(timed.map(sample => `${sample.subject}:${sample.sample}`));
	const complete = manifest.apps.every(app => {
		for (let index = 1; index <= manifest.settings.samples; index++) {
			if (!captures.has(`${app.key}:${index}`)) { return false; }
		}
		return samples.filter(sample => sample.type === 'launchWarmup' && sample.subject === app.key).length === 1
			&& summary.metrics[`${app.key}.launchToEditableFile`]?.count === manifest.settings.samples;
	});
	if (samples.length !== 2 * (manifest.settings.samples + 1) || timed.length !== 2 * manifest.settings.samples
		|| captures.size !== timed.length || !complete || samples.some(sample => !Number.isFinite(sample.elapsedMs))) {
		throw new Error('Do not publish an incomplete editable-file startup comparison.');
	}
}
if (typeof manifest.inputProbe === 'boolean' && (samples.length !== 2 * (manifest.samplesPerApp + 1)
	|| samples.some(sample => !Number.isFinite(sample.elapsedMs))
	|| (manifest.secondWindow && samples.some(sample => !Number.isFinite(sample.firstWindowReadyMs)))
	|| Object.values(summary.metrics).some(metric => metric.count !== manifest.samplesPerApp || metric.failed !== 0))) {
	throw new Error('Do not publish an incomplete visible-file or first-typing benchmark.');
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote ${report.samples.length} public observations to ${output}`);
