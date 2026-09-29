/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../base/common/uri.js';
import { SessionSummaryHoverService } from '../../../browser/agentSessions/sessionSummaryHoverService.js';

// The first test loads the widget module, whose shared DOM/theme registrations outlive this suite.
// Each provider and token created here is disposed explicitly instead.
// eslint-disable-next-line local/code-ensure-no-disposables-leak-in-test
suite('SessionSummaryHoverService', () => {
	const resource = URI.parse('agent-host-session://test/123');

	test('creates a hover when a provider supplies data', async () => {
		const service = new SessionSummaryHoverService();
		const registration = service.registerProvider({ provideSessionSummaryHoverData: async () => ({ title: 'Review changes' }) });
		try {
			const element = await service.createHoverElement(resource, CancellationToken.None);
			assert.ok(element);
			assert.strictEqual(element.querySelector('.session-summary-hover-title-text')?.textContent, 'Review changes');
		} finally {
			registration.dispose();
		}
	});

	test('returns no hover when providers have no data', async () => {
		const service = new SessionSummaryHoverService();
		const registration = service.registerProvider({ provideSessionSummaryHoverData: async () => undefined });
		try {
			assert.strictEqual(await service.createHoverElement(resource, CancellationToken.None), undefined);
		} finally {
			registration.dispose();
		}
	});

	test('does not create a hover after provider cancellation', async () => {
		const service = new SessionSummaryHoverService();
		const source = new CancellationTokenSource();
		const registration = service.registerProvider({
			provideSessionSummaryHoverData: async () => {
				source.cancel();
				return { title: 'Cancelled' };
			}
		});
		try {
			assert.strictEqual(await service.createHoverElement(resource, source.token), undefined);
		} finally {
			registration.dispose();
			source.dispose();
		}
	});
});
