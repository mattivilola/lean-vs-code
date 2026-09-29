/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawnSync } from 'child_process';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createNativeEnvCommand, parseNullSeparatedShellEnvironment } from '../../node/shellEnv.js';

suite('macOS shell environment collection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('ignores shell chatter and preserves Unicode, newlines, equals, empty values, and special keys', () => {
		const mark = 'test123';
		const frame = `\0${mark}\0`;
		const raw = Buffer.from(`startup chatter\n${frame}LEAN_TEST=☃\nleft=right\0EMPTY=\0__proto__=safe\0${frame}more chatter`);
		const env = parseNullSeparatedShellEnvironment(raw, mark);
		assert.deepEqual(Object.keys(env).sort(), ['EMPTY', 'LEAN_TEST', '__proto__'].sort());
		assert.equal(env.LEAN_TEST, '☃\nleft=right');
		assert.equal(env.EMPTY, '');
		assert.equal(Object.getOwnPropertyDescriptor(env, '__proto__')?.value, 'safe');
	});

	test('rejects missing framing and malformed records', () => {
		assert.throws(() => parseNullSeparatedShellEnvironment(Buffer.from('LEAN_TEST=value\0'), 'test123'), /Missing shell environment frame/);
		assert.throws(() => parseNullSeparatedShellEnvironment(Buffer.from('\0test123\0BROKEN\0\0test123\0'), 'test123'), /Invalid shell environment entry/);
	});

	test('collects the real login-shell environment with the same command on macOS', function () {
		this.timeout(15000);
		if (!isMacintosh) {
			this.skip();
		}
		const mark = 'test123';
		const command = createNativeEnvCommand(mark);
		for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
			const child = spawnSync(shell, ['-i', '-l', '-c', command], {
				env: { ...process.env, LEAN_SHELL_ENV_TEST: '☃\nleft=right', LEAN_SHELL_ENV_EMPTY: '' },
				timeout: 10000
			});
			assert.equal(child.status, 0, `${shell}: ${child.stderr.toString('utf8')}`);
			const env = parseNullSeparatedShellEnvironment(child.stdout, mark);
			assert.equal(env.LEAN_SHELL_ENV_TEST, '☃\nleft=right', shell);
			assert.equal(env.LEAN_SHELL_ENV_EMPTY, '', shell);
		}
	});
});
