/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Compare packaged app-bundle size. This is neither a runtime-memory measure
// nor a download-size comparison unless both DMGs are supplied separately.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readApp } from './benchmark.mjs';

const valueOptions = new Set(['--lean-app', '--oss-app', '--base-revision', '--lean-dmg', '--oss-dmg', '--output']);
const options = {};
for (let index = 2; index < process.argv.length; index++) {
	const key = process.argv[index];
	const value = process.argv[++index];
	if (!valueOptions.has(key) || !value || value.startsWith('--')) {
		throw new Error(`Expected one value after ${key}.`);
	}
	options[key] = value;
}
for (const required of ['--lean-app', '--oss-app', '--base-revision', '--output']) {
	if (!options[required]) {
		throw new Error(`Missing ${required}.`);
	}
}
if (!/^[0-9a-f]{40}$/i.test(options['--base-revision'])) {
	throw new Error('--base-revision must be a 40-character Git SHA.');
}
if (process.platform !== 'darwin') {
	throw new Error('The published bundle-size method uses macOS du.');
}

function duKiB(appPath, apparent) {
	const result = spawnSync('/usr/bin/du', [...(apparent ? ['-A'] : []), '-sk', appPath], { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`du failed for ${appPath}: ${result.stderr.trim()}`);
	}
	const value = Number.parseInt(result.stdout.split(/\s+/)[0], 10);
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`Could not parse du result for ${appPath}.`);
	}
	return value;
}

function sourceMapCount(root) {
	let count = 0;
	const pending = [root];
	while (pending.length) {
		const directory = pending.pop();
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const child = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				pending.push(child);
			} else if (entry.isFile() && entry.name.endsWith('.map')) {
				count++;
			}
		}
	}
	return count;
}

function measure(appPath, key, label, dmgPath) {
	const app = readApp(appPath, key, label);
	const appRoot = path.join(app.appPath, 'Contents/Resources/app');
	const packageVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
	const extensions = path.join(appRoot, 'extensions');
	const sections = {};
	for (const [name, relativePath] of Object.entries({
		workbenchOut: 'Contents/Resources/app/out',
		bundledExtensions: 'Contents/Resources/app/extensions',
		nodeModulesAsar: 'Contents/Resources/app/node_modules.asar',
		nodeModulesLoose: 'Contents/Resources/app/node_modules',
		electronFrameworks: 'Contents/Frameworks'
	})) {
		const fullPath = path.join(app.appPath, relativePath);
		sections[name] = fs.existsSync(fullPath) ? duKiB(fullPath, true) : null;
	}
	const result = {
		key,
		label,
		version: packageVersion,
		extensionApiVersion: app.version,
		productCommit: app.commit,
		appBundleApparentKiB: duKiB(app.appPath, true),
		appBundleAllocatedKiB: duKiB(app.appPath, false),
		sectionsApparentKiB: sections,
		bundledExtensionDirectories: fs.readdirSync(extensions, { withFileTypes: true }).filter(entry => entry.isDirectory()).length,
		sourceMapFiles: sourceMapCount(app.appPath)
	};
	if (dmgPath) {
		const resolvedDmg = path.resolve(dmgPath);
		result.dmgBytes = fs.statSync(resolvedDmg).size;
		const hash = spawnSync('/usr/bin/shasum', ['-a', '256', resolvedDmg], { encoding: 'utf8' });
		if (hash.status !== 0 || !/^[0-9a-f]{64}\s/.test(hash.stdout)) {
			throw new Error(`Could not hash DMG: ${resolvedDmg}`);
		}
		result.dmgSha256 = hash.stdout.slice(0, 64);
	}
	return result;
}

const lean = measure(options['--lean-app'], 'lean', 'Lean VS Code', options['--lean-dmg']);
const oss = measure(options['--oss-app'], 'code-oss', 'Code-OSS', options['--oss-dmg']);
const percentLess = (smaller, larger) => Number(((larger - smaller) / larger * 100).toFixed(1));
const report = {
	schemaVersion: 1,
	kind: 'packaged-app-bundle-size',
	createdAt: new Date().toISOString(),
	comparisonBaseRevision: options['--base-revision'],
	machine: { platform: process.platform, architecture: process.arch, osRelease: os.release() },
	method: 'macOS /usr/bin/du -A -sk for apparent app-bundle size and /usr/bin/du -sk for allocated space; symlinks are not followed. KiB units are 1024 bytes. App bundles were measured in place on the same Mac. DMG byte sizes are recorded only for supplied files and are not compared unless both exist.',
	apps: [lean, oss],
	comparison: {
		appBundleApparentPercentLess: percentLess(lean.appBundleApparentKiB, oss.appBundleApparentKiB),
		appBundleAllocatedPercentLess: percentLess(lean.appBundleAllocatedKiB, oss.appBundleAllocatedKiB),
		...(lean.dmgBytes && oss.dmgBytes ? { dmgPercentLess: percentLess(lean.dmgBytes, oss.dmgBytes) } : {})
	},
	limitations: 'This is a comparison with a locally repaired, ad-hoc-signed original Code-OSS source package, not Microsoft VS Code. It reflects bundled extensions, generated assets, and filesystem allocation. It does not establish process-memory use, download-size savings without two comparable DMGs, or the size of user-installed extensions and data.'
};
const output = path.resolve(options['--output']);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, comparison: report.comparison, leanApparentKiB: lean.appBundleApparentKiB, codeOssApparentKiB: oss.appBundleApparentKiB }, null, 2));
