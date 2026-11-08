/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { AbstractUpdateService, createUpdateURL, getUpdateRequestHeaders, IUpdateURLOptions, UpdateErrorClassification } from './abstractUpdateService.js';
import { canRetryLeanMacUpdate, ILeanMacFeedResult, readLeanMacUpdateFeed } from './leanMacUpdateFeed.js';

type NativeUpdateError = Error & { code?: number; domain?: string };
const githubFetch = (url: string, options: RequestInit) => electron.net.fetch(url, options);

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	@memoize private get onRawError(): Event<NativeUpdateError> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'error', error => error); }
	@memoize private get onRawCheckingForUpdate(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'checking-for-update'); }
	@memoize private get onRawUpdateNotAvailable(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'update-not-available'); }
	@memoize private get onRawUpdateAvailable(): Event<void> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-available'); }
	@memoize private get onRawUpdateDownloaded(): Event<IUpdate> {
		return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-downloaded', (_, releaseNotes: string, releaseName: string, releaseDate: Date | number) => ({
			version: this.productService.leanMacUpdateFeedUrl ? releaseName : releaseNotes,
			productVersion: releaseName,
			timestamp: releaseDate instanceof Date ? releaseDate.getTime() || undefined : releaseDate
		}));
	}

	private nativeCheck: 'primary' | 'fallback' | 'cancelled' | undefined;
	private githubCheck: { controller: AbortController; bridge?: IDisposable } | undefined;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, true);

		lifecycleMainService.setRelaunchHandler(this);
		this._register(lifecycleMainService.onWillShutdown(() => this.clearGitHubCheck()));
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		await super.initialize();

		this.onRawError(this.onError, this, this._store);
		this.onRawCheckingForUpdate(this.onCheckingForUpdate, this, this._store);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this._store);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this._store);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this._store);
	}

	private onCheckingForUpdate(): void {
		this.logService.trace('update#onCheckingForUpdate - Electron autoUpdater is checking for updates');
	}

	private onError(error: NativeUpdateError): void {
		const err = error.message;
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('UpdateService error:', err);

		const nativeCheck = this.nativeCheck;
		this.nativeCheck = undefined;
		if (nativeCheck === 'cancelled' || (!nativeCheck && this.githubCheck)) {
			return;
		}

		// Only react while actively checking/downloading; a late error must not clobber Disabled or Ready.
		if (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Downloading && this.state.type !== StateType.Overwriting) {
			return;
		}

		const explicit = this.state.explicit;
		if (nativeCheck === 'primary' && this.productService.leanMacUpdateFeedUrl && canRetryLeanMacUpdate(error)) {
			const phase = this.state.type === StateType.Downloading ? 'ZIP' : 'feed';
			this.logService.info(`Lean VS Code update ${phase} request failed; retrying through the GitHub API`);
			void this.retryWithGitHubApi(explicit, err);
		} else {
			this.clearGitHubCheck();
			const showError = explicit && (this.productService.leanMacUpdateFeedUrl || this.state.type === StateType.CheckingForUpdates);
			this.setState(State.Idle(UpdateType.Archive, showError ? err : undefined));
		}
	}

	private async retryWithGitHubApi(explicit: boolean, originalError: string): Promise<void> {
		const check: NonNullable<typeof this.githubCheck> = { controller: new AbortController() };
		this.githubCheck = check;
		const signal = AbortSignal.any([check.controller.signal, AbortSignal.timeout(180_000)]);
		try {
			const { readLeanMacUpdateFromGitHub, stageLeanMacUpdateFromGitHub } = await import('./leanMacUpdateFallback.js');
			const release = await readLeanMacUpdateFromGitHub(githubFetch, this.productService.leanReleaseVersion!, signal);
			if (this.githubCheck !== check) {
				return;
			}
			if (release.latest) {
				this.clearGitHubCheck();
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit));
				return;
			}
			const bridge = await stageLeanMacUpdateFromGitHub(githubFetch, release, signal);
			if (this.githubCheck !== check) {
				bridge.dispose();
				return;
			}
			check.bridge = bridge;
			signal.throwIfAborted();
			this.setState(State.CheckingForUpdates(explicit));
			this.nativeCheck = 'fallback';
			electron.autoUpdater.setFeedURL({ url: bridge.url, serverType: 'json' });
			if (this.nativeCheck === 'fallback') {
				electron.autoUpdater.checkForUpdates();
			}
		} catch (error) {
			if (this.githubCheck === check) {
				this.logService.warn('Lean VS Code GitHub update fallback failed', error);
				this.nativeCheck = undefined;
				this.clearGitHubCheck();
				this.setState(State.Idle(UpdateType.Archive, explicit ? originalError : undefined));
			}
		}
	}

	private clearGitHubCheck(): void {
		const check = this.githubCheck;
		this.githubCheck = undefined;
		check?.controller.abort();
		check?.bridge?.dispose();
	}

	protected override async cancelUpdate(): Promise<void> {
		if (this.nativeCheck) {
			// Native events have no attempt ID. Wait for the terminal event before starting another check.
			this.nativeCheck = 'cancelled';
		}
		this.clearGitHubCheck();
		await super.cancelUpdate();
	}

	protected override isUpdateConfigured(): boolean {
		return this.productService.leanMacUpdateFeedUrl
			? process.arch === 'arm64' && !!this.productService.commit && !!this.productService.leanReleaseVersion
			: super.isUpdateConfigured();
	}

	protected override getProductQuality(updateMode: string): string | undefined {
		return this.productService.leanMacUpdateFeedUrl && updateMode !== 'none' ? 'stable' : super.getProductQuality(updateMode);
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string | undefined {
		if (this.productService.leanMacUpdateFeedUrl) {
			const url = this.productService.leanMacUpdateFeedUrl;
			try {
				if (url !== 'https://github.com/mattivilola/lean-vs-code/releases/latest/download/releases-darwin-arm64.json') {
					return undefined;
				}
				electron.autoUpdater.setFeedURL({ url, serverType: 'json' });
			} catch (error) {
				this.logService.error('Failed to set Lean VS Code update feed URL', error);
				return undefined;
			}
			return url;
		}
		const assetID = this.productService.darwinUniversalAssetId ?? (process.arch === 'x64' ? 'darwin' : 'darwin-arm64');
		const url = createUpdateURL(this.productService.updateUrl!, assetID, quality, commit, options);
		const headers = getUpdateRequestHeaders(this.productService.version);
		try {
			this.logService.trace('update#buildUpdateFeedUrl - setting feed URL for Electron autoUpdater', { url, assetID, quality, commit, headers });
			electron.autoUpdater.setFeedURL({ url, headers });
		} catch (e) {
			// application is very likely not signed
			this.logService.error('Failed to set update feed URL', e);
			return undefined;
		}
		return url;
	}

	protected doCheckForUpdates(explicit: boolean, pendingCommit?: string): void {
		if (!this.quality || this.nativeCheck) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const metered = !explicit && this.meteredConnectionService.isConnectionMetered;
		this.nativeCheck = metered ? undefined : 'primary';
		const url = this.buildUpdateFeedUrl(this.quality, pendingCommit ?? this.productService.commit!, { background, internalOrg });

		if (!url) {
			if (this.state.type === StateType.CheckingForUpdates) {
				this.nativeCheck = undefined;
				this.setState(State.Idle(UpdateType.Archive));
			}
			return;
		}

		// When connection is metered and this is not an explicit check, avoid electron call as to not to trigger auto-download.
		if (metered) {
			this.logService.info('update#doCheckForUpdates - checking for update without auto-download because connection is metered');
			this.checkForUpdateNoDownload(url);
			return;
		}

		this.logService.trace('update#doCheckForUpdates - using Electron autoUpdater', { url, explicit, background });
		if (this.nativeCheck === 'primary') {
			electron.autoUpdater.checkForUpdates();
		}
	}

	/**
	 * Manually check the update feed URL without triggering Electron's auto-download.
	 * Used when connection is metered or in the embedded app.
	 * @param canInstall When false, signals that the update cannot be installed from this app.
	 */
	private async checkForUpdateNoDownload(url: string, canInstall?: boolean): Promise<void> {
		const headers = getUpdateRequestHeaders(this.productService.version);
		this.logService.trace('update#checkForUpdateNoDownload - checking update server', { url, headers });

		try {
			if (this.productService.leanMacUpdateFeedUrl) {
				const feed = await this.readLeanFeed(url, this.productService.leanReleaseVersion!, CancellationToken.None);
				if (this.state.type === StateType.CheckingForUpdates) {
					this.setState(feed.latest ? State.Idle(UpdateType.Archive) : State.AvailableForDownload(feed.update, canInstall));
				}
				return;
			}

			const context = await this.requestService.request({ url, headers, callSite: 'updateService.darwin.checkForUpdates' }, CancellationToken.None);
			const statusCode = context.res.statusCode;
			this.logService.trace('update#checkForUpdateNoDownload - response', { statusCode });

			const update = await asJson<IUpdate>(context);
			if (!update || !update.url || !update.version || !update.productVersion) {
				this.logService.trace('update#checkForUpdateNoDownload - no update available');
				const notAvailable = this.state.type === StateType.CheckingForUpdates && this.state.explicit;
				this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
			} else {
				this.logService.trace('update#checkForUpdateNoDownload - update available', { version: update.version, productVersion: update.productVersion });
				this.setState(State.AvailableForDownload(update, canInstall));
			}
		} catch (err) {
			this.logService.error('update#checkForUpdateNoDownload - failed to check for update', err);
			if (this.state.type === StateType.CheckingForUpdates) {
				this.setState(State.Idle(UpdateType.Archive));
			}
		}
	}

	protected override async doIsLatestVersion(commit?: string, token: CancellationToken = CancellationToken.None): Promise<boolean | undefined> {
		if (!this.productService.leanMacUpdateFeedUrl) {
			return super.doIsLatestVersion(commit, token);
		}
		if (this.configurationService.getValue<string>('update.mode') === 'none') {
			return undefined;
		}
		try {
			return (await this.readLeanFeed(this.productService.leanMacUpdateFeedUrl, commit ?? this.productService.leanReleaseVersion!, token)).latest;
		} catch (error) {
			this.logService.warn('Failed to check Lean VS Code update feed', error);
			return undefined;
		}
	}

	private async readLeanFeed(url: string, version: string, token: CancellationToken): Promise<ILeanMacFeedResult> {
		try {
			const context = await this.requestService.request({ url, timeout: 15_000, callSite: 'updateService.darwin.readLeanFeed' }, token);
			const feed = readLeanMacUpdateFeed(await asJson<unknown>(context), version);
			if (feed) {
				return feed;
			}
		} catch (error) {
			this.logService.trace('Lean VS Code update feed request failed', error);
		}
		const controller = new AbortController();
		if (token.isCancellationRequested) {
			controller.abort();
		}
		const listener = token.onCancellationRequested(() => controller.abort());
		try {
			const { readLeanMacUpdateFromGitHub } = await import('./leanMacUpdateFallback.js');
			return await readLeanMacUpdateFromGitHub(githubFetch, version, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
		} finally {
			listener.dispose();
		}
	}

	private onUpdateAvailable(): void {
		this.logService.trace('update#onUpdateAvailable - Electron autoUpdater reported update available');

		if (this.nativeCheck === 'cancelled' || (this.state.type !== StateType.CheckingForUpdates && this.state.type !== StateType.Overwriting)) {
			return;
		}

		this.setState(State.Downloading(this.state.type === StateType.Overwriting ? this.state.update : undefined, this.state.explicit, this._overwrite));
	}

	private onUpdateDownloaded(update: IUpdate): void {
		if (!this.finishNativeCheck() || this.state.type !== StateType.Downloading) {
			return;
		}

		this.setState(State.Downloaded(update, this.state.explicit, this._overwrite));
		this.logService.info(`Update downloaded: ${JSON.stringify(update)}`);

		this.setState(State.Ready(update, this.state.explicit, this._overwrite));
	}

	private onUpdateNotAvailable(): void {
		this.logService.trace('update#onUpdateNotAvailable - Electron autoUpdater reported no update available');

		if (!this.finishNativeCheck() || this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		const notAvailable = this.state.explicit;
		this.setState(State.Idle(UpdateType.Archive, undefined, notAvailable || undefined));
	}

	private finishNativeCheck(): boolean {
		const check = this.nativeCheck;
		this.nativeCheck = undefined;
		this.clearGitHubCheck();
		return check === 'primary' || check === 'fallback';
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		this.doCheckForUpdates(true, state.update.version);
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}
}
