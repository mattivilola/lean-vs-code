/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickChatOpenOptions, IQuickChatService } from '../../chat/browser/chat.js';
import type { QuickChatService } from '../../chat/browser/widgetHosts/chatQuick.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';

/** Keep the optional Quick Chat renderer out of the initial workbench module. */
export class LazyQuickChatService extends Disposable implements IQuickChatService {
	readonly _serviceBrand: undefined;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;
	private delegate: QuickChatService | undefined;
	private loading: Promise<void> | undefined;
	private pendingOpen: IQuickChatOpenOptions | undefined;
	private hasPendingOpen = false;
	private pendingFocus = false;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatService private readonly chatService: IChatService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	get enabled(): boolean { return !!this.chatService.isEnabled(ChatAgentLocation.Chat); }
	get focused(): boolean { return this.delegate?.focused ?? false; }
	get sessionResource(): URI | undefined { return this.delegate?.sessionResource; }

	toggle(options?: IQuickChatOpenOptions): void {
		if (this.delegate) {
			this.delegate.toggle(options);
		} else if (this.hasPendingOpen && !options?.query) {
			this.close();
		} else {
			this.open(options);
		}
	}

	open(options?: IQuickChatOpenOptions): void {
		if (this.delegate) {
			this.delegate.open(options);
			return;
		}
		this.hasPendingOpen = true;
		this.pendingOpen = options;
		this.load();
	}

	focus(): void {
		if (this.delegate) {
			this.delegate.focus();
		} else if (this.hasPendingOpen) {
			this.pendingFocus = true;
		}
	}

	close(): void {
		if (this.delegate) {
			this.delegate.close();
		} else if (this.hasPendingOpen) {
			this.hasPendingOpen = false;
			this.pendingOpen = undefined;
			this.pendingFocus = false;
			this._onDidClose.fire();
		}
	}

	openInChatView(): void {
		if (this.delegate) {
			this.delegate.openInChatView();
		} else if (this.hasPendingOpen) {
			this.loading?.then(() => this.delegate?.openInChatView());
		}
	}

	private load(): void {
		if (this.loading) {
			return;
		}
		this.loading = import('../../chat/browser/widgetHosts/chatQuick.js').then(({ QuickChatService }) => {
			if (this._store.isDisposed || !this.hasPendingOpen) {
				return;
			}
			this.delegate = this._register(this.instantiationService.createInstance(QuickChatService));
			this._register(this.delegate.onDidClose(() => this._onDidClose.fire()));
			this.delegate.open(this.pendingOpen);
			if (this.pendingFocus) {
				this.delegate.focus();
			}
			this.hasPendingOpen = false;
			this.pendingOpen = undefined;
			this.pendingFocus = false;
		}).catch(error => {
			this.logService.error('[lean] Failed to load Quick Chat', error);
			this.hasPendingOpen = false;
			this.pendingOpen = undefined;
			this.pendingFocus = false;
			this._onDidClose.fire();
		}).finally(() => { this.loading = undefined; });
	}
}
