/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

// Representative GUI release checks in an isolated profile and Git fixture.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const appArg = process.argv[2];
if (!appArg) {
	console.error('Usage: node scripts/lean-perf/functional-smoke.mjs <App.app> [scenario]');
	process.exit(2);
}
const scenario = process.argv[3] ?? 'all';
const scenarios = new Set(['all', 'editableFileAndSave', 'workspaceSearch', 'workspaceTextSearch', 'integratedTerminal', 'gitReview', 'extensionWebview']);
if (!scenarios.has(scenario)) {
	throw new Error(`Unknown functional smoke scenario: ${scenario}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = path.resolve(appArg);
const product = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8'));
const executable = path.join(app, 'Contents/MacOS', product.nameShort);
fs.accessSync(executable, fs.constants.X_OK);

const outputRoot = path.join(root, '.build/lean-artifacts/functional-smoke');
fs.mkdirSync(outputRoot, { recursive: true });
const runDir = fs.mkdtempSync(path.join(outputRoot, `${new Date().toISOString().replace(/[:.]/g, '')}-`));
const workspace = path.join(runDir, 'workspace');
const extension = path.join(runDir, 'extension');
// VS Code's macOS IPC socket requires a short profile path.
const profile = fs.mkdtempSync('/private/tmp/lean-smoke-');
const resultPath = path.join(runDir, 'result.json');
const appLog = path.join(runDir, 'app.log');
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.mkdirSync(extension);
fs.writeFileSync(path.join(runDir, 'profile-path.txt'), `${profile}\n`);
fs.mkdirSync(path.join(profile, 'user-data/User'), { recursive: true });
fs.writeFileSync(path.join(profile, 'user-data/User/settings.json'), JSON.stringify({
	'security.workspace.trust.enabled': false,
	'terminal.integrated.defaultProfile.osx': 'zsh'
}, null, 2) + '\n');
fs.writeFileSync(path.join(workspace, 'src/main.ts'), 'export const value = 1;\n');
if (scenario === 'workspaceTextSearch') {
	for (let index = 0; index < 400; index++) {
		const marker = index % 40 === 0 ? '// lean-search-target\n' : '';
		fs.writeFileSync(path.join(workspace, 'src', `module${String(index).padStart(3, '0')}.ts`), `${marker}export const value${index} = ${index};\n`);
	}
}

function git(...args) {
	const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`Fixture git ${args[0]} failed: ${result.stderr}`);
	}
}
git('init', '-q');
git('config', 'user.name', 'Lean Smoke');
git('config', 'user.email', 'lean-smoke@example.invalid');
git('add', '.');
git('commit', '-qm', 'fixture baseline');
fs.appendFileSync(path.join(workspace, 'src/main.ts'), '// lean-smoke-marker\n');

fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
	name: 'lean-functional-smoke', publisher: 'lean-smoke', version: '0.0.1',
	engines: { vscode: '^1.80.0' }, main: './extension.cjs', activationEvents: ['onStartupFinished'],
	...(scenario === 'workspaceTextSearch' ? { enabledApiProposals: ['findTextInFiles'] } : {})
}, null, 2) + '\n');
fs.copyFileSync(path.join(root, 'scripts/lean-perf/functional-smoke-extension.cjs'), path.join(extension, 'extension.cjs'));

const args = [
	'--new-window', `--user-data-dir=${path.join(profile, 'user-data')}`,
	`--shared-data-dir=${path.join(profile, 'shared-data')}`,
	`--extensions-dir=${path.join(profile, 'extensions')}`,
	`--extensionDevelopmentPath=${extension}`,
	...(scenario === 'workspaceTextSearch' ? ['--enable-proposed-api=lean-smoke.lean-functional-smoke'] : []),
	'--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry',
	`--folder-uri=${pathToFileURL(workspace)}`, path.join(workspace, 'src/main.ts')
];
const logFd = fs.openSync(appLog, 'w');
const appLaunchedAtMs = Date.now();
const child = spawn(executable, args, {
	cwd: workspace,
	env: { ...process.env, LEAN_SMOKE_WORKSPACE: workspace, LEAN_SMOKE_RESULT: resultPath, LEAN_SMOKE_SCENARIO: scenario },
	stdio: ['ignore', logFd, logFd]
});
fs.closeSync(logFd);

try {
	const deadline = Date.now() + 120000;
	while (!fs.existsSync(resultPath) && Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(`App exited before reporting checks: ${child.exitCode ?? child.signalCode}`);
		}
		await delay(200);
	}
	if (!fs.existsSync(resultPath)) {
		throw new Error('Timed out waiting for functional checks');
	}
	const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
	const completedAtMs = scenario === 'all'
		? Date.parse(result.createdAt)
		: result.checks?.[scenario]?.completedAtMs;
	if (Number.isFinite(completedAtMs)) {
		result.launchToChecksMs = completedAtMs - appLaunchedAtMs;
		fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
	}
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) {
		process.exitCode = 1;
	}
} catch (error) {
	console.error(error.message);
	console.error(fs.readFileSync(appLog, 'utf8').slice(-2500));
	process.exitCode = 1;
} finally {
	if (child.exitCode === null && child.signalCode === null) {
		await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
	}
	if (child.exitCode === null && child.signalCode === null) {
		child.kill('SIGTERM');
	}
	console.log(`Functional smoke artifacts: ${runDir}`);
}
