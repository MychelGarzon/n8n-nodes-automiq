import { buildTextMessage, describeApiError, normalizeRecipient } from '../helpers';

describe('normalizeRecipient', () => {
	it.each([
		['+358 40 123 4567', '358401234567'],
		['00358-40-1234567', '358401234567'],
		['(358) 401234567', '358401234567'],
		['358401234567', '358401234567'],
	])('cleans %s', (input, expected) => {
		expect(normalizeRecipient(input)).toBe(expected);
	});

	it.each(['', 'abc', '12345', '1234567890123456'])('rejects %p', (input) => {
		expect(() => normalizeRecipient(input)).toThrow('not a valid phone number');
	});
});

describe('buildTextMessage', () => {
	it('builds the minimal Meta body with no optional keys', () => {
		expect(buildTextMessage({ to: '+358 40 123 4567', text: 'Hi' })).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '358401234567',
			type: 'text',
			text: { body: 'Hi' },
		});
	});

	it('adds preview_url and the reply context only when set', () => {
		const body = buildTextMessage({
			to: '358401234567',
			text: 'See https://automiq.fi',
			previewUrl: true,
			replyToMessageId: ' wamid.ABC ',
		});
		expect(body.text).toEqual({ body: 'See https://automiq.fi', preview_url: true });
		expect(body.context).toEqual({ message_id: 'wamid.ABC' });
	});

	it('rejects empty and too long text', () => {
		expect(() => buildTextMessage({ to: '358401234567', text: '   ' })).toThrow('empty');
		expect(() => buildTextMessage({ to: '358401234567', text: 'x'.repeat(4097) })).toThrow('4096');
	});
});

describe('describeApiError', () => {
	const gateway = (code: number, message: string) => ({
		error: { message, type: 'AutomiQGatewayError', code },
	});

	it('explains gateway 401, 403 and 502', () => {
		expect(describeApiError(401, gateway(401, 'Invalid or revoked API key.'))?.message).toBe(
			'Invalid or revoked AutomiQ API key',
		);
		expect(describeApiError(403, gateway(403, 'Client is suspended.'))?.message).toBe(
			'This AutomiQ account is suspended',
		);
		expect(
			describeApiError(403, gateway(403, 'The first path segment must be one of your phone_number_ids'))
				?.message,
		).toBe('This phone number is not linked to your AutomiQ account');
		expect(describeApiError(502, gateway(502, 'Could not reach the Meta Graph API.'))?.message).toBe(
			'AutomiQ could not reach WhatsApp',
		);
	});

	it('explains the 24-hour window and keeps Meta text and code', () => {
		const result = describeApiError(400, {
			error: {
				message: 'Message failed to send',
				code: 131047,
				error_data: { details: 'Re-engagement message' },
			},
		});
		expect(result?.message).toBe('Outside the 24-hour customer service window');
		expect(result?.description).toContain('Re-engagement message');
		expect(result?.description).toContain('131047');
	});

	it('passes unknown Meta codes through and ignores unknown shapes', () => {
		expect(describeApiError(400, { error: { message: 'Something', code: 999 } })?.message).toBe(
			'WhatsApp rejected the request',
		);
		expect(describeApiError(500, { foo: 'bar' })).toBeUndefined();
		expect(describeApiError(undefined, undefined)).toBeUndefined();
	});
});
