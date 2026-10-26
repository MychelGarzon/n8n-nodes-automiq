import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { Automiq } from '../Automiq.node';

const API_KEY = 'amq_live_TEST_KEY_DO_NOT_LEAK';
const PHONE_NUMBER_ID = '100000000000001';
const SEND_URL = `https://www.automiq.fi/api/gateway/whatsapp/v21.0/${PHONE_NUMBER_ID}/messages`;

const node: INode = {
	id: 'test-node',
	name: 'AutomiQ for WhatsApp',
	type: '@automiq/n8n-nodes-automiq.automiq',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const sendText = (extra: IDataObject = {}): IDataObject => ({
	resource: 'message',
	operation: 'sendText',
	phoneNumberId: PHONE_NUMBER_ID,
	to: '+1 555 000 9999',
	text: 'Hello',
	...extra,
});

/** An error shaped like the one n8n throws when the gateway answers with an HTTP error. */
function gatewayFailure(status: number, data: IDataObject): NodeApiError {
	return new NodeApiError(node, {
		message: `Request failed with status code ${status}`,
		response: { status, data },
		config: { headers: { 'X-API-Key': API_KEY } },
	} as unknown as JsonObject);
}

function setup(items: IDataObject[], opts: { continueOnFail?: boolean } = {}) {
	const request = jest.fn(async () => ({ messages: [{ id: 'wamid.SENT' }] }));

	const context = {
		getInputData: () => items.map(() => ({ json: {} })),
		getNodeParameter: (name: string, i: number, fallback?: unknown) => items[i][name] ?? fallback,
		getNode: () => node,
		continueOnFail: () => opts.continueOnFail ?? false,
		helpers: { httpRequestWithAuthentication: request },
	};

	const run = () => new Automiq().execute.call(context as unknown as IExecuteFunctions);
	return { run, request };
}

describe('Automiq node execute', () => {
	describe('requests', () => {
		it('sends a text message through the gateway with the credential', async () => {
			const { run, request } = setup([sendText({ options: { previewUrl: true } })]);
			const [output] = await run();

			expect(request).toHaveBeenCalledTimes(1);
			expect(request).toHaveBeenCalledWith('automiqApi', {
				method: 'POST',
				url: SEND_URL,
				json: true,
				body: {
					messaging_product: 'whatsapp',
					recipient_type: 'individual',
					to: '15550009999',
					type: 'text',
					text: { body: 'Hello', preview_url: true },
				},
			});
			expect(output).toEqual([
				{ json: { messages: [{ id: 'wamid.SENT' }] }, pairedItem: { item: 0 } },
			]);
		});

		it('sends a media message by URL', async () => {
			const { run, request } = setup([
				{
					resource: 'message',
					operation: 'sendMedia',
					phoneNumberId: PHONE_NUMBER_ID,
					to: '15550009999',
					mediaType: 'image',
					mediaSource: 'link',
					mediaUrl: 'https://example.com/photo.jpg',
					caption: 'A photo',
				},
			]);
			await run();
			expect(request).toHaveBeenCalledWith(
				'automiqApi',
				expect.objectContaining({
					url: SEND_URL,
					body: expect.objectContaining({
						type: 'image',
						image: { link: 'https://example.com/photo.jpg', caption: 'A photo' },
					}),
				}),
			);
		});

		it('sends a template message with body parameters', async () => {
			const { run, request } = setup([
				{
					resource: 'message',
					operation: 'sendTemplate',
					phoneNumberId: PHONE_NUMBER_ID,
					to: '15550009999',
					template: 'order_update|en_US',
					bodyParameters: { parameter: [{ value: 'A-123' }] },
				},
			]);
			await run();
			expect(request).toHaveBeenCalledWith(
				'automiqApi',
				expect.objectContaining({
					body: expect.objectContaining({
						type: 'template',
						template: {
							name: 'order_update',
							language: { code: 'en_US' },
							components: [{ type: 'body', parameters: [{ type: 'text', text: 'A-123' }] }],
						},
					}),
				}),
			);
		});

		it('marks a message as read with the typing indicator', async () => {
			const { run, request } = setup([
				{
					resource: 'message',
					operation: 'markAsRead',
					phoneNumberId: PHONE_NUMBER_ID,
					messageId: 'wamid.IN',
					showTypingIndicator: true,
				},
			]);
			await run();
			expect(request).toHaveBeenCalledWith(
				'automiqApi',
				expect.objectContaining({
					body: {
						messaging_product: 'whatsapp',
						status: 'read',
						message_id: 'wamid.IN',
						typing_indicator: { type: 'text' },
					},
				}),
			);
		});

		it('accepts a phone number ID that an expression returns as a number', async () => {
			const { run, request } = setup([sendText({ phoneNumberId: Number(PHONE_NUMBER_ID) })]);
			await run();
			expect(request).toHaveBeenCalledWith(
				'automiqApi',
				expect.objectContaining({ url: SEND_URL }),
			);
		});
	});

	describe('validation', () => {
		it.each([
			['empty', ''],
			['only spaces', '   '],
			['missing', undefined],
		])('stops with a clear message when the sender phone number is %s', async (_label, value) => {
			const { run, request } = setup([sendText({ phoneNumberId: value })]);
			await expect(run()).rejects.toThrow('Choose a Sender Phone Number');
			expect(request).not.toHaveBeenCalled();
		});

		it('stops on an invalid recipient before calling the gateway', async () => {
			const { run, request } = setup([sendText({ to: 'not a number' })]);
			await expect(run()).rejects.toThrow('is not a valid phone number');
			expect(request).not.toHaveBeenCalled();
		});
	});

	describe('continue on fail', () => {
		it('returns one output per item with the right pairedItem when one item fails', async () => {
			const { run, request } = setup(
				[sendText(), sendText({ to: 'bad' }), sendText({ phoneNumberId: '' })],
				{ continueOnFail: true },
			);
			const [output] = await run();

			expect(request).toHaveBeenCalledTimes(1);
			expect(output).toHaveLength(3);
			expect(output.map((item) => item.pairedItem)).toEqual([
				{ item: 0 },
				{ item: 1 },
				{ item: 2 },
			]);
			expect(output[1].json.error).toContain('is not a valid phone number');
			expect(output[2].json).toMatchObject({
				error: 'Choose a Sender Phone Number',
				description: expect.stringContaining('Sender Phone Number list'),
			});
		});
	});

	describe('gateway and WhatsApp errors', () => {
		async function failWith(error: unknown, continueOnFail = false) {
			const { run, request } = setup([sendText()], { continueOnFail });
			request.mockRejectedValueOnce(error);
			return run();
		}

		it('explains an invalid API key', async () => {
			const error = gatewayFailure(401, {
				error: { type: 'AutomiQGatewayError', code: 401, message: 'Invalid API key' },
			});
			await expect(failWith(error)).rejects.toMatchObject({
				message: 'Invalid or revoked AutomiQ API key',
				description: expect.stringContaining('AutomiQ portal'),
			});
		});

		it('explains a suspended account', async () => {
			const error = gatewayFailure(403, {
				error: { type: 'AutomiQGatewayError', code: 403, message: 'Client is suspended' },
			});
			await expect(failWith(error)).rejects.toMatchObject({
				message: 'This AutomiQ account is suspended',
			});
		});

		it('explains WhatsApp error 131047 and keeps the original text', async () => {
			const error = gatewayFailure(400, {
				error: {
					code: 131047,
					message: 'Re-engagement message',
					error_data: { details: 'More than 24 hours have passed' },
				},
			});
			await expect(failWith(error)).rejects.toMatchObject({
				message: 'Outside the 24-hour customer service window',
				description: expect.stringContaining(
					'Re-engagement message: More than 24 hours have passed',
				),
			});
		});

		it('explains the WhatsApp rate limit', async () => {
			const error = gatewayFailure(429, { error: { code: 130429, message: 'Rate limit hit' } });
			await expect(failWith(error)).rejects.toMatchObject({
				message: 'WhatsApp rate limit reached',
			});
		});

		it('keeps the description in the item under continue on fail', async () => {
			const error = gatewayFailure(401, {
				error: { type: 'AutomiQGatewayError', code: 401, message: 'Invalid API key' },
			});
			const [output] = await failWith(error, true);
			expect(output[0].json).toMatchObject({
				error: 'Invalid or revoked AutomiQ API key',
				description: expect.stringContaining('AutomiQ portal'),
			});
		});

		it.each([
			[
				'a known gateway error',
				{ error: { type: 'AutomiQGatewayError', code: 401, message: 'x' } },
			],
			['a known WhatsApp error', { error: { code: 131047, message: 'x' } }],
			['an unknown error body', { unexpected: 'shape' }],
		])('never puts the API key in the error for %s', async (_label, data) => {
			const error = gatewayFailure(401, data as IDataObject);
			const thrown = await failWith(error).catch((e: unknown) => e);
			expect(JSON.stringify(thrown)).not.toContain(API_KEY);

			const [output] = await failWith(gatewayFailure(401, data as IDataObject), true);
			expect(JSON.stringify(output)).not.toContain(API_KEY);
		});
	});
});

describe('Automiq node load options', () => {
	function loadContext(responses: unknown[], currentPhoneNumberId?: string) {
		const request = jest.fn();
		for (const response of responses) request.mockResolvedValueOnce(response);
		const context = {
			getNode: () => node,
			getCurrentNodeParameter: () => currentPhoneNumberId,
			helpers: { httpRequestWithAuthentication: request },
		};
		return { context: context as unknown as ILoadOptionsFunctions, request };
	}

	it('lists the account phone numbers', async () => {
		const { context } = loadContext([
			{
				data: [
					{ phone_number_id: PHONE_NUMBER_ID, display_phone_number: '15550001234' },
					{ phone_number_id: '100000000000009', display_phone_number: null },
				],
			},
		]);
		const options = await new Automiq().methods.loadOptions.getPhoneNumbers.call(context);
		expect(options).toEqual([
			{
				name: '15550001234',
				value: PHONE_NUMBER_ID,
				description: `Phone number ID ${PHONE_NUMBER_ID}`,
			},
			{
				name: '100000000000009',
				value: '100000000000009',
				description: 'Phone number ID 100000000000009',
			},
		]);
	});

	it('lists only approved templates, sorted, across pages', async () => {
		const { context, request } = loadContext(
			[
				{ data: [{ phone_number_id: PHONE_NUMBER_ID, waba_id: '200000000000002' }] },
				{
					data: [
						{ name: 'welcome', language: 'en_US', status: 'APPROVED', category: 'MARKETING' },
						{ name: 'draft', language: 'en_US', status: 'PENDING' },
					],
					paging: { next: 'https://next', cursors: { after: 'CURSOR' } },
				},
				{ data: [{ name: 'alert', language: 'fi', status: 'APPROVED', category: 'UTILITY' }] },
			],
			PHONE_NUMBER_ID,
		);
		const options = await new Automiq().methods.loadOptions.getTemplates.call(context);

		expect(options.map((o) => o.value)).toEqual(['alert|fi', 'welcome|en_US']);
		expect(options.map((o) => o.name)).toEqual(['alert (fi)', 'welcome (en_US)']);
		expect(options.map((o) => o.description)).toEqual(['utility', 'marketing']);
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls[2][1].url).toContain('after=CURSOR');
	});

	it('returns no templates when no sender phone number is chosen', async () => {
		const { context, request } = loadContext([]);
		const options = await new Automiq().methods.loadOptions.getTemplates.call(context);
		expect(options).toEqual([]);
		expect(request).not.toHaveBeenCalled();
	});

	it('returns no templates for a number that is not on the account', async () => {
		const { context } = loadContext([{ data: [] }], PHONE_NUMBER_ID);
		const options = await new Automiq().methods.loadOptions.getTemplates.call(context);
		expect(options).toEqual([]);
	});
});
