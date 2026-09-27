/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Loaded as a temporary development extension by functional-smoke.mjs.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const workspaceRoot = process.env.LEAN_SMOKE_WORKSPACE;
const resultPath = process.env.LEAN_SMOKE_RESULT;
const scenario = process.env.LEAN_SMOKE_SCENARIO ?? 'all';
const pollIntervalMs = scenario === 'all' ? 200 : 20;

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function waitFor(predicate, description, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) {
			return value;
		}
		await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

async function run() {
	const checks = {};
	async function check(name, action) {
		if (scenario !== 'all' && scenario !== name) {
			return;
		}
		const started = performance.now();
		let completedAtMs;
		let completedDurationMs;
		const markCompleted = () => {
			if (completedAtMs === undefined) {
				completedAtMs = Date.now();
				completedDurationMs = performance.now() - started;
			}
		};
		try {
			const detail = await action(markCompleted);
			markCompleted();
			checks[name] = { ok: true, detail, completedAtMs, durationMs: Number(completedDurationMs.toFixed(3)) };
		} catch (error) {
			checks[name] = { ok: false, error: String(error?.stack ?? error), durationMs: Number((performance.now() - started).toFixed(3)) };
		}
	}

	const sourcePath = path.join(workspaceRoot, 'src', 'main.ts');
	await check('editableFileAndSave', async (markCompleted) => {
		const original = fs.readFileSync(sourcePath, 'utf8');
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
		const editor = await vscode.window.showTextDocument(document);
		try {
			assert(await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// lean smoke\n')), 'Editor rejected insertion');
			assert(await document.save(), 'Editor did not save');
			assert(fs.readFileSync(sourcePath, 'utf8').startsWith('// lean smoke\n'), 'Saved bytes differ');
			markCompleted();
			return 'inserted, saved, and verified on disk';
		} finally {
			await editor.edit(builder => builder.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), original));
			await document.save();
		}
	});

	await check('workspaceSearch', async () => {
		const files = await vscode.workspace.findFiles('src/**/*.ts');
		assert(files.some(uri => uri.fsPath === sourcePath), 'Workspace file search missed src/main.ts');
		await vscode.commands.executeCommand('workbench.action.findInFiles', { query: 'lean-smoke-marker' });
		return `${files.length} TypeScript files found; search UI opened`;
	});

	await check('integratedTerminal', async () => {
		const marker = path.join(workspaceRoot, 'terminal-result.txt');
		const terminal = vscode.window.createTerminal({ name: 'Lean release smoke', cwd: workspaceRoot });
		try {
			terminal.show(false);
			terminal.sendText(`printf terminal-ok > '${marker}'`, true);
			await waitFor(() => fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === 'terminal-ok', 'terminal command', 30000);
			return 'integrated terminal executed a command';
		} finally {
			terminal.dispose();
		}
	});

	await check('gitReview', async () => {
		await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === sourcePath, 'requested file active in the editor');
		await vscode.commands.executeCommand('workbench.view.scm');
		const extension = await waitFor(() => vscode.extensions.getExtension('vscode.git'), 'bundled Git extension activation');
		const exports = await extension.activate();
		const api = exports.getAPI(1);
		const repository = await waitFor(() => api.repositories.find(repo => repo.rootUri.fsPath === workspaceRoot), 'Git repository discovery');
		const diff = await repository.diff();
		assert(diff.includes('lean-smoke-marker'), 'Git diff did not show the local change');
		return 'bundled Git API discovered repository and reviewed its diff';
	});

	await check('extensionWebview', async () => {
		const panel = vscode.window.createWebviewPanel('leanSmokeWebview', 'Lean smoke webview', vscode.ViewColumn.Beside);
		try {
			panel.webview.html = '<!doctype html><html><body>Lean extension webview</body></html>';
			return 'extension webview panel created and HTML assigned';
		} finally {
			panel.dispose();
		}
	});

	const result = { createdAt: new Date().toISOString(), app: vscode.env.appName, scenario, checks, passed: Object.values(checks).every(check => check.ok) };
	fs.mkdirSync(path.dirname(resultPath), { recursive: true });
	fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
	setTimeout(() => { void vscode.commands.executeCommand('workbench.action.quit'); }, 100);
}

function activate() {
	if (workspaceRoot && resultPath) {
		void run().catch(error => {
			fs.writeFileSync(resultPath, JSON.stringify({ fatal: String(error?.stack ?? error) }, null, 2) + '\n');
		void vscode.commands.executeCommand('workbench.action.quit');
		});
	}
}

module.exports = { activate };
