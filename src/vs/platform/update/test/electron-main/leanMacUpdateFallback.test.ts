/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createHash } from 'crypto';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { readLeanMacUpdateFromGitHub, stageLeanMacUpdateFromGitHub } from '../../electron-main/leanMacUpdateFallback.js';
import { canRetryLeanMacUpdate } from '../../electron-main/leanMacUpdateFeed.js';

const api = 'https://api.github.com/repos/mattivilola/lean-vs-code/releases';
const version = '0.10.3';
const archiveName = `Lean-VS-Code-${version}-macos-arm64.zip`;
const zip = 'ZIP fixture bytes';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const feed = JSON.stringify({
	currentRelease: version,
	releases: [{ version, updateTo: { version, url: `https://github.com/mattivilola/lean-vs-code/releases/download/v${version}/${archiveName}`, sha256: digest(zip), size: zip.length } }]
});
const asset = (id: number, name: string, text: string) => ({ id, name, state: 'uploaded', size: text.length, digest: 'sha256:' + digest(text) });
const latest = { tag_name: 'v' + version, draft: false, prerelease: false, assets: [asset(1, 'releases-darwin-arm64.json', feed), asset(2, archiveName, zip)] };

function fixtures(zipBody = zip, release = latest, feedBody = feed) {
	const requests: string[] = [];
	const fetch: typeof globalThis.fetch = async (url, options) => {
		options?.signal?.throwIfAborted();
		requests.push(String(url));
		const accept = new Headers(options?.headers).get('Accept');
		switch (url) {
			case api + '/latest':
				assert.strictEqual(accept, 'application/vnd.github+json');
				return Response.json(release);
			case api + '/assets/1':
				assert.strictEqual(accept, 'application/octet-stream');
				return new Response(feedBody);
			case api + '/assets/2':
				assert.strictEqual(accept, 'application/octet-stream');
				return new Response(zipBody);
			default:
				throw new Error('Unexpected update URL: ' + url);
		}
	};
	return { fetch, requests };
}

suite('Lean macOS GitHub API fallback', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('retries native feed and ZIP server errors but leaves signature, TLS and installation errors terminal', () => {
		const error = (domain: string, code: number) => Object.assign(new Error(), { domain, code });
		assert.ok(canRetryLeanMacUpdate(error('SQRLUpdaterErrorDomain', 5)));
		assert.ok(canRetryLeanMacUpdate(error('SQRLUpdaterErrorDomain', 7)));
		assert.ok(canRetryLeanMacUpdate(error('NSURLErrorDomain', -1001)));
		assert.ok(!canRetryLeanMacUpdate(error('NSURLErrorDomain', -1202)));
		assert.ok(!canRetryLeanMacUpdate(error('SQRLCodeSignatureErrorDomain', 1)));
		assert.ok(!canRetryLeanMacUpdate(error('SQRLUpdaterErrorDomain', 8)));
	});

	test('resolves stable feed metadata without downloading the ZIP during a read-only check', async () => {
		const { fetch, requests } = fixtures();
		const release = await readLeanMacUpdateFromGitHub(fetch, '0.10.2', AbortSignal.timeout(5000));
		assert.ok(!release.latest);
		assert.strictEqual(release.update.version, version);
		assert.deepStrictEqual(requests, [api + '/latest', api + '/assets/1']);
		assert.deepStrictEqual(await readLeanMacUpdateFromGitHub(fetch, version, AbortSignal.timeout(5000)), { latest: true });
	});

	test('rejects an ineligible release, a different tag, and mismatched feed or ZIP metadata', async () => {
		const signal = AbortSignal.timeout(5000);
		for (const release of [
			{ ...latest, prerelease: true },
			{ ...latest, tag_name: 'v0.10.4' },
			{ ...latest, assets: [latest.assets[0], { ...latest.assets[1], size: zip.length + 1 }] },
		]) {
			const { fetch, requests } = fixtures(zip, release);
			await assert.rejects(readLeanMacUpdateFromGitHub(fetch, '0.10.2', signal));
			assert.ok(!requests.includes(api + '/assets/2'));
		}
		await assert.rejects(readLeanMacUpdateFromGitHub(fixtures(zip, latest, feed.replace('0.10.3', '0.10.4')).fetch, '0.10.2', signal), /SHA-256/);
	});

	test('rejects a short, oversized, corrupted or cancelled ZIP before exposing an installer URL', async () => {
		const signal = AbortSignal.timeout(5000);
		for (const body of [zip.slice(1), zip + '!', 'x'.repeat(zip.length)]) {
			const { fetch } = fixtures(body);
			const release = await readLeanMacUpdateFromGitHub(fetch, '0.10.2', signal);
			assert.ok(!release.latest);
			await assert.rejects(stageLeanMacUpdateFromGitHub(fetch, release, signal), /size|SHA-256/);
		}
		const { fetch } = fixtures();
		const release = await readLeanMacUpdateFromGitHub(fetch, '0.10.2', signal);
		assert.ok(!release.latest);
		await assert.rejects(stageLeanMacUpdateFromGitHub(fetch, release, AbortSignal.abort()), { name: 'AbortError' });
	});

	test('hands native updater a local feed and serves the exact verified ZIP at its private URL', async () => {
		const { fetch, requests } = fixtures();
		const signal = AbortSignal.timeout(5000);
		const release = await readLeanMacUpdateFromGitHub(fetch, '0.10.2', signal);
		assert.ok(!release.latest);
		const bridge = await stageLeanMacUpdateFromGitHub(fetch, release, signal);
		try {
			const url = new URL(bridge.url);
			assert.strictEqual(url.hostname, '127.0.0.1');
			const response = await globalThis.fetch(url, { signal });
			assert.strictEqual(response.status, 200);
			const localFeed = await response.json();
			const archive = await globalThis.fetch(localFeed.releases[0].updateTo.url, { signal });
			assert.strictEqual(await archive.text(), zip);
			assert.strictEqual((await globalThis.fetch(new URL('/update.zip', url), { signal })).status, 404);
			assert.deepStrictEqual(requests, [api + '/latest', api + '/assets/1', api + '/assets/2']);
		} finally {
			bridge.dispose();
		}
		await assert.rejects(globalThis.fetch(bridge.url, { signal }));
	});
});
