/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { readLeanMacUpdateFeed } from '../../electron-main/leanMacUpdateFeed.js';

const archive = 'https://github.com/mattivilola/lean-vs-code/releases/download/v0.3.2/Lean-VS-Code-0.3.2-macos-arm64.zip';
const updateTo = { version: '0.3.2', name: '0.3.2', url: archive, sha256: 'a'.repeat(64), size: 123456 };
const feed = { currentRelease: '0.3.2', releases: [{ version: '0.3.2', updateTo }] };

suite('Lean macOS update feed', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reports a newer signed release', () => {
		assert.deepStrictEqual(readLeanMacUpdateFeed(feed, '0.3.1'), {
			latest: false,
			update: { version: '0.3.2', productVersion: '0.3.2', url: archive, sha256hash: 'a'.repeat(64), timestamp: undefined }
		});
	});

	test('does not download equal or older releases', () => {
		assert.deepStrictEqual(readLeanMacUpdateFeed(feed, '0.3.2'), { latest: true });
		assert.deepStrictEqual(readLeanMacUpdateFeed(feed, '0.4.0'), { latest: true });
	});

	test('rejects missing, malformed, or mismatched update metadata', () => {
		assert.strictEqual(readLeanMacUpdateFeed({}, '0.3.1'), undefined);
		assert.strictEqual(readLeanMacUpdateFeed({ currentRelease: '0.3.2', releases: [] }, '0.3.1'), undefined);
		assert.strictEqual(readLeanMacUpdateFeed({ ...feed, releases: [{ ...feed.releases[0], updateTo: { ...updateTo, sha256: 'bad' } }] }, '0.3.1'), undefined);
		assert.strictEqual(readLeanMacUpdateFeed({ ...feed, releases: [{ ...feed.releases[0], updateTo: { ...updateTo, url: archive.replace('arm64', 'x64') } }] }, '0.3.1'), undefined);
		assert.strictEqual(readLeanMacUpdateFeed({ ...feed, releases: [{ ...feed.releases[0], updateTo: { ...updateTo, url: 'http://example.com/update.zip' } }] }, '0.3.1'), undefined);
		assert.strictEqual(readLeanMacUpdateFeed(feed, '1.139.1-insider'), undefined);
	});
});
