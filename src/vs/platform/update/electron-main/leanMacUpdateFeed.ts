/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IUpdate } from '../common/update.js';

export interface ILeanMacFeedResult {
	readonly latest: boolean;
	readonly update?: IUpdate;
}

function numericVersion(value: unknown): [number, number, number] | undefined {
	if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
		return undefined;
	}
	const parts = value.split('.').map(Number);
	return parts.every(Number.isSafeInteger) ? parts as [number, number, number] : undefined;
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
	for (let index = 0; index < 3; index++) {
		if (left[index] !== right[index]) {
			return left[index] - right[index];
		}
	}
	return 0;
}

/** Validate the same static-feed shape that Squirrel.Mac consumes before reporting its state in VS Code. */
export function readLeanMacUpdateFeed(value: unknown, installedVersion: string): ILeanMacFeedResult | undefined {
	const installed = numericVersion(installedVersion);
	if (!installed || !value || typeof value !== 'object') {
		return undefined;
	}
	const feed = value as { currentRelease?: unknown; releases?: unknown };
	const current = numericVersion(feed.currentRelease);
	if (!current || !Array.isArray(feed.releases)) {
		return undefined;
	}
	if (compareVersions(current, installed) <= 0) {
		return { latest: true };
	}
	const version = feed.currentRelease as string;
	const entry = feed.releases.find(candidate => candidate && typeof candidate === 'object' && candidate.version === version);
	if (!entry || !entry.updateTo || typeof entry.updateTo !== 'object') {
		return undefined;
	}
	const updateTo = entry.updateTo as { version?: unknown; url?: unknown; sha256?: unknown; size?: unknown; pub_date?: unknown };
	if (updateTo.version !== undefined && updateTo.version !== version) {
		return undefined;
	}
	if (typeof updateTo.url !== 'string') {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(updateTo.url);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== `/mattivilola/lean-vs-code/releases/download/v${version}/Lean-VS-Code-${version}-macos-arm64.zip` || url.search || url.hash) {
		return undefined;
	}
	if (typeof updateTo.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(updateTo.sha256) || typeof updateTo.size !== 'number' || !Number.isSafeInteger(updateTo.size) || updateTo.size <= 0) {
		return undefined;
	}
	const timestamp = typeof updateTo.pub_date === 'string' ? Date.parse(updateTo.pub_date) : undefined;
	if (timestamp !== undefined && !Number.isFinite(timestamp)) {
		return undefined;
	}
	return {
		latest: false,
		update: { version, productVersion: version, url: updateTo.url, sha256hash: updateTo.sha256, timestamp }
	};
}
