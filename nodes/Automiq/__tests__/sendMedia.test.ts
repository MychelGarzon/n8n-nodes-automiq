import { buildMediaMessage } from '../helpers';

const base = { to: '+1 650 555 1234', source: 'link', value: 'https://example.com/photo.jpg' };

describe('buildMediaMessage', () => {
	it('builds an image by link with no optional keys', () => {
		expect(buildMediaMessage({ ...base, mediaType: 'image' })).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '16505551234',
			type: 'image',
			image: { link: 'https://example.com/photo.jpg' },
		});
	});

	it('builds a document by ID with caption, filename and reply', () => {
		const body = buildMediaMessage({
			to: '16505551234',
			mediaType: 'document',
			source: 'id',
			value: ' 1234567890 ',
			caption: 'Invoice for March',
			filename: 'invoice-march.pdf',
			replyToMessageId: 'wamid.ABC',
		});
		expect(body.document).toEqual({
			id: '1234567890',
			caption: 'Invoice for March',
			filename: 'invoice-march.pdf',
		});
		expect(body.context).toEqual({ message_id: 'wamid.ABC' });
	});

	it('never sends a caption for audio or a filename for non-documents', () => {
		expect(buildMediaMessage({ ...base, mediaType: 'audio', caption: 'ignored' }).audio).toEqual({
			link: 'https://example.com/photo.jpg',
		});
		expect(buildMediaMessage({ ...base, mediaType: 'video', filename: 'ignored.mp4' }).video).toEqual({
			link: 'https://example.com/photo.jpg',
		});
	});

	it('rejects bad input with clear messages', () => {
		expect(() => buildMediaMessage({ ...base, mediaType: 'sticker' })).toThrow('Unsupported media type');
		expect(() => buildMediaMessage({ ...base, mediaType: 'image', value: 'http://example.com/a.jpg' })).toThrow(
			'https://',
		);
		expect(() => buildMediaMessage({ ...base, mediaType: 'image', value: 'not a url' })).toThrow('https://');
		expect(() => buildMediaMessage({ ...base, mediaType: 'image', source: 'id', value: 'abc' })).toThrow(
			'only digits',
		);
		expect(() =>
			buildMediaMessage({ ...base, mediaType: 'image', caption: 'x'.repeat(1025) }),
		).toThrow('1024');
	});
});
