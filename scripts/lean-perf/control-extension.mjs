/*---------------------------------------------------------------------------------------------
 * Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function xml(value) {
	return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function createControlVSIX(extensionPath, vsixPath) {
	if (fs.existsSync(vsixPath)) {
		throw new Error(`Control VSIX already exists: ${vsixPath}`);
	}
	const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));
	const { publisher, name, version } = manifest;
	const engine = manifest.engines?.vscode;
	if (![publisher, name, version, engine].every(value => typeof value === 'string' && value.length > 0)) {
		throw new Error('Control extension needs publisher, name, version, and engines.vscode in package.json.');
	}
	const minimumEngine = engine.match(/\d+\.\d+\.\d+/)?.[0];
	if (!minimumEngine) {
		throw new Error(`Control extension has an unsupported VS Code engine range: ${engine}`);
	}
	const staging = `${vsixPath}.contents`;
	fs.mkdirSync(staging);
	fs.cpSync(extensionPath, path.join(staging, 'extension'), { recursive: true });
	fs.writeFileSync(path.join(staging, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
	<Metadata>
		<Identity Id="${xml(name)}" Version="${xml(version)}" Language="en-US" Publisher="${xml(publisher)}" />
		<DisplayName>${xml(manifest.displayName ?? name)}</DisplayName>
		<Description xml:space="preserve">${xml(manifest.description ?? 'Temporary performance control extension')}</Description>
		<Categories>Other</Categories>
		<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(engine)}" /></Properties>
	</Metadata>
	<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[${xml(minimumEngine)},)" /></Installation>
	<Dependencies />
	<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>
`, { flag: 'wx' });
	fs.writeFileSync(path.join(staging, '[Content_Types].xml'), `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="vsixmanifest" ContentType="text/xml" />
	<Default Extension="json" ContentType="application/json" />
	<Default Extension="js" ContentType="application/javascript" />
</Types>
`, { flag: 'wx' });
	const result = spawnSync('/usr/bin/zip', ['-r', '-X', vsixPath, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], {
		cwd: staging, encoding: 'utf8', maxBuffer: 1024 * 1024
	});
	if (result.error || result.status !== 0) {
		throw result.error ?? new Error(`Could not create control VSIX: ${(result.stderr || result.stdout).trim()}`);
	}
	return { path: vsixPath, publisher, name, version };
}

export function installControlExtension(app, vsix, profile) {
	if (!app.cliScript) {
		throw new Error(`${app.label} has no executable CLI script to install the control extension.`);
	}
	const userDataDir = path.join(profile, 'user-data');
	const extensionsDir = path.join(profile, 'extensions');
	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extensionsDir, { recursive: true });
	const installed = fs.readdirSync(extensionsDir).find(entry => entry.startsWith(`${vsix.publisher}.${vsix.name}-${vsix.version}`)
		&& fs.existsSync(path.join(extensionsDir, entry, 'package.json'))
		&& fs.existsSync(path.join(extensionsDir, entry, 'extension.js')));
	if (installed) {
		return;
	}
	const result = spawnSync(app.cliScript, [
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		'--install-extension', vsix.path
	], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60_000, env: { ...process.env, VSCODE_CLI: undefined } });
	if (result.error || result.status !== 0) {
		const detail = (result.stderr || result.stdout || `exit status ${result.status}`).trim().slice(0, 1000);
		throw new Error(`${app.label} control extension install failed: ${result.error?.message ?? detail}`);
	}
	const installedAfter = fs.readdirSync(extensionsDir).find(entry => entry.startsWith(`${vsix.publisher}.${vsix.name}-${vsix.version}`)
		&& fs.existsSync(path.join(extensionsDir, entry, 'package.json'))
		&& fs.existsSync(path.join(extensionsDir, entry, 'extension.js')));
	if (!installedAfter) {
		throw new Error(`${app.label} CLI reported a successful control extension install but ${vsix.publisher}.${vsix.name} did not appear in ${extensionsDir}.`);
	}
}
