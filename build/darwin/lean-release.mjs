/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sign } from '@electron/osx-sign';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = (await fs.readFile(path.join(root, 'lean/VERSION'), 'utf8')).trim();
const product = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
const appName = 'Lean VS Code.app';
const source = path.join(root, '.build/lean-artifacts/LeanVSCode-darwin-arm64', appName);
const releaseDir = path.join(root, '.build/lean-artifacts/releases');
const basename = `Lean-VS-Code-${version}-macos-arm64`;
const output = path.join(releaseDir, `${basename}.dmg`);
const zipOutput = path.join(releaseDir, `${basename}.zip`);
const feedOutput = path.join(releaseDir, 'releases-darwin-arm64.json');
const identity = process.env.CODESIGN_IDENTITY;
const notaryProfile = process.env.NOTARY_KEYCHAIN_PROFILE;

if (!identity) {
	throw new Error('Set CODESIGN_IDENTITY to a Developer ID Application identity.');
}
if (!notaryProfile) {
	throw new Error('Set NOTARY_KEYCHAIN_PROFILE to a validated notarytool Keychain profile.');
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
	throw new Error(`Unexpected release version: ${version}`);
}
if (product.leanReleaseVersion !== version) {
	throw new Error(`product.json leanReleaseVersion must match lean/VERSION (${version}).`);
}
await fs.access(source);
for (const artifact of [output, zipOutput]) {
	try {
		await fs.access(artifact);
		throw new Error(`Release artifact already exists: ${artifact}`);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
}

const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'lean-vs-code-release-'));
const app = path.join(stage, appName);
const volume = path.join(stage, 'volume');
const notarizationZip = path.join(stage, 'notarization.zip');
const updateZip = path.join(stage, `${basename}.zip`);
const dmg = path.join(stage, `${basename}.dmg`);
const entitlementsDir = path.join(root, 'build/azure-pipelines/darwin');

function entitlementsForFile(filePath) {
	let file = 'app-entitlements.plist';
	if (filePath.includes(' Helper (GPU).app')) file = 'helper-gpu-entitlements.plist';
	else if (filePath.includes(' Helper (Renderer).app')) file = 'helper-renderer-entitlements.plist';
	else if (filePath.includes(' Helper (Plugin).app')) file = 'helper-plugin-entitlements.plist';
	else if (filePath.includes(' Helper.app')) file = 'helper-entitlements.plist';
	return path.join(entitlementsDir, file);
}

const machOMagic = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca]);

function ignoreNonCode(filePath) {
	if (filePath.endsWith('.app') || filePath.endsWith('.framework')) {
		return false;
	}
	const descriptor = fsSync.openSync(filePath, 'r');
	try {
		const header = Buffer.alloc(4);
		return fsSync.readSync(descriptor, header, 0, 4, 0) !== 4 || !machOMagic.has(header.readUInt32BE(0));
	} finally {
		fsSync.closeSync(descriptor);
	}
}

async function sha256(filePath) {
	const digest = createHash('sha256');
	for await (const chunk of fsSync.createReadStream(filePath)) {
		digest.update(chunk);
	}
	return digest.digest('hex');
}

async function signDmg(filePath) {
	let lastError;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await run('codesign', ['--force', '--sign', identity, '--timestamp', '--options', 'runtime', filePath]);
			return;
		} catch (error) {
			lastError = error;
			console.warn(`DMG signing attempt ${attempt}/3 failed: ${error.stderr?.trim() || error.message}`);
			if (attempt < 3) {
				await new Promise(resolve => setTimeout(resolve, 10_000));
			}
		}
	}
	throw lastError;
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
		// osx-sign's binary heuristic also selects Electron .pak and snapshot data.
		// Sign Mach-O code and nested bundles; the outer bundle seals resources.
		ignore: ignoreNonCode,
		preAutoEntitlements: false,
		preEmbedProvisioningProfile: false,
		optionsForFile: filePath => ({ entitlements: entitlementsForFile(filePath), hardenedRuntime: true })
	});
	await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
	console.log('Notarizing the signed app before packaging updates');
	await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, notarizationZip]);
	await run('xcrun', ['notarytool', 'submit', notarizationZip, '--keychain-profile', notaryProfile, '--wait']);
	await run('xcrun', ['stapler', 'staple', app]);
	await run('xcrun', ['stapler', 'validate', app]);
	await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
	await run('spctl', ['-a', '-vv', app]);

	await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, updateZip]);
	await run('unzip', ['-tq', updateZip]);

	await fs.mkdir(volume);
	await run('ditto', [app, path.join(volume, appName)]);
	await fs.symlink('/Applications', path.join(volume, 'Applications'));
	console.log(`Creating ${path.basename(dmg)}`);
	await run('hdiutil', ['create', '-volname', 'Lean VS Code', '-srcfolder', volume, '-format', 'UDZO', '-imagekey', 'zlib-level=9', dmg]);
	await signDmg(dmg);
	await run('codesign', ['--verify', '--verbose=2', dmg]);
	await run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', notaryProfile, '--wait']);
	await run('xcrun', ['stapler', 'staple', dmg]);
	await run('xcrun', ['stapler', 'validate', dmg]);
	await run('spctl', ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', dmg]);

	const zipHash = await sha256(updateZip);
	const dmgHash = await sha256(dmg);
	const feed = {
		currentRelease: version,
		releases: [{
			version,
			updateTo: {
				version,
				name: version,
				notes: `Lean VS Code ${version}`,
				url: `https://github.com/mattivilola/lean-vs-code/releases/download/v${version}/${basename}.zip`,
				sha256: zipHash,
				size: (await fs.stat(updateZip)).size
			}
		}]
	};
	await fs.mkdir(releaseDir, { recursive: true });
	await fs.rename(updateZip, zipOutput);
	await fs.rename(dmg, output);
	await fs.writeFile(feedOutput, `${JSON.stringify(feed, null, 2)}\n`);
	console.log(`Signed and notarized DMG: ${output} (SHA-256 ${dmgHash})`);
	console.log(`Signed and notarized update ZIP: ${zipOutput} (SHA-256 ${zipHash})`);
	console.log(`Static update feed: ${feedOutput}`);
} finally {
	await fs.rm(stage, { recursive: true, force: true });
}
