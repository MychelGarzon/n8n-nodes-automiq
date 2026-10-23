import { Automiq } from '../Automiq.node';

describe('Automiq node description', () => {
	const { description } = new Automiq();

	it('uses the AutomiQ name and is usable as a tool', () => {
		expect(description.name).toBe('automiq');
		expect(description.displayName).toBe('AutomiQ for WhatsApp');
		expect(description.usableAsTool).toBe(true);
	});
});
