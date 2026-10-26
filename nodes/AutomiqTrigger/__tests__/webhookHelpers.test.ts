import { createHmac } from 'crypto';

import {
	flattenEvents,
	isPing,
	MAX_TIMESTAMP_SKEW_SECONDS,
	verifyAutomiqSignature,
} from '../webhookHelpers';

const SECRET = 'test-webhook-secret';
const NOW = 1_800_000_000;
const BODY = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

function sign(timestamp: string, body: Buffer = BODY, secret = SECRET): string {
	return (
		'sha256=' +
		createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(body).digest('hex')
	);
}

function check(overrides: Partial<Parameters<typeof verifyAutomiqSignature>[0]> = {}) {
	const timestamp = String(NOW);
	return verifyAutomiqSignature({
		secret: SECRET,
		timestamp,
		signature: sign(timestamp),
		rawBody: BODY,
		nowSeconds: NOW,
		...overrides,
	});
}

describe('verifyAutomiqSignature', () => {
	it('accepts a correct signature', () => {
		expect(check()).toEqual({ valid: true });
	});

	it('accepts a timestamp right at the allowed skew', () => {
		const timestamp = String(NOW - MAX_TIMESTAMP_SKEW_SECONDS);
		expect(check({ timestamp, signature: sign(timestamp) })).toEqual({ valid: true });
	});

	it('rejects a signature made with another secret', () => {
		const timestamp = String(NOW);
		expect(check({ signature: sign(timestamp, BODY, 'other-secret') })).toEqual({
			valid: false,
			reason: 'bad_signature',
		});
	});

	it('rejects a body that changed after signing', () => {
		expect(check({ rawBody: Buffer.from('{"changed":true}') })).toEqual({
			valid: false,
			reason: 'bad_signature',
		});
	});

	it('signs the exact raw bytes, so re-formatted JSON fails', () => {
		const reformatted = Buffer.from(JSON.stringify(JSON.parse(BODY.toString()), null, 2));
		expect(check({ rawBody: reformatted })).toEqual({ valid: false, reason: 'bad_signature' });
	});

	it.each([
		['too old', NOW - MAX_TIMESTAMP_SKEW_SECONDS - 1],
		['too far in the future', NOW + MAX_TIMESTAMP_SKEW_SECONDS + 1],
	])('rejects a timestamp that is %s', (_label, value) => {
		const timestamp = String(value);
		expect(check({ timestamp, signature: sign(timestamp) })).toEqual({
			valid: false,
			reason: 'stale_timestamp',
		});
	});

	it.each([
		['missing', undefined],
		['empty', ''],
		['not numeric', 'yesterday'],
		['in milliseconds', String(NOW * 1000)],
	])('rejects a timestamp that is %s', (_label, timestamp) => {
		expect(check({ timestamp })).toEqual({ valid: false, reason: 'missing_or_bad_timestamp' });
	});

	it.each([
		['missing', undefined],
		['without the sha256= prefix', sign(String(NOW)).replace('sha256=', '')],
	])('rejects a signature that is %s', (_label, signature) => {
		expect(check({ signature })).toEqual({ valid: false, reason: 'missing_signature' });
	});

	it.each([
		['too short', 'sha256=abc'],
		['not hex', 'sha256=' + 'z'.repeat(64)],
		['upper case', sign(String(NOW)).toUpperCase().replace('SHA256=', 'sha256=')],
	])('rejects a signature that is %s without throwing', (_label, signature) => {
		expect(() => check({ signature })).not.toThrow();
		expect(check({ signature })).toEqual({ valid: false, reason: 'bad_signature' });
	});
});

describe('isPing', () => {
	it('recognises a portal ping', () => {
		expect(isPing({ object: 'automiq', type: 'ping' })).toBe(true);
	});

	it.each([
		['a WhatsApp delivery', { object: 'whatsapp_business_account', entry: [] }],
		['another AutomiQ event', { object: 'automiq', type: 'other' }],
		['null', null],
		['a string', 'ping'],
	])('does not treat %s as a ping', (_label, payload) => {
		expect(isPing(payload)).toBe(false);
	});
});

describe('flattenEvents with unexpected payloads', () => {
	it.each([
		['null', null],
		['an empty object', {}],
		['an entry without changes', { entry: [{ id: '200000000000002' }] }],
	])('returns no events for %s', (_label, payload) => {
		expect(flattenEvents(payload, ['messages', 'statuses', 'other'])).toEqual([]);
	});
});
