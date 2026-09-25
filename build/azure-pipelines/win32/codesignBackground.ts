/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { e } from '../common/publish.ts';

interface ICodesignResult {
	readonly exitCode: number;
	readonly signal: NodeJS.Signals | null;
	readonly error?: string;
}

async function main(): Promise<void> {
	const arch = e('VSCODE_ARCH');
	const outputDirectory = path.join('.build', 'logs', 'codesign', `win32-${arch}`);
	const logPath = path.join(outputDirectory, 'codesign.log');
	const resultPath = path.join(outputDirectory, 'result.json');
	await fs.promises.mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		fs.promises.rm(logPath, { force: true }),
		fs.promises.rm(resultPath, { force: true })
	]);

	const log = fs.createWriteStream(logPath);
	let result: ICodesignResult;
	try {
		const child = cp.spawn(process.execPath, ['build/azure-pipelines/win32/codesign.ts'], {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});

		child.stdout.on('data', data => {
			process.stdout.write(data);
			log.write(data);
		});
		child.stderr.on('data', data => {
			process.stderr.write(data);
			log.write(data);
		});

		result = await new Promise<ICodesignResult>(resolve => {
			child.once('error', error => {
				const message = error.stack ?? error.message;
				process.stderr.write(`${message}\n`);
				log.write(`${message}\n`);
				resolve({ exitCode: 1, signal: null, error: message });
			});
			child.once('close', (exitCode, signal) => resolve({ exitCode: exitCode ?? 1, signal }));
		});
	} catch (error) {
		const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`${message}\n`);
		log.write(`${message}\n`);
		result = { exitCode: 1, signal: null, error: message };
	}
	await new Promise<void>(resolve => log.end(resolve));
	await fs.promises.writeFile(resultPath, JSON.stringify(result));
	process.exitCode = result.exitCode;
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
