/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const bundleIdentifier = 'com.mattivilola.leanvscode';
const installedApp = '/Applications/Lean VS Code.app';

function canonicalPath(app) {
	try {
		return realpathSync(app);
	} catch {
		return path.resolve(app);
	}
}

/** Extract only primary Lean VS Code bundles, never helpers or other applications. */
export function registeredApps(dump) {
	return [...new Set(dump.split(/^-{20,}\s*$/m).flatMap(block => {
		const identifier = block.match(/^identifier:\s+(.+)$/m)?.[1].trim();
		const app = block.match(/^path:\s+(.+)$/m)?.[1].replace(/ \(0x[\da-f]+\)\s*$/i, '').trim();
		return identifier === bundleIdentifier && app?.startsWith('/') && app.endsWith('.app') ? [app] : [];
	}))];
}

/** Restore release associations before signing, without changing source/development bundles. */
export async function enableReleaseHandlers(app, product) {
	const info = path.join(app, 'Contents/Info.plist');
	const { stdout } = await run('/usr/bin/plutil', ['-extract', 'CFBundleDocumentTypes', 'json', '-o', '-', info]);
	const documents = JSON.parse(stdout);
	if (!Array.isArray(documents) || !documents.length) {
		throw new Error('Release bundle has no document-type declarations.');
	}
	await run('/usr/bin/plutil', ['-replace', 'CFBundleDocumentTypes', '-json', JSON.stringify(documents.map(document => ({ ...document, CFBundleTypeRole: 'Editor' }))), info]);
	await run('/usr/bin/plutil', ['-replace', 'CFBundleURLTypes', '-json', JSON.stringify([{
		CFBundleTypeRole: 'Viewer', CFBundleURLName: product.nameLong, CFBundleURLSchemes: [product.urlProtocol]
	}]), info]);
}

/** Remove a test/staging copy's registration, preserving the canonical installation and all files. */
export async function unregisterApp(app, runner = run) {
	if (process.platform !== 'darwin' || canonicalPath(app) === canonicalPath(installedApp)) {
		return;
	}
	const info = path.join(app, 'Contents/Info.plist');
	if (existsSync(info)) {
		const { stdout } = await runner('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', info]);
		if (stdout.trim() !== bundleIdentifier) {
			return;
		}
	}
	try {
		await runner(lsregister, ['-u', path.resolve(app)]);
	} catch (error) {
		// Mounted/staged copies can already be absent from Launch Services. Do not
		// hide a real failure or mistake an incomplete sandbox dump for that case.
		if (String(error.stderr ?? '').includes('-10814')) {
			try {
				const { stdout } = await runner(lsregister, ['-dump'], { maxBuffer: 64 * 1024 * 1024 });
				const apps = registeredApps(stdout).map(canonicalPath);
				if (apps.includes(canonicalPath(installedApp)) && !apps.includes(canonicalPath(app))) {
					return;
				}
			} catch { /* Preserve the original failure if absence cannot be proved. */ }
		}
		throw error;
	}
}

/** Consolidate this app's registrations without rebuilding the system database or deleting bundles. */
async function cleanRegistrations(apply) {
	if (process.platform !== 'darwin') {
		throw new Error('Launch Services cleanup requires macOS.');
	}
	const { stdout: identifier } = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(installedApp, 'Contents/Info.plist')]);
	if (identifier.trim() !== bundleIdentifier) {
		throw new Error('Canonical installation has an unexpected bundle identifier.');
	}
	const dump = async () => registeredApps((await run(lsregister, ['-dump'], { maxBuffer: 64 * 1024 * 1024 })).stdout);
	const apps = await dump();
	// Sandboxed lsregister can return an incomplete database with no application rows.
	if (!apps.includes(installedApp)) {
		throw new Error('Installed app is absent from the registration dump; run outside the filesystem sandbox.');
	}
	const duplicates = apps.filter(app => app !== installedApp);
	console.log(`Keep: ${installedApp}`);
	for (const app of duplicates) {
		console.log(`${apply ? 'Unregister' : 'Would unregister'}: ${app}`);
		if (apply) {
			await unregisterApp(app);
		}
	}
	if (apply) {
		await run(lsregister, ['-f', installedApp]);
		const remaining = await dump();
		if (remaining.length !== 1 || remaining[0] !== installedApp) {
			throw new Error(`Unexpected remaining registrations: ${JSON.stringify(remaining)}`);
		}
	}
	console.log(`${apply ? 'Removed' : 'Found'} ${duplicates.length} duplicate registrations. No app files or user data deleted.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	if (args.length > 1 || (args.length && args[0] !== '--apply')) {
		throw new Error('Usage: node build/darwin/lean-registration.mjs [--apply]');
	}
	await cleanRegistrations(args[0] === '--apply');
}
