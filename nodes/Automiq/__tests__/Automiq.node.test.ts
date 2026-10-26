import { Automiq } from '../Automiq.node';

describe('Automiq node description', () => {
	const { description } = new Automiq();

	it('uses the AutomiQ name and is usable as a tool', () => {
		expect(description.name).toBe('automiq');
		expect(description.displayName).toBe('AutomiQ for WhatsApp');
		expect(description.usableAsTool).toBe(true);
	});
	it('uses short action names', () => {
		const operation = description.properties.find((p) => p.name === 'operation');
		const actions = (operation?.options as Array<{ action?: string }>).map((o) => o.action);
		expect(actions).toEqual([
			'Mark message as read',
			'Send media message',
			'Send template message',
			'Send text message',
		]);
	});
});
