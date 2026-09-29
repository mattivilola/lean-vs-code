/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Lean VS Code contributors. MIT License.
 *--------------------------------------------------------------------------------------------*/

import type { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { INLINE_CHAT_ID } from '../common/inlineChat.js';
import type { InlineChatController } from './inlineChatController.js';

export function getInlineChatController(editor: ICodeEditor): InlineChatController | undefined {
	return editor.getContribution<InlineChatController>(INLINE_CHAT_ID) ?? undefined;
}
