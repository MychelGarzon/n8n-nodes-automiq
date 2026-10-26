import { flattenEvents } from '../webhookHelpers';

const where = {
	phone_number_id: '100000000000001',
	display_phone_number: '15550001234',
	waba_id: '200000000000002',
};

function delivery(...values: Array<Record<string, unknown>>) {
	return {
		entry: [
			{
				id: '200000000000002',
				changes: values.map((value) => ({
					field: 'messages',
					value: {
						metadata: { display_phone_number: '15550001234', phone_number_id: '100000000000001' },
						...value,
					},
				})),
			},
		],
	};
}

const message = (extra: Record<string, unknown>) => ({
	id: 'wamid.M',
	from: '15550009999',
	timestamp: '1800000000',
	...extra,
});

describe('flattenEvents', () => {
	it('keeps messages and statuses that arrive in the same change', () => {
		const payload = delivery({
			messages: [message({ type: 'text', text: { body: 'Hi' } })],
			statuses: [{ id: 'wamid.S', status: 'read', timestamp: '1800000001' }],
		});
		const events = flattenEvents(payload, ['messages', 'statuses']);
		expect(events.map((e) => e.event)).toEqual(['message', 'status']);
	});

	it('outputs one item per message across several entries, changes and messages', () => {
		const payload = {
			entry: [
				delivery(
					{ messages: [message({ id: 'a', type: 'text' }), message({ id: 'b', type: 'text' })] },
					{ messages: [message({ id: 'c', type: 'text' })] },
				).entry[0],
				delivery({ messages: [message({ id: 'd', type: 'text' })] }).entry[0],
			],
		};
		const ids = flattenEvents(payload, ['messages']).map((e) => e.message_id);
		expect(ids).toEqual(['a', 'b', 'c', 'd']);
	});

	it('leaves timestamp out when it is missing or not numeric', () => {
		const payload = delivery({
			messages: [
				message({ id: 'a', type: 'text', timestamp: undefined }),
				message({ id: 'b', type: 'text', timestamp: 'soon' }),
			],
		});
		for (const event of flattenEvents(payload, ['messages'])) {
			expect(event).not.toHaveProperty('timestamp');
		}
	});

	it('maps location messages', () => {
		const payload = delivery({
			messages: [
				message({
					type: 'location',
					location: { latitude: 60.17, longitude: 24.94, name: 'Office', address: 'Main St 1' },
				}),
			],
		});
		expect(flattenEvents(payload, ['messages'])[0]).toMatchObject({
			type: 'location',
			latitude: 60.17,
			longitude: 24.94,
			location_name: 'Office',
			address: 'Main St 1',
		});
	});

	it('maps reactions', () => {
		const payload = delivery({
			messages: [message({ type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.X' } })],
		});
		expect(flattenEvents(payload, ['messages'])[0]).toMatchObject({
			emoji: '👍',
			reacted_message_id: 'wamid.X',
		});
	});

	it('maps stickers like other media', () => {
		const payload = delivery({
			messages: [message({ type: 'sticker', sticker: { id: '123', mime_type: 'image/webp' } })],
		});
		expect(flattenEvents(payload, ['messages'])[0]).toMatchObject({
			media_id: '123',
			mime_type: 'image/webp',
		});
	});

	it('keeps the errors of an unsupported message', () => {
		const errors = [{ code: 131051, title: 'Message type unknown' }];
		const payload = delivery({ messages: [message({ type: 'unsupported', errors })] });
		expect(flattenEvents(payload, ['messages'])[0]).toMatchObject({ type: 'unsupported', errors });
	});

	it('adds the contact name and the number fields', () => {
		const payload = delivery({
			contacts: [{ wa_id: '15550009999', profile: { name: 'Test User' } }],
			messages: [message({ type: 'text', text: { body: 'Hi' } })],
		});
		expect(flattenEvents(payload, ['messages'])[0]).toMatchObject({ name: 'Test User', ...where });
	});

	it('outputs other changes only when Other Events is selected', () => {
		const payload = {
			entry: [
				{
					id: '200000000000002',
					changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }],
				},
			],
		};
		expect(flattenEvents(payload, ['messages'])).toEqual([]);
		expect(flattenEvents(payload, ['other'])[0]).toMatchObject({
			event: 'other',
			field: 'message_template_status_update',
		});
	});
});
