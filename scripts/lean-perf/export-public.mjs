/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs';
import path from 'node:path';

const [runDirectory, outputFile] = process.argv.slice(2);
if (!runDirectory || !outputFile || process.argv.length !== 4) {
	throw new Error('Usage: node scripts/lean-perf/export-public.mjs <run-directory> <output-file>');
}

const run = path.resolve(runDirectory);
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(run, 'summary.json'), 'utf8'));
const samples = fs.readFileSync(path.join(run, 'samples.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
if (samples.some(sample => sample.error || sample.captureError)) {
	throw new Error('The run contains failed or incomplete samples; do not publish it as a complete benchmark.');
}

const exportedSamples = samples.map(sample => {
	if (sample.type === 'wholeProcessTreeMemory') {
		return {
			type: sample.type,
			subject: sample.subject,
			sample: sample.sample,
			physicalFootprintBytes: sample.physicalFootprintBytes,
			rssBytesDiagnostic: sample.rssBytesDiagnostic,
			processCount: sample.processes.length
		};
	}
	return {
		type: sample.type,
		subject: sample.subject,
		sample: sample.sample,
		elapsedMs: sample.elapsedMs
	};
});

const report = {
	schemaVersion: 1,
	createdAt: summary.createdAt,
	comparisonBaseRevision: manifest.comparisonBaseRevision,
	machine: manifest.machine,
	settings: manifest.settings,
	apps: manifest.apps.map(({ key, label, version, commit }) => ({ key, label, version, commit })),
	metrics: summary.metrics,
	samples: exportedSamples
};

fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(path.resolve(outputFile), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`Wrote public benchmark report: ${path.resolve(outputFile)}\n`);
