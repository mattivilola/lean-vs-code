/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { imageToHash } from '../../../common/attachments/chatImageHash.js';

suite('Chat image hash', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('keeps the SHA-256 bytes, hex encoding, and caller view unchanged', async () => {
		assert.strictEqual(await imageToHash(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		const backing = new Uint8Array([0, 104, 101, 108, 108, 111, 0]);
		const view = backing.subarray(1, 6);
		assert.strictEqual(await imageToHash(view), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
		assert.deepStrictEqual([...backing], [0, 104, 101, 108, 108, 111, 0]);
	});
});
