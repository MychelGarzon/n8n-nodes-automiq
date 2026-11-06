import { buildRecipientFields, buildTemplateMessage, buildTextMessage } from '../helpers';

const BSUID = 'US.13491208655302741918';

describe('buildRecipientFields', () => {
	it('uses the phone number by default', () => {
		expect(buildRecipientFields({ to: '+1 650 555 1234' })).toEqual({ to: '16505551234' });
	});

	it('uses only the BSUID in BSUID mode', () => {
		expect(buildRecipientFields({ recipientMode: 'bsuid', recipient: BSUID })).toEqual({
			recipient: BSUID,
		});
	});

	it('does not need a phone number in BSUID mode', () => {
		expect(buildRecipientFields({ recipientMode: 'bsuid', recipient: BSUID, to: '' })).toEqual({
			recipient: BSUID,
		});
	});

	it('sends both identifiers in both mode', () => {
		expect(
			buildRecipientFields({ recipientMode: 'both', to: '16505551234', recipient: BSUID }),
		).toEqual({ to: '16505551234', recipient: BSUID });
	});

	it('accepts enterprise BSUIDs', () => {
		const parent = 'US.ENT.11815799212886844830';
		expect(buildRecipientFields({ recipientMode: 'bsuid', recipient: parent })).toEqual({
			recipient: parent,
		});
	});

	it.each(['', '16505551234', 'US', 'US.', 'not a bsuid'])('rejects "%s" as a BSUID', (value) => {
		expect(() => buildRecipientFields({ recipientMode: 'bsuid', recipient: value })).toThrow(
			'is not a valid business-scoped user ID',
		);
	});

	it('asks for the phone number when the mode needs it', () => {
		expect(() => buildRecipientFields({ recipientMode: 'both', recipient: BSUID })).toThrow(
			'recipient phone number is empty',
		);
	});

	it('rejects an unknown mode', () => {
		expect(() => buildRecipientFields({ recipientMode: 'email', to: '16505551234' })).toThrow(
			'Unsupported recipient mode',
		);
	});
});

describe('message bodies with a BSUID recipient', () => {
	it('puts recipient and no to in a text message', () => {
		const body = buildTextMessage({ recipientMode: 'bsuid', recipient: BSUID, text: 'Hello' });

		expect(body).toMatchObject({ type: 'text', recipient: BSUID, text: { body: 'Hello' } });
		expect(body).not.toHaveProperty('to');
	});

	it('puts recipient and no to in a template message', () => {
		const body = buildTemplateMessage({
			recipientMode: 'bsuid',
			recipient: BSUID,
			template: 'welcome|en_US',
		});

		expect(body).toMatchObject({ type: 'template', recipient: BSUID });
		expect(body).not.toHaveProperty('to');
	});
});
