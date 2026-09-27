/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Paired GUI timings for a first-use developer workflow after extension startup.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { percentile, readApp } from './benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const smokeScript = path.join(root, 'scripts/lean-perf/functional-smoke.mjs');
const valueOptions = new Set(['--lean-app', '--oss-app', '--base-revision', '--scenario', '--samples', '--output-root']);
const options = {};
for (let index = 2; index < process.argv.length; index++) {
	const key = process.argv[index];
	const value = process.argv[++index];
	if (!valueOptions.has(key) || !value || value.startsWith('--')) {
		throw new Error(`Expected one value after ${key}.`);
	}
	options[key] = value;
}
for (const required of ['--lean-app', '--oss-app', '--base-revision', '--scenario']) {
	if (!options[required]) {
		throw new Error(`Missing ${required}.`);
	}
}
if (!/^[0-9a-f]{40}$/i.test(options['--base-revision'])) {
	throw new Error('--base-revision must be a 40-character Git SHA.');
}
const scenario = options['--scenario'];
if (!new Set(['gitReview', 'integratedTerminal', 'workspaceSearch', 'editableFileAndSave', 'extensionWebview']).has(scenario)) {
	throw new Error(`Unsupported scenario: ${scenario}`);
}
const count = Number(options['--samples'] ?? 30);
if (!Number.isSafeInteger(count) || count < 1) {
	throw new Error('--samples must be a positive integer.');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
	throw new Error('This benchmark requires macOS Apple Silicon.');
}

const apps = [
	readApp(options['--lean-app'], 'lean', 'Lean VS Code'),
	readApp(options['--oss-app'], 'code-oss', 'Code-OSS')
];
const runId = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
const runDir = path.join(path.resolve(options['--output-root'] ?? '.build/lean-artifacts/workflow-benchmarks'), runId);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
	createdAt: new Date().toISOString(),
	scenario,
	definition: `Two metrics: first-use action duration inside the temporary onStartupFinished extension, and process spawn to completed workflow. Each fresh app launch uses an isolated profile and one-file Git fixture.`,
	pollIntervalMs: 20,
	comparisonBaseRevision: options['--base-revision'],
	machine: { platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model, osRelease: os.release() },
	samplesPerApp: count,
	apps: apps.map(({ key, version, commit }) => ({ key, version, commit }))
}, null, 2) + '\n');
const rawPath = path.join(runDir, 'samples.jsonl');
fs.writeFileSync(rawPath, '');

async function trial(app, index, order) {
	const startedAt = new Date().toISOString();
	const child = spawn(process.execPath, [smokeScript, app.appPath, scenario], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
	child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
	const code = await new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('close', resolve);
	});
	const artifactDir = stdout.match(/Functional smoke artifacts: ([^\r\n]+)/)?.[1];
	let result;
	if (artifactDir && fs.existsSync(path.join(artifactDir, 'result.json'))) {
		result = JSON.parse(fs.readFileSync(path.join(artifactDir, 'result.json'), 'utf8'));
	}
	const check = result?.checks?.[scenario];
	const sample = {
		type: scenario, subject: app.key, sample: index + 1, order, startedAt,
		elapsedMs: code === 0 && check?.ok && Number.isFinite(check.durationMs) ? check.durationMs : null,
		launchToWorkflowMs: code === 0 && check?.ok && Number.isFinite(result?.launchToChecksMs) ? result.launchToChecksMs : null,
		...(code !== 0 || !check?.ok ? { error: check?.error || result?.fatal || stderr.trim().slice(-1000) || `Smoke exited ${code}` } : {})
	};
	fs.appendFileSync(rawPath, JSON.stringify(sample) + '\n');
	return sample;
}

console.log(`Writing ${scenario} benchmark to ${runDir}`);
const samples = [];
for (let index = 0; index < count; index++) {
	for (const [order, app] of (index % 2 ? [...apps].reverse() : apps).entries()) {
		const sample = await trial(app, index, order + 1);
		samples.push(sample);
		console.log(`${app.key} ${index + 1}/${count}: ${sample.elapsedMs ?? sample.error}`);
	}
}
const metrics = {};
for (const app of apps) {
	const values = samples.filter(sample => sample.subject === app.key && sample.elapsedMs !== null).map(sample => sample.elapsedMs);
	const totalValues = samples.filter(sample => sample.subject === app.key && sample.launchToWorkflowMs !== null).map(sample => sample.launchToWorkflowMs);
	metrics[app.key] = {
		count: values.length,
		failed: count - values.length,
		p50: values.length ? percentile(values, 0.5) : null,
		p95: values.length ? percentile(values, 0.95) : null,
		launchToWorkflowP50: totalValues.length ? percentile(totalValues, 0.5) : null,
		launchToWorkflowP95: totalValues.length ? percentile(totalValues, 0.95) : null
	};
}
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ scenario, metrics }, null, 2) + '\n');
console.log(JSON.stringify(metrics, null, 2));
if (Object.values(metrics).some(metric => metric.failed)) {
	process.exitCode = 1;
}
