/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { pipeline as streamPipeline } from 'stream';
import { promisify } from 'util';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { ILeanMacFeedResult, readLeanMacUpdateFeed } from './leanMacUpdateFeed.js';

const api = 'https://api.github.com/repos/mattivilola/lean-vs-code/releases';
const feedName = 'releases-darwin-arm64.json';
const pipeline = promisify(streamPipeline);

type GitHubFetch = (url: string, options: RequestInit) => Promise<Response>;

interface IReleaseAsset {
	readonly id: number;
	readonly name: string;
	readonly size: number;
	readonly digest: string;
	readonly state: string;
}

type GitHubUpdate = Extract<ILeanMacFeedResult, { latest: false }> & { readonly asset: IReleaseAsset };
type GitHubFeed = GitHubUpdate | Extract<ILeanMacFeedResult, { latest: true }>;

async function request(fetch: GitHubFetch, url: string, accept: string, signal: AbortSignal): Promise<Response> {
	const response = await fetch(url, { headers: { Accept: accept }, credentials: 'omit', cache: 'no-store', signal });
	const origin = new URL(response.url || url).origin;
	if (response.status !== 200 || (origin !== 'https://api.github.com' && origin !== 'https://release-assets.githubusercontent.com')) {
		await response.body?.cancel();
		throw new Error(`GitHub update API returned an unexpected response (HTTP ${response.status})`);
	}
	return response;
}

function findAsset(assets: IReleaseAsset[], name: string): IReleaseAsset {
	const matches = assets.filter(asset => asset?.name === name);
	const asset = matches[0];
	if (matches.length !== 1 || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.id) || asset.id <= 0
		|| !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
		throw new Error(`GitHub release is missing verified metadata for ${name}`);
	}
	return asset;
}

async function* readBody(response: Response, limit: number): AsyncGenerator<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('GitHub update API returned no body');
	}
	try {
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > limit) {
				throw new Error('GitHub update response exceeded its expected size');
			}
			yield value;
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

async function readJson(response: Response, asset?: IReleaseAsset): Promise<unknown> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of readBody(response, Math.min(asset?.size ?? Infinity, 1024 * 1024))) {
		chunks.push(chunk);
	}
	const body = Buffer.concat(chunks);
	if (asset && (body.byteLength !== asset.size || `sha256:${createHash('sha256').update(body).digest('hex')}` !== asset.digest)) {
		throw new Error('GitHub update feed failed size or SHA-256 verification');
	}
	return JSON.parse(body.toString('utf8'));
}

function requestAsset(fetch: GitHubFetch, asset: IReleaseAsset, signal: AbortSignal): Promise<Response> {
	return request(fetch, `${api}/assets/${asset.id}`, 'application/octet-stream', signal);
}

export async function readLeanMacUpdateFromGitHub(fetch: GitHubFetch, installedVersion: string, signal: AbortSignal): Promise<GitHubFeed> {
	const response = await request(fetch, `${api}/latest`, 'application/vnd.github+json', signal);
	const release = await readJson(response) as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: IReleaseAsset[] } | null;
	if (typeof release?.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) {
		throw new Error('GitHub API did not return a stable Lean VS Code release');
	}
	const feedAsset = findAsset(release.assets, feedName);
	const feed = await readJson(await requestAsset(fetch, feedAsset, signal), feedAsset) as { currentRelease?: string } | null;
	const result = readLeanMacUpdateFeed(feed, installedVersion);
	if (!result || `v${feed?.currentRelease}` !== release.tag_name) {
		throw new Error('GitHub update feed does not match the stable release');
	}
	if (result.latest) {
		return result;
	}
	const asset = findAsset(release.assets, `Lean-VS-Code-${result.update.version}-macos-arm64.zip`);
	if (asset.size !== result.size || asset.digest !== `sha256:${result.update.sha256hash}` || asset.size > 2 * 1024 ** 3) {
		throw new Error('GitHub update ZIP metadata does not match the feed');
	}
	return { ...result, asset };
}

export async function stageLeanMacUpdateFromGitHub(fetch: GitHubFetch, release: GitHubUpdate, signal: AbortSignal): Promise<IDisposable & { url: string }> {
	const directory = await mkdtemp(join(tmpdir(), 'lean-mac-update-'));
	const archive = join(directory, 'update.zip');
	try {
		const response = await requestAsset(fetch, release.asset, signal);
		const hash = createHash('sha256');
		let size = 0;
		async function* verifyChunks() {
			for await (const chunk of readBody(response, release.size)) {
				size += chunk.byteLength;
				hash.update(chunk);
				yield chunk;
			}
		}
		await pipeline(verifyChunks(), createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal });
		if (size !== release.size || hash.digest('hex') !== release.update.sha256hash) {
			throw new Error('GitHub update ZIP failed size or SHA-256 verification');
		}
		signal.throwIfAborted();
		return await serveVerifiedUpdate(directory, archive, release);
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

async function serveVerifiedUpdate(directory: string, archive: string, release: GitHubUpdate): Promise<IDisposable & { url: string }> {
	const { createServer } = await import('http');
	const prefix = '/' + randomBytes(24).toString('hex');
	const version = release.update.version;
	const server = createServer((request, response) => {
		if (request.method !== 'GET' || request.headers.host !== host) {
			response.writeHead(404).end();
		} else if (request.url === prefix + '/feed.json') {
			response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': feed.length, 'Cache-Control': 'no-store' }).end(feed);
		} else if (request.url === prefix + '/update.zip') {
			response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': release.size, 'Cache-Control': 'no-store' });
			void pipeline(createReadStream(archive), response).catch(() => response.destroy());
		} else {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', reject);
			resolve();
		});
	});
	const host = `127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
	const url = `http://${host}${prefix}`;
	const feed = Buffer.from(JSON.stringify({
		currentRelease: version,
		releases: [{ version, updateTo: { version, name: version, url: url + '/update.zip', size: release.size, sha256: release.update.sha256hash } }]
	}));

	const timeout = setTimeout(dispose, 3 * 60_000);
	server.unref();
	let disposed = false;
	function dispose(): void {
		if (disposed) {
			return;
		}
		disposed = true;
		clearTimeout(timeout);
		server.close(() => void rm(directory, { recursive: true, force: true }).catch(() => {}));
		server.closeAllConnections();
	}
	server.on('error', dispose);
	return { url: url + '/feed.json', dispose };
}
