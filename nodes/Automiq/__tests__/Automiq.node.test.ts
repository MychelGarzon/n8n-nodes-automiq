import { Automiq } from '../Automiq.node';

describe('Automiq node description', () => {
	const { description } = new Automiq();

	it('uses the AutomiQ name and is usable as a tool', () => {
		expect(description.name).toBe('automiq');
		expect(description.displayName).toBe('AutomiQ for WhatsApp');
		expect(description.usableAsTool).toBe(true);
	});
	it('uses short action names', () => {
		const description = new Automiq().description;
		const operations = description.properties.filter((p) => p.name === 'operation');
		const actionsFor = (resource: string) =>
			(
				operations.find((p) => p.displayOptions?.show?.resource?.includes(resource))
					?.options as Array<{ action?: string }>
			).map((o) => o.action);

		expect(actionsFor('account')).toEqual([
			'Get account details',
			'Get many phone numbers',
			'Get a phone number',
		]);
		expect(actionsFor('delivery')).toEqual([
			'Get a delivery',
			'Get many deliveries',
			'Send a test delivery',
		]);
		expect(actionsFor('webhook')).toEqual(['Get webhook status']);
		expect(actionsFor('message')).toEqual([
			'Download received media',
			'Mark message as read',
			'Send media message',
			'Send a raw message payload',
			'Send template message',
			'Send text message',
		]);
	});
});
