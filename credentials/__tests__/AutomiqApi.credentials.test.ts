import { AutomiqApi, AUTOMIQ_BASE_URL } from '../AutomiqApi.credentials';

describe('AutomiqApi credential', () => {
	const credential = new AutomiqApi();

	it('sends the API key as the X-API-Key header', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'X-API-Key': '={{$credentials.apiKey}}' } },
		});
	});

	it('tests against the numbers endpoint on the www host', () => {
		expect(AUTOMIQ_BASE_URL).toBe('https://www.automiq.fi');
		expect(credential.test.request).toEqual({
			baseURL: 'https://www.automiq.fi',
			url: '/api/gateway/numbers',
			method: 'GET',
		});
	});

	it('stores both secrets as password fields', () => {
		for (const name of ['apiKey', 'webhookSecret']) {
			const field = credential.properties.find((p) => p.name === name);
			expect(field?.typeOptions?.password).toBe(true);
		}
	});

	it('only requires the API key', () => {
		const required = credential.properties.filter((p) => p.required).map((p) => p.name);
		expect(required).toEqual(['apiKey']);
	});
});

describe('AutomiqApi credential test rules', () => {
	const credential = new AutomiqApi();

	it('explains 401 and 403 in plain words', () => {
		const rules = credential.test.rules ?? [];
		const byCode = Object.fromEntries(
			rules.map((rule) => [
				(rule.properties as { value: number }).value,
				(rule.properties as { message: string }).message,
			]),
		);
		expect(byCode[401]).toContain('Invalid or revoked AutomiQ API key');
		expect(byCode[403]).toContain('suspended');
	});
});
