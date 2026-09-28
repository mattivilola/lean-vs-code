/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { extensions, workspace } from 'vscode';
import type { GitExtension, API } from '../api/git';

suite('Git activation after startup', function () {
	test('activates without user action in a Git workspace', async function () {
		this.timeout(15_000);

		const git = extensions.getExtension<GitExtension>('vscode.git');
		assert(git, 'The bundled Git extension should be present.');
		assert(workspace.workspaceFolders?.some(folder => fs.existsSync(path.join(folder.uri.fsPath, '.git'))),
			'This test requires a Git workspace at startup.');

		const activationDeadline = Date.now() + 10_000;
		while (!git.isActive && Date.now() < activationDeadline) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.strictEqual(git.isActive, true, 'Git should activate after startup in a Git workspace.');

		const api: API = git.exports.getAPI(1);
		const repositoryDeadline = Date.now() + 10_000;
		while (api.repositories.length === 0 && Date.now() < repositoryDeadline) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert(api.repositories.length > 0, 'Git should discover the startup workspace repository.');
	});
});
