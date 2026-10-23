import { buildMarkAsRead } from '../helpers';

describe('buildMarkAsRead', () => {
	it('marks as read without the typing indicator by default', () => {
		expect(buildMarkAsRead(' wamid.ABC ')).toEqual({
			messaging_product: 'whatsapp',
			status: 'read',
			message_id: 'wamid.ABC',
		});
	});

	it('adds the typing indicator only when asked', () => {
		expect(buildMarkAsRead('wamid.ABC', true)).toEqual({
			messaging_product: 'whatsapp',
			status: 'read',
			message_id: 'wamid.ABC',
			typing_indicator: { type: 'text' },
		});
	});

	it('rejects an empty message ID', () => {
		expect(() => buildMarkAsRead('  ')).toThrow('message ID is empty');
	});
});
