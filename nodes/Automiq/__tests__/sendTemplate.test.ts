import { buildTemplateMessage, describeApiError, parseTemplateRef } from '../helpers';
import type { TemplateParameterInput } from '../helpers';

// Built with a function so the n8n lint rule for option names does not read test data as node options.
const param = (value: string, name?: string): TemplateParameterInput => (name ? { name, value } : { value });

describe('parseTemplateRef', () => {
	it.each([
		['hello_world|en_US', { name: 'hello_world', code: 'en_US' }],
		[' order_update | es ', { name: 'order_update', code: 'es' }],
		['pago_pendiente|es_LA', { name: 'pago_pendiente', code: 'es_LA' }],
	])('parses %s', (input, expected) => {
		expect(parseTemplateRef(input)).toEqual(expected);
	});

	it.each(['', 'hello_world', '|en_US', 'Hello World|en_US', 'hello_world|english'])('rejects %p', (input) => {
		expect(() => parseTemplateRef(input)).toThrow('not a valid template');
	});
});

describe('buildTemplateMessage', () => {
	const to = '+1 650 555 1234';

	it('sends a template without parameters with no components key', () => {
		expect(buildTemplateMessage({ to, template: 'hello_world|en_US' })).toEqual({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: '16505551234',
			type: 'template',
			template: { name: 'hello_world', language: { code: 'en_US' } },
		});
	});

	it('sends numbered parameters in order', () => {
		const body = buildTemplateMessage({
			to,
			template: 'order_update|en_US',
			bodyParameters: [{ value: 'Jessica' }, { value: 'A-123' }],
		});
		expect((body.template as { components: unknown }).components).toEqual([
			{ type: 'body', parameters: [{ type: 'text', text: 'Jessica' }, { type: 'text', text: 'A-123' }] },
		]);
	});

	it('sends named parameters with parameter_name', () => {
		const body = buildTemplateMessage({
			to,
			template: 'order_update|en_US',
			bodyParameters: [param('Jessica', 'first_name')],
		});
		expect((body.template as { components: unknown }).components).toEqual([
			{ type: 'body', parameters: [{ type: 'text', parameter_name: 'first_name', text: 'Jessica' }] },
		]);
	});

	it('lets Components (JSON) replace Body Parameters', () => {
		const components = [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/a.jpg' } }] }];
		const body = buildTemplateMessage({
			to,
			template: 'promo|en_US',
			bodyParameters: [{ value: 'ignored' }],
			componentsJson: JSON.stringify(components),
		});
		expect((body.template as { components: unknown }).components).toEqual(components);
	});

	it('rejects mixed, empty and malformed input', () => {
		expect(() =>
			buildTemplateMessage({ to, template: 'a|en', bodyParameters: [param('1', 'x'), param('2')] }),
		).toThrow('not both');
		expect(() => buildTemplateMessage({ to, template: 'a|en', bodyParameters: [{ value: ' ' }] })).toThrow(
			'Body parameter 1 is empty',
		);
		expect(() => buildTemplateMessage({ to, template: 'a|en', componentsJson: '{not json' })).toThrow(
			'not valid JSON',
		);
		expect(() => buildTemplateMessage({ to, template: 'a|en', componentsJson: '{"type":"body"}' })).toThrow(
			'must be an array',
		);
	});
});

describe('template errors', () => {
	it('explains 132000 and 132001', () => {
		expect(describeApiError(400, { error: { message: 'x', code: 132000 } })?.message).toBe(
			'The template parameters do not match the template',
		);
		expect(describeApiError(404, { error: { message: 'x', code: 132001 } })?.message).toBe(
			'This template does not exist or is not approved',
		);
	});
});
