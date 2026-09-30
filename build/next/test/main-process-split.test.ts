/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { getBundleOptions } from '../bundle.ts';
import { validateMainProcessSplit } from '../main-process-split.ts';

async function fixture(sharedMetadata = false) {
	// esbuild canonicalizes source paths; macOS /var and /private/var alias the same directory.
	const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lean-main-split-')));
	const sourceRoot = path.join(directory, 'src');
	await fs.mkdir(path.join(sourceRoot, 'vs/code/electron-main'), { recursive: true });
	const files = {
		'main.ts': `import { root } from './bootstrap-node.js';
import { product, pkg } from './bootstrap-meta.js';
import { setup } from './bootstrap-esm.js';
import { token, state } from './state.js';
await setup();
const application = await import('./vs/code/electron-main/main.js');
export const result = { sameToken: token === application.token, state: application.state.value, root, product, pkg };`,
		'bootstrap-node.ts': 'export const root = import.meta.dirname;',
		'bootstrap-meta.ts': `export const product = { BUILD_INSERT_PRODUCT_CONFIGURATION: 'BUILD_INSERT_PRODUCT_CONFIGURATION' };
export const pkg = { BUILD_INSERT_PACKAGE_CONFIGURATION: 'BUILD_INSERT_PACKAGE_CONFIGURATION' };`,
		'bootstrap-esm.ts': `import { state } from './state.js'; export async function setup() { state.value = 'ready'; }`,
		'state.ts': `export const token = {}; export const state = { value: 'initial' };`,
		'vs/code/electron-main/main.ts': `export { token, state } from '../../../state.js';${sharedMetadata ? `export { product } from '../../../bootstrap-meta.js';` : ''}`
	};
	for (const [name, contents] of Object.entries(files)) {
		await fs.writeFile(path.join(sourceRoot, name), contents);
	}
	return { directory, sourceRoot };
}

async function bundle(sourceRoot: string, outputDirectory: string, chunkNames = 'main-[name]-[hash]') {
	return esbuild.build({
		...getBundleOptions(true, 'node'),
		entryPoints: [{ in: path.join(sourceRoot, 'main.ts'), out: 'main' }],
		outdir: outputDirectory, chunkNames, splitting: true, metafile: true, write: false
	});
}

test('root split preserves bootstrap directory, metadata patching and shared mutable module identity', async () => {
	const { directory, sourceRoot } = await fixture();
	try {
		const outputDirectory = path.join(directory, 'out');
		const result = await bundle(sourceRoot, outputDirectory);
		validateMainProcessSplit(result.metafile, result.outputFiles, sourceRoot);
		await fs.mkdir(outputDirectory);
		for (const file of result.outputFiles) {
			await fs.writeFile(file.path, file.contents);
		}
		const entry = await import(pathToFileURL(path.join(outputDirectory, 'main.js')).href);
		assert.deepEqual(entry.result, {
			sameToken: true, state: 'ready', root: outputDirectory,
			product: { BUILD_INSERT_PRODUCT_CONFIGURATION: 'BUILD_INSERT_PRODUCT_CONFIGURATION' },
			pkg: { BUILD_INSERT_PACKAGE_CONFIGURATION: 'BUILD_INSERT_PACKAGE_CONFIGURATION' }
		});
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('rejects a real split that moves metadata into a common chunk', async () => {
	const { directory, sourceRoot } = await fixture(true);
	try {
		const result = await bundle(sourceRoot, path.join(directory, 'out'));
		assert.throws(() => validateMainProcessSplit(result.metafile, result.outputFiles, sourceRoot), /bootstrap-meta.ts exclusively in main.js/);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('rejects nested chunks that change import.meta directory semantics', async () => {
	const { directory, sourceRoot } = await fixture();
	try {
		const result = await bundle(sourceRoot, path.join(directory, 'out'), 'chunks/main-[name]-[hash]');
		assert.throws(() => validateMainProcessSplit(result.metafile, result.outputFiles, sourceRoot), /chunks must remain beside main.js/);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('rejects product initialization in the bootstrap static closure', async () => {
	const { directory, sourceRoot } = await fixture();
	try {
		const productDirectory = path.join(sourceRoot, 'vs/platform/product/common');
		await fs.mkdir(productDirectory, { recursive: true });
		await fs.writeFile(path.join(productDirectory, 'product.ts'), 'export const mainProduct = {};');
		await fs.appendFile(path.join(sourceRoot, 'main.ts'), `\nexport { mainProduct } from './vs/platform/product/common/product.js';`);
		const result = await bundle(sourceRoot, path.join(directory, 'out'));
		assert.throws(() => validateMainProcessSplit(result.metafile, result.outputFiles, sourceRoot), /must not initialize product or contributions before bootstrap/);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
