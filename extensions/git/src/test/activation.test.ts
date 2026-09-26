/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { commands, extensions, workspace } from 'vscode';

suite('Git activation on demand', function () {
	test('opens the Source Control view without scanning Git on folder open', async function () {
		this.timeout(15_000);

		const git = extensions.getExtension('vscode.git');
		assert(git, 'The bundled Git extension should be present.');
		assert(workspace.workspaceFolders?.some(folder => fs.existsSync(path.join(folder.uri.fsPath, '.git'))),
			'This test requires a Git workspace at startup.');

		// The integration runner opens a Git workspace with a fresh profile. Give
		// startup activation events time to settle before checking the idle state.
		await new Promise(resolve => setTimeout(resolve, 1_500));
		assert.strictEqual(git.isActive, false, 'Opening a Git folder should not activate Git.');

		await commands.executeCommand('workbench.view.scm');
		const deadline = Date.now() + 10_000;
		while (!git.isActive && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.strictEqual(git.isActive, true, 'Opening Source Control should activate Git.');
	});
});
