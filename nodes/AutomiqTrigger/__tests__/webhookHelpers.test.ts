import { createHmac } from 'crypto';

import {
	filterNewEvents,
	flattenEvents,
	isPing,
	verifyAutomiqSignature,
} from '../webhookHelpers';

const secret = 'a'.repeat(64);
const now = 1792772500;
const sign = (ts: string, body: string, key = secret) =>
	'sha256=' + createHmac('sha256', key).update(`${ts}.${body}`, 'utf8').digest('hex');

// Shape of a real AutomiQ delivery (incoming text message), with personal data replaced.
const messagePayload = {
	object: 'whatsapp_business_account',
	entry: [
		{
			id: '1994442441262596',
			changes: [
				{
					field: 'messages',
					value: {
						messaging_product: 'whatsapp',
						metadata: { display_phone_number: '358468045157', phone_number_id: '1352140101310633' },
						contacts: [{ profile: { name: 'Test User' }, wa_id: '16505551234', user_id: 'US.1' }],
						messages: [
							{
								from: '16505551234',
								from_user_id: 'US.1',
								id: 'wamid.IN1',
								timestamp: '1792772499',
								text: { body: 'Test read' },
								type: 'text',
							},
						],
					},
				},
			],
		},
	],
};

const statusPayload = {
	object: 'whatsapp_business_account',
	entry: [
		{
			id: '1994442441262596',
			changes: [
				{
					field: 'messages',
					value: {
						metadata: { display_phone_number: '358468045157', phone_number_id: '1352140101310633' },
						statuses: [
							{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1792772500', recipient_id: '16505551234' },
						],
					},
				},
			],
		},
	],
};

describe('verifyAutomiqSignature', () => {
	const body = JSON.stringify(messagePayload);
	const ts = String(now);
	const check = (overrides: Partial<Parameters<typeof verifyAutomiqSignature>[0]>) =>
		verifyAutomiqSignature({
			secret,
			timestamp: ts,
			signature: sign(ts, body),
			rawBody: Buffer.from(body, 'utf8'),
			nowSeconds: now,
			...overrides,
		});

	it('accepts a correct signature', () => {
		expect(check({})).toEqual({ valid: true });
	});

	it('rejects a wrong secret, a tampered body, a stale timestamp and missing headers', () => {
		expect(check({ signature: sign(ts, body, 'b'.repeat(64)) })).toEqual({ valid: false, reason: 'bad_signature' });
		expect(check({ rawBody: Buffer.from(body.replace('Test read', 'Hacked'), 'utf8') })).toEqual({
			valid: false,
			reason: 'bad_signature',
		});
		expect(check({ nowSeconds: now + 301 })).toEqual({ valid: false, reason: 'stale_timestamp' });
		expect(check({ timestamp: undefined })).toEqual({ valid: false, reason: 'missing_or_bad_timestamp' });
		expect(check({ signature: undefined })).toEqual({ valid: false, reason: 'missing_signature' });
	});

	it('works on the raw bytes, including non-ASCII text', () => {
		const unicode = JSON.stringify({ text: 'Hola, ¿qué tal? ✓' });
		expect(
			verifyAutomiqSignature({
				secret,
				timestamp: ts,
				signature: sign(ts, unicode),
				rawBody: Buffer.from(unicode, 'utf8'),
				nowSeconds: now,
			}),
		).toEqual({ valid: true });
	});
});

describe('isPing', () => {
	it('recognises the portal test delivery only', () => {
		expect(isPing({ object: 'automiq', type: 'ping', id: 'x' })).toBe(true);
		expect(isPing(messagePayload)).toBe(false);
		expect(isPing(null)).toBe(false);
	});
});

describe('flattenEvents', () => {
	it('flattens an incoming text message and keeps the original in raw', () => {
		const [event] = flattenEvents(messagePayload, ['messages']);
		expect(event).toMatchObject({
			event: 'message',
			message_id: 'wamid.IN1',
			from: '16505551234',
			from_user_id: 'US.1',
			name: 'Test User',
			type: 'text',
			text: 'Test read',
			timestamp: 1792772499,
			phone_number_id: '1352140101310633',
			display_phone_number: '358468045157',
			waba_id: '1994442441262596',
		});
		expect(event.raw).toEqual(messagePayload.entry[0].changes[0].value.messages[0]);
	});

	it('flattens statuses, and filters by event kind', () => {
		expect(flattenEvents(statusPayload, ['statuses'])).toEqual([
			expect.objectContaining({ event: 'status', message_id: 'wamid.OUT1', status: 'delivered' }),
		]);
		expect(flattenEvents(statusPayload, ['messages'])).toEqual([]);
		expect(flattenEvents(messagePayload, ['statuses'])).toEqual([]);
	});

	it('reads media, interactive replies and reply context', () => {
		const payload = JSON.parse(JSON.stringify(messagePayload));
		payload.entry[0].changes[0].value.messages = [
			{ id: 'w1', from: '1', timestamp: '1', type: 'image', image: { id: '123', mime_type: 'image/jpeg', caption: 'Hi' } },
			{ id: 'w2', from: '1', timestamp: '1', type: 'interactive', interactive: { button_reply: { id: 'yes', title: 'Yes' } } },
			{ id: 'w3', from: '1', timestamp: '1', type: 'text', text: { body: 'ok' }, context: { id: 'wamid.PREV' } },
		];
		const [image, button, reply] = flattenEvents(payload, ['messages']);
		expect(image).toMatchObject({ media_id: '123', mime_type: 'image/jpeg', caption: 'Hi' });
		expect(button).toMatchObject({ text: 'Yes', reply_id: 'yes' });
		expect(reply).toMatchObject({ text: 'ok', reply_to_message_id: 'wamid.PREV' });
		expect(image).not.toHaveProperty('text');
	});

	it('puts other changes under event "other" only when asked', () => {
		const other = { entry: [{ id: 'W', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }] }] };
		expect(flattenEvents(other, ['messages', 'statuses'])).toEqual([]);
		expect(flattenEvents(other, ['other'])).toEqual([
			{ event: 'other', field: 'message_template_status_update', waba_id: 'W', raw: { event: 'APPROVED' } },
		]);
	});
});

describe('filterNewEvents', () => {
	it('skips messages and statuses seen before, but keeps a new status for the same message', () => {
		const events = flattenEvents(messagePayload, ['messages']);
		const first = filterNewEvents(events, []);
		expect(first.fresh).toHaveLength(1);
		expect(filterNewEvents(events, first.seen).fresh).toHaveLength(0);

		const delivered = flattenEvents(statusPayload, ['statuses']);
		const read = JSON.parse(JSON.stringify(delivered));
		read[0].status = 'read';
		const afterDelivered = filterNewEvents(delivered, []);
		expect(filterNewEvents(read, afterDelivered.seen).fresh).toHaveLength(1);
	});
});
