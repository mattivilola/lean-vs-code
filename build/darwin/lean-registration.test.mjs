/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { enableReleaseHandlers, registeredApps, unregisterApp } from './lean-registration.mjs';

const run = promisify(execFile);

test('registration cleanup matches the exact main bundle ID and preserves paths with spaces', () => {
	const block = (app, identifier) => `--------------------------------------------------------------------------------\nbundle id: Lean VS Code (0x1234)\npath: ${app} (0x456a)\nidentifier: ${identifier}\n`;
	assert.deepStrictEqual(registeredApps([
		block('/Applications/Lean VS Code.app', 'com.mattivilola.leanvscode'),
		block('/tmp/version 0.3/Lean VS Code.app', 'com.mattivilola.leanvscode'),
		block('/Applications/Lean VS Code.app', 'com.mattivilola.leanvscode'),
		block('/tmp/Lean VS Code Helper.app', 'com.mattivilola.leanvscode.helper'),
		block('/Applications/Another.app', 'com.another.editor'),
		block('/tmp/Candidate.app', 'com.mattivilola.leanvscode.perfcandidate')
	].join('\n')), ['/Applications/Lean VS Code.app', '/tmp/version 0.3/Lean VS Code.app']);
});

test('an incomplete sandbox registration dump cannot produce cleanup paths', () => {
	assert.deepStrictEqual(registeredApps('handlerpref id: public.plain-text\nall roles: com.mattivilola.leanvscode'), []);
});

test('test cleanup protects the installed app and skips other bundle identifiers', { skip: process.platform !== 'darwin' }, async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lean-registration-test-'));
	try {
		const info = path.join(directory, 'Other.app/Contents/Info.plist');
		await fs.mkdir(path.dirname(info), { recursive: true });
		await fs.writeFile(info, JSON.stringify({ CFBundleIdentifier: 'com.another.editor' }));
		await run('/usr/bin/plutil', ['-convert', 'xml1', info]);
		// Both calls return before invoking lsregister, including within a filesystem sandbox.
		await unregisterApp('/Applications/Lean VS Code.app');
		await unregisterApp(path.join(directory, 'Other.app'));
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('release preparation restores document and URL handlers using macOS plist tools', { skip: process.platform !== 'darwin' }, async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lean-registration-test-'));
	try {
		const app = path.join(directory, 'Lean VS Code.app');
		const info = path.join(app, 'Contents/Info.plist');
		await fs.mkdir(path.dirname(info), { recursive: true });
		const documents = [{ CFBundleTypeName: 'Plain text', CFBundleTypeRole: 'None', CFBundleTypeExtensions: ['txt'], LSHandlerRank: 'Alternate' }];
		await fs.writeFile(info, JSON.stringify({ CFBundleDisplayName: 'Lean VS Code', CFBundleDocumentTypes: documents, CFBundleURLTypes: [] }));
		await run('/usr/bin/plutil', ['-convert', 'xml1', info]);
		await enableReleaseHandlers(app, { nameLong: 'Lean VS Code', urlProtocol: 'lean-code' });
		const { stdout } = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info]);
		assert.deepStrictEqual(JSON.parse(stdout), {
			CFBundleDisplayName: 'Lean VS Code',
			CFBundleDocumentTypes: [{ ...documents[0], CFBundleTypeRole: 'Editor' }],
			CFBundleURLTypes: [{ CFBundleTypeRole: 'Viewer', CFBundleURLName: 'Lean VS Code', CFBundleURLSchemes: ['lean-code'] }]
		});
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
