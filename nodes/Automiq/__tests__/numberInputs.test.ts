import { buildMediaMessage, buildTemplateMessage, buildTextMessage } from '../helpers';

// An expression like {{1}} or {{ $json.amount }} gives a number, not a string.
const asString = (value: unknown) => value as string;

describe('fields that an expression turned into a number', () => {
	it('treats a Name of only digits as a numbered variable instead of crashing', () => {
		const body = buildTemplateMessage({
			to: '15550009999',
			template: 'automiq_test|en',
			bodyParameters: [
				{ name: asString(1), value: 'Mychel' },
				{ name: asString(2), value: asString(42) },
			],
		});
		expect(body.template).toEqual({
			name: 'automiq_test',
			language: { code: 'en' },
			components: [
				{
					type: 'body',
					parameters: [
						{ type: 'text', text: 'Mychel' },
						{ type: 'text', text: '42' },
					],
				},
			],
		});
	});

	it('keeps real named variables', () => {
		const firstName = 'first_name';
		const body = buildTemplateMessage({
			to: '15550009999',
			template: 'order_update|en_US',
			bodyParameters: [{ name: firstName, value: 'Mychel' }],
		});
		expect(JSON.stringify(body)).toContain('"parameter_name":"first_name"');
	});

	it('accepts numbers for caption, file name and reply ID in media messages', () => {
		const body = buildMediaMessage({
			to: '15550009999',
			mediaType: 'document',
			source: 'link',
			value: 'https://example.com/file.pdf',
			caption: asString(2026),
			filename: asString(123),
			replyToMessageId: asString(42),
		});
		expect(body.document).toEqual({
			link: 'https://example.com/file.pdf',
			caption: '2026',
			filename: '123',
		});
		expect(body.context).toEqual({ message_id: '42' });
	});

	it('accepts a number as reply ID in text messages', () => {
		const body = buildTextMessage({ to: '15550009999', text: 'Hi', replyToMessageId: asString(7) });
		expect(body.context).toEqual({ message_id: '7' });
	});

	it('ignores values that are not text or numbers', () => {
		const body = buildMediaMessage({
			to: '15550009999',
			mediaType: 'image',
			source: 'link',
			value: 'https://example.com/photo.jpg',
			caption: asString({ not: 'text' }),
		});
		expect(body.image).toEqual({ link: 'https://example.com/photo.jpg' });
	});
});
