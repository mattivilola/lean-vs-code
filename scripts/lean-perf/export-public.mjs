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
for (const metric of Object.values(summary.metrics)) {
	if (metric.count < 1) {
		throw new Error('Do not publish a benchmark with an empty metric.');
	}
}

const report = {
	schemaVersion: 1,
	createdAt: manifest.createdAt,
	comparisonBaseRevision: manifest.comparisonBaseRevision,
	machine: manifest.machine,
	settings: manifest.settings,
	apps: manifest.apps.map(({ key, label, version, commit }) => ({ key, label, version, commit })),
	metrics: summary.metrics,
	samples: samples.map(({ type, subject, sample, elapsedMs, physicalFootprintBytes, rssBytesDiagnostic, processCount }) => ({
		type, subject, sample,
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		...(physicalFootprintBytes !== undefined ? { physicalFootprintBytes } : {}),
		...(rssBytesDiagnostic !== undefined ? { rssBytesDiagnostic } : {}),
		...(processCount !== undefined ? { processCount } : {})
	}))
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(`Wrote ${report.samples.length} public observations to ${output}`);
