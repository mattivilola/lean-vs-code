/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import type * as esbuild from 'esbuild';

/** Reject a main-process experiment that relocates path-sensitive bootstrap or metadata patching. */
export function validateMainProcessSplit(metafile: esbuild.Metafile, outputFiles: readonly esbuild.OutputFile[], sourceRoot: string, workingDirectory = process.cwd()): void {
	const outputs = Object.entries(metafile.outputs).filter(([name]) => name.endsWith('.js'));
	const main = outputs.find(([, output]) => output.entryPoint && path.resolve(workingDirectory, output.entryPoint) === path.join(sourceRoot, 'main.ts'));
	if (!main || path.basename(main[0]) !== 'main.js') {
		throw new Error('Main-process splitting must preserve the main.js entry.');
	}
	const mainPath = path.resolve(workingDirectory, main[0]);
	for (const [name] of outputs) {
		if (path.dirname(path.resolve(workingDirectory, name)) !== path.dirname(mainPath)) {
			throw new Error(`Main-process chunks must remain beside main.js: ${name}`);
		}
	}
	for (const module of ['bootstrap-node.ts', 'bootstrap-esm.ts', 'bootstrap-meta.ts']) {
		const source = path.join(sourceRoot, module);
		const locations = outputs.filter(([, output]) => Object.keys(output.inputs).some(input => path.resolve(workingDirectory, input) === source));
		if (locations.length !== 1 || locations[0][0] !== main[0]) {
			throw new Error(`Main-process splitting must keep ${module} exclusively in main.js.`);
		}
	}
	const bootstrapOutputs = new Set<string>();
	const visit = (name: string) => {
		if (bootstrapOutputs.has(name)) {
			return;
		}
		bootstrapOutputs.add(name);
		for (const edge of metafile.outputs[name]?.imports ?? []) {
			if (!edge.external && edge.kind === 'import-statement') {
				visit(edge.path);
			}
		}
	};
	visit(main[0]);
	for (const name of bootstrapOutputs) {
		for (const input of Object.keys(metafile.outputs[name]?.inputs ?? {})) {
			const source = path.resolve(workingDirectory, input);
			if (source === path.join(sourceRoot, 'vs/platform/product/common/product.ts') || source.endsWith('.contribution.ts')) {
				throw new Error(`Main-process splitting must not initialize product or contributions before bootstrap: ${input}`);
			}
		}
	}
	// gulp's inlineMeta() replaces these markers only in its recognized root entry.
	for (const marker of ['BUILD_INSERT_PRODUCT_CONFIGURATION', 'BUILD_INSERT_PACKAGE_CONFIGURATION']) {
		const locations = outputFiles.filter(file => file.path.endsWith('.js') && file.text.includes(marker));
		if (locations.length !== 1 || locations[0].path !== mainPath) {
			throw new Error(`Main-process splitting must keep ${marker} exclusively in main.js.`);
		}
	}
}
