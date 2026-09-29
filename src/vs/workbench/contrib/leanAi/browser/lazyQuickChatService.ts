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

type PendingOperation =
	| { kind: 'toggle' | 'open'; options?: IQuickChatOpenOptions }
	| { kind: 'focus' | 'openInChatView' };

/** Keep the optional Quick Chat renderer out of the initial workbench module. */
export class LazyQuickChatService extends Disposable implements IQuickChatService {
	readonly _serviceBrand: undefined;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;
	private delegate: QuickChatService | undefined;
	private loading: Promise<void> | undefined;
	private pendingOperations: PendingOperation[] = [];
	private generation = 0;

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
		} else if (this.pendingOperations.length && !options?.query) {
			this.close();
		} else {
			this.pendingOperations.push({ kind: 'toggle', options });
			this.load();
		}
	}

	open(options?: IQuickChatOpenOptions): void {
		if (this.delegate) {
			this.delegate.open(options);
			return;
		}
		this.pendingOperations.push({ kind: 'open', options });
		this.load();
	}

	focus(): void {
		if (this.delegate) {
			this.delegate.focus();
		} else if (this.pendingOperations.length) {
			this.pendingOperations.push({ kind: 'focus' });
		}
	}

	close(): void {
		this.generation++;
		if (this.delegate) {
			this.delegate.close();
		} else if (this.pendingOperations.length) {
			this.pendingOperations = [];
			this._onDidClose.fire();
		}
	}

	openInChatView(): void {
		if (this.delegate) {
			this.delegate.openInChatView();
		} else if (this.pendingOperations.length) {
			this.pendingOperations.push({ kind: 'openInChatView' });
		}
	}

	private load(): void {
		if (this.loading) {
			return;
		}
		this.loading = import('../../chat/browser/widgetHosts/chatQuick.js').then(({ QuickChatService }) => {
			if (this._store.isDisposed || !this.pendingOperations.length) {
				return;
			}
			this.delegate = this._register(this.instantiationService.createInstance(QuickChatService));
			this._register(this.delegate.onDidClose(() => this._onDidClose.fire()));
			const operations = this.pendingOperations;
			this.pendingOperations = [];
			const generation = this.generation;
			for (const operation of operations) {
				if (this._store.isDisposed || generation !== this.generation) {
					break;
				}
				switch (operation.kind) {
					case 'toggle': this.delegate.toggle(operation.options); break;
					case 'open': this.delegate.open(operation.options); break;
					case 'focus': this.delegate.focus(); break;
					case 'openInChatView': this.delegate.openInChatView(); break;
				}
			}
		}).catch(error => {
			this.logService.error('[lean] Failed to load Quick Chat', error);
			this.pendingOperations = [];
			this._onDidClose.fire();
		}).finally(() => { this.loading = undefined; });
	}

	override dispose(): void {
		this.generation++;
		this.pendingOperations = [];
		super.dispose();
	}
}
