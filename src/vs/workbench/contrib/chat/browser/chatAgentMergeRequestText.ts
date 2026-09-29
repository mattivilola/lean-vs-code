/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IAgentMergePromptSummary, parseAgentMergePrompt } from '../../../../platform/agentHost/common/agentMergePrompt.js';
import { IChatRequestViewModel } from '../common/model/chatViewModel.js';

export const agentMergeSource = localize('chat.agentMerge.source', "Agent Merge");

/** The status shown in the header, describing why the turn was started. */
export function describeAgentMergeStatus(summary: IAgentMergePromptSummary, commentCount: number): string {
	const events: string[] = [];
	if (commentCount > 0) {
		events.push(commentCount === 1
			? localize('chat.agentMerge.oneReviewComment', "1 Review Comment")
			: localize('chat.agentMerge.reviewComments', "{0} Review Comments", commentCount));
	}
	if (summary.failedChecks.length > 0) {
		events.push(summary.failedChecks.length === 1
			? localize('chat.agentMerge.oneFailingCheck', "1 Failing Check")
			: localize('chat.agentMerge.failingChecks', "{0} Failing Checks", summary.failedChecks.length));
	}
	if (summary.conflicting) {
		events.push(localize('chat.agentMerge.mergeConflicts', "Merge Conflicts"));
	}
	if (summary.behind) {
		events.push(localize('chat.agentMerge.behindBaseBranch', "Behind Base Branch"));
	}
	if (events.length === 0) {
		events.push(localize('chat.agentMerge.noPendingFeedback', "No Pending Feedback"));
	}

	return formatAgentMergeEvents(events);
}

function formatAgentMergeEvents(events: readonly string[]): string {
	switch (events.length) {
		case 1:
			return events[0];
		case 2:
			return localize('chat.agentMerge.twoEvents', "{0} and {1}", events[0], events[1]);
		case 3:
			return localize('chat.agentMerge.threeEvents', "{0}, {1}, and {2}", events[0], events[1], events[2]);
		default:
			return localize('chat.agentMerge.fourEvents', "{0}, {1}, {2}, and {3}", events[0], events[1], events[2], events[3]);
	}
}

/**
 * Plain-text rendering of the widget's collapsed header. The request's own text
 * is the machine-facing prompt, which is never displayed, so screen readers and
 * transcript find use this in its place.
 */
export function getAgentMergeSummaryLabel(summary: IAgentMergePromptSummary): string {
	const commentCount = summary.reviewThreads.reduce((count, thread) => count + thread.comments.length, 0)
		+ summary.reviewSummaries.length + summary.newComments.length;
	const status = describeAgentMergeStatus(summary, commentCount);
	return localize('chat.agentMerge.summaryLabel', "{0}, {1}", status, agentMergeSource);
}

/**
 * Stand-in label for a system-initiated Agent Merge request, whose own text is
 * the machine-facing prompt this widget renders in place of. Returns
 * `undefined` for every other request, which keeps its own text.
 */
export function getAgentMergeRequestLabel(element: IChatRequestViewModel): string | undefined {
	const summary = getAgentMergeRequestSummary(element);
	return summary && getAgentMergeSummaryLabel(summary);
}

/** Extracts display data only for explicitly identified Agent Merge requests. */
export function getAgentMergeRequestSummary(element: IChatRequestViewModel): IAgentMergePromptSummary | undefined {
	if (!element.isSystemInitiated || element.requestSource !== 'agentMerge' || element.systemInitiatedLabel !== undefined) {
		return undefined;
	}
	return parseAgentMergePrompt(element.messageText);
}
