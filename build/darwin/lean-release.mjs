/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sign } from '@electron/osx-sign';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = (await fs.readFile(path.join(root, 'lean/VERSION'), 'utf8')).trim();
const product = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
const appName = 'Lean VS Code.app';
const source = path.join(root, '.build/lean-artifacts/LeanVSCode-darwin-arm64', appName);
const output = path.join(root, '.build/lean-artifacts/releases', `Lean-VS-Code-${version}-macos-arm64.dmg`);
const identity = process.env.CODESIGN_IDENTITY;

if (!identity) {
	throw new Error('Set CODESIGN_IDENTITY to a Developer ID Application identity.');
}
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)) {
	throw new Error(`Unexpected release version: ${version}`);
}
if (product.leanReleaseVersion !== version) {
	throw new Error(`product.json leanReleaseVersion must match lean/VERSION (${version}).`);
}
await fs.access(source);
try {
	await fs.access(output);
	throw new Error(`Release artifact already exists: ${output}`);
} catch (error) {
	if (error.code !== 'ENOENT') {
		throw error;
	}
}

const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'lean-vs-code-release-'));
const app = path.join(stage, appName);
const volume = path.join(stage, 'volume');
const entitlementsDir = path.join(root, 'build/azure-pipelines/darwin');

function entitlementsForFile(filePath) {
	let file = 'app-entitlements.plist';
	if (filePath.includes(' Helper (GPU).app')) file = 'helper-gpu-entitlements.plist';
	else if (filePath.includes(' Helper (Renderer).app')) file = 'helper-renderer-entitlements.plist';
	else if (filePath.includes(' Helper (Plugin).app')) file = 'helper-plugin-entitlements.plist';
	else if (filePath.includes(' Helper.app')) file = 'helper-entitlements.plist';
	return path.join(entitlementsDir, file);
}

async function removeSourceMaps(directory) {
	let removed = 0;
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			removed += await removeSourceMaps(entryPath);
		} else if (entry.isFile() && entry.name.endsWith('.map')) {
			await fs.rm(entryPath);
			removed++;
		}
	}
	return removed;
}

async function verifyBundledExtensions(app) {
	const expected = JSON.parse(await fs.readFile(path.join(root, 'lean/bundled-extensions.json'), 'utf8')).sort();
	const extensionRoot = path.join(app, 'Contents/Resources/app/extensions');
	const actual = (await fs.readdir(extensionRoot, { withFileTypes: true }))
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Bundled extension inventory differs from allowlist: ${actual.join(', ')}`);
	}
	for (const name of actual) {
		const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, name, 'package.json'), 'utf8'));
		if ((manifest.main || manifest.browser) && name !== 'git' && name !== 'git-base') {
			throw new Error(`Unexpected executable bundled extension: ${name}`);
		}
	}
	console.log(`Verified ${actual.length} bundled extensions; only Git and Git Base execute code`);
}

try {
	console.log(`Copying ${appName} to release staging`);
	await run('ditto', [source, app]);
	const removedSourceMaps = await removeSourceMaps(path.join(app, 'Contents/Resources/app/out'));
	console.log(`Removed ${removedSourceMaps} development source maps from release copy`);
	await verifyBundledExtensions(app);
	await fs.access(path.join(app, 'Contents/Resources/app/node_modules.asar.unpacked/@vscode/vsce-sign/bin/vsce-sign'));
	const info = path.join(app, 'Contents/Info.plist');
	const shortVersion = version.split('-')[0];
	await run('plutil', ['-replace', 'CFBundleShortVersionString', '-string', shortVersion, info]);
	await run('plutil', ['-replace', 'CFBundleVersion', '-string', shortVersion, info]);
	await run('plutil', ['-insert', 'CFBundleGetInfoString', '-string', `Lean VS Code ${version} (Code-OSS 1.139.1)`, info]);

	console.log(`Signing ${appName} with Developer ID`);
	await sign({
		app,
		platform: 'darwin',
		identity,
		preAutoEntitlements: false,
		preEmbedProvisioningProfile: false,
		optionsForFile: filePath => ({ entitlements: entitlementsForFile(filePath), hardenedRuntime: true })
	});
	await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);

	await fs.mkdir(volume);
	await run('ditto', [app, path.join(volume, appName)]);
	await fs.symlink('/Applications', path.join(volume, 'Applications'));
	await fs.mkdir(path.dirname(output), { recursive: true });
	console.log(`Creating ${path.basename(output)}`);
	await run('hdiutil', ['create', '-volname', 'Lean VS Code', '-srcfolder', volume, '-format', 'UDZO', '-imagekey', 'zlib-level=9', output]);
	await run('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', output]);
	await run('codesign', ['--verify', '--verbose=2', output]);
	console.log(`Signed DMG: ${output}`);
} finally {
	await fs.rm(stage, { recursive: true, force: true });
}
