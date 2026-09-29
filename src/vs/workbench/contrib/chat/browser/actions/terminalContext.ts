/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { ITerminalCommand, TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import type { IChatRequestVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import type { IChatWidget } from '../chat.js';
import type { IChatContextValueItem } from '../attachments/chatContextPickService.js';

export class TerminalContext implements IChatContextValueItem {

	readonly type = 'valuePick';
	readonly icon = Codicon.terminal;
	readonly label = localize('terminal', 'Terminal');
	constructor(private readonly _resource: URI, @ITerminalService private readonly _terminalService: ITerminalService) {

	}
	isEnabled(widget: IChatWidget) {
		const terminal = this._terminalService.getInstanceFromResource(this._resource);
		return !!widget.attachmentCapabilities.supportsTerminalAttachments && terminal?.isDisposed === false;
	}
	async asAttachment(widget: IChatWidget): Promise<IChatRequestVariableEntry | undefined> {
		const terminal = this._terminalService.getInstanceFromResource(this._resource);
		if (!terminal) {
			return;
		}
		const params = new URLSearchParams(this._resource.query);
		const command = terminal.capabilities.get(TerminalCapability.CommandDetection)?.commands.find(cmd => cmd.id === params.get('command'));
		if (!command) {
			return;
		}
		const attachment: IChatRequestVariableEntry = {
			kind: 'terminalCommand',
			id: `terminalCommand:${Date.now()}}`,
			value: this.asValue(command),
			name: command.command,
			command: command.command,
			output: command.getOutput(),
			exitCode: command.exitCode,
			resource: this._resource
		};
		const cleanup = new DisposableStore();
		let disposed = false;
		const disposeCleanup = () => {
			if (disposed) {
				return;
			}
			disposed = true;
			cleanup.dispose();
		};
		cleanup.add(widget.attachmentModel.onDidChange(e => {
			if (e.deleted.includes(attachment.id)) {
				disposeCleanup();
			}
		}));
		cleanup.add(terminal.onDisposed(() => {
			widget.attachmentModel.delete(attachment.id);
			widget.refreshParsedInput();
			disposeCleanup();
		}));
		return attachment;
	}

	private asValue(command: ITerminalCommand): string {
		let value = `Command: ${command.command}`;
		const output = command.getOutput();
		if (output) {
			value += `\nOutput:\n${output}`;
		}
		if (typeof command.exitCode === 'number') {
			value += `\nExit Code: ${command.exitCode}`;
		}
		return value;
	}
}
