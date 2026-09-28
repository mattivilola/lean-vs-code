/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Attribute a diagnostic V8 CPU profile to sources in its exact build map.
import fs from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const [profilePath, sourceMapPath] = process.argv.slice(2);
if (!profilePath || !sourceMapPath) {
	console.error('Usage: node scripts/lean-perf/summarize-renderer-profile.mjs <profile.json> <matching-workbench.js.map>');
	process.exit(2);
}

const diagnostic = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const profile = diagnostic.profile;
if (!Array.isArray(profile?.nodes) || !Array.isArray(profile?.samples) || !Array.isArray(profile?.timeDeltas)) {
	throw new Error('Missing V8 CPU profile nodes, samples, or time deltas.');
}
if (profile.samples.length !== profile.timeDeltas.length) {
	throw new Error('CPU sample and time-delta counts differ.');
}
const map = new TraceMap(fs.readFileSync(sourceMapPath, 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const bySource = new Map();
const byFunction = new Map();
let mappedSamples = 0;
let totalMicros = 0;

for (let index = 0; index < profile.samples.length; index++) {
	const node = nodes.get(profile.samples[index]);
	const delta = profile.timeDeltas[index];
	const frame = node?.callFrame;
	let source = '(outside workbench bundle)';
	let functionName = frame?.functionName || '(anonymous)';
	if (frame?.url.endsWith('/vs/workbench/workbench.desktop.main.js')) {
		const location = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber });
		source = location.source ? path.normalize(location.source) : '(unmapped workbench code)';
		if (location.source) {
			mappedSamples++;
		}
	}
	bySource.set(source, (bySource.get(source) ?? 0) + delta);
	const key = `${source} :: ${functionName}`;
	byFunction.set(key, (byFunction.get(key) ?? 0) + delta);
	totalMicros += delta;
}

function topRows(values, count) {
	return [...values].sort((a, b) => b[1] - a[1]).slice(0, count);
}

console.log(`App commit: ${diagnostic.productCommit}`);
console.log(`Samples: ${profile.samples.length}; mapped workbench samples: ${mappedSamples}`);
console.log(`Sample interval time: ${(totalMicros / 1000).toFixed(1)} ms (includes idle; not a startup timing result)`);
console.log('Top source files by sampled intervals:');
for (const [source, micros] of topRows(bySource, 25)) {
	console.log(`${(micros / 1000).toFixed(1).padStart(7)} ms  ${source}`);
}
console.log('Top functions by sampled intervals:');
for (const [name, micros] of topRows(byFunction, 20)) {
	console.log(`${(micros / 1000).toFixed(1).padStart(7)} ms  ${name}`);
}
