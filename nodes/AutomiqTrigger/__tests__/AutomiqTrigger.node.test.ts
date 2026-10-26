import { createHmac } from 'crypto';
import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';

import { AutomiqTrigger } from '../AutomiqTrigger.node';

const SECRET = 'test-webhook-secret';
const NOW = 1_800_000_000;

const messagePayload = {
	object: 'whatsapp_business_account',
	entry: [
		{
			id: '200000000000002',
			changes: [
				{
					field: 'messages',
					value: {
						messaging_product: 'whatsapp',
						metadata: {
							display_phone_number: '15550001234',
							phone_number_id: '100000000000001',
						},
						contacts: [{ wa_id: '15550009999', profile: { name: 'Test User' } }],
						messages: [
							{
								id: 'wamid.TEST1',
								from: '15550009999',
								timestamp: '1800000000',
								type: 'text',
								text: { body: 'Hello' },
							},
						],
					},
				},
			],
		},
	],
};

const statusPayload = {
	object: 'whatsapp_business_account',
	entry: [
		{
			id: '200000000000002',
			changes: [
				{
					field: 'messages',
					value: {
						metadata: {
							display_phone_number: '15550001234',
							phone_number_id: '100000000000001',
						},
						statuses: [
							{
								id: 'wamid.TEST2',
								status: 'delivered',
								recipient_id: '15550009999',
								timestamp: '1800000000',
							},
						],
					},
				},
			],
		},
	],
};

const pingPayload = { object: 'automiq', type: 'ping', sent_at: '2026-10-26T12:00:00Z' };

function sign(body: Buffer, timestamp: string, secret = SECRET): string {
	return (
		'sha256=' +
		createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(body).digest('hex')
	);
}

interface SetupOptions {
	secret?: string;
	body?: Buffer | null;
	headers?: Record<string, string>;
	events?: string[];
	options?: IDataObject;
	staticData?: IDataObject;
}

function setup(opts: SetupOptions = {}) {
	const body = opts.body === undefined ? Buffer.from(JSON.stringify(messagePayload)) : opts.body;
	const timestamp = String(NOW);
	const headers =
		opts.headers ??
		(body
			? { 'x-automiq-timestamp': timestamp, 'x-automiq-signature': sign(body, timestamp) }
			: {});

	const end = jest.fn();
	const json = jest.fn(() => ({ end }));
	const status = jest.fn(() => ({ json }));
	const staticData = opts.staticData ?? {};

	const context = {
		getCredentials: jest.fn(async () => ({
			apiKey: 'unused',
			webhookSecret: opts.secret ?? SECRET,
		})),
		getRequestObject: jest.fn(() => (body ? { rawBody: body } : {})),
		getHeaderData: jest.fn(() => headers),
		getResponseObject: jest.fn(() => ({ status })),
		getNodeParameter: jest.fn((name: string, fallback?: unknown) => {
			if (name === 'events') return opts.events ?? ['messages'];
			if (name === 'options') return opts.options ?? {};
			return fallback;
		}),
		getWorkflowStaticData: jest.fn(() => staticData),
		helpers: {
			returnJsonArray: (items: IDataObject[]) => items.map((json) => ({ json })),
		},
	};

	const run = () => new AutomiqTrigger().webhook.call(context as unknown as IWebhookFunctions);

	return { run, status, json, end, staticData };
}

function signedBody(payload: unknown): Pick<SetupOptions, 'body'> {
	return { body: Buffer.from(JSON.stringify(payload)) };
}

describe('AutomiqTrigger webhook', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(NOW * 1000);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('rejections', () => {
		it('returns 401 secret_not_configured when the credential has no webhook secret', async () => {
			const { run, status, json } = setup({ secret: '   ' });
			const result = await run();
			expect(status).toHaveBeenCalledWith(401);
			expect(json).toHaveBeenCalledWith({
				error: 'invalid_signature',
				reason: 'secret_not_configured',
			});
			expect(result).toEqual({ noWebhookResponse: true });
		});

		it('returns 401 raw_body_missing when n8n gives no raw body', async () => {
			const { run, status, json } = setup({ body: null, headers: {} });
			const result = await run();
			expect(status).toHaveBeenCalledWith(401);
			expect(json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'raw_body_missing' });
			expect(result).toEqual({ noWebhookResponse: true });
		});

		it('returns 401 when the signature headers are missing', async () => {
			const { run, status } = setup({ headers: {} });
			const result = await run();
			expect(status).toHaveBeenCalledWith(401);
			expect(result).toEqual({ noWebhookResponse: true });
		});

		it('returns 401 bad_signature for a signature made with another secret', async () => {
			const body = Buffer.from(JSON.stringify(messagePayload));
			const timestamp = String(NOW);
			const { run, json } = setup({
				body,
				headers: {
					'x-automiq-timestamp': timestamp,
					'x-automiq-signature': sign(body, timestamp, 'wrong-secret'),
				},
			});
			await run();
			expect(json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'bad_signature' });
		});

		it('returns 401 bad_signature when the body was changed after signing', async () => {
			const original = Buffer.from(JSON.stringify(messagePayload));
			const tampered = Buffer.from(JSON.stringify({ ...messagePayload, object: 'changed' }));
			const timestamp = String(NOW);
			const { run, json } = setup({
				body: tampered,
				headers: {
					'x-automiq-timestamp': timestamp,
					'x-automiq-signature': sign(original, timestamp),
				},
			});
			await run();
			expect(json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'bad_signature' });
		});

		it.each([
			['more than 5 minutes old', String(NOW - 301)],
			['more than 5 minutes in the future', String(NOW + 301)],
		])('returns 401 stale_timestamp for a timestamp %s', async (_label, timestamp) => {
			const body = Buffer.from(JSON.stringify(messagePayload));
			const { run, json } = setup({
				body,
				headers: { 'x-automiq-timestamp': timestamp, 'x-automiq-signature': sign(body, timestamp) },
			});
			await run();
			expect(json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'stale_timestamp' });
		});

		it('returns 401 for a non-numeric timestamp', async () => {
			const body = Buffer.from(JSON.stringify(messagePayload));
			const { run, json } = setup({
				body,
				headers: {
					'x-automiq-timestamp': 'yesterday',
					'x-automiq-signature': sign(body, 'yesterday'),
				},
			});
			await run();
			expect(json).toHaveBeenCalledWith({
				error: 'invalid_signature',
				reason: 'missing_or_bad_timestamp',
			});
		});

		it.each([
			['without the sha256= prefix', (sig: string) => sig.replace('sha256=', '')],
			['that is too short', () => 'sha256=abc'],
			['that is not hex', (sig: string) => sig.replace(/[0-9a-f]/g, 'z')],
		])('returns 401 for a signature %s and never throws', async (_label, mangle) => {
			const body = Buffer.from(JSON.stringify(messagePayload));
			const timestamp = String(NOW);
			const { run, status } = setup({
				body,
				headers: {
					'x-automiq-timestamp': timestamp,
					'x-automiq-signature': mangle(sign(body, timestamp)),
				},
			});
			await expect(run()).resolves.toEqual({ noWebhookResponse: true });
			expect(status).toHaveBeenCalledWith(401);
		});

		it.each([
			['invalid JSON', 'not json {'],
			['JSON null', 'null'],
			['a JSON number', '42'],
			['a JSON array', '[1,2]'],
		])('returns 400 invalid_json for a validly signed body that is %s', async (_label, text) => {
			const { run, status, json } = setup({
				body: Buffer.from(text),
				options: { rawPayload: true },
			});
			const result = await run();
			expect(status).toHaveBeenCalledWith(400);
			expect(json).toHaveBeenCalledWith({ error: 'invalid_body', reason: 'invalid_json' });
			expect(result).toEqual({ noWebhookResponse: true });
		});
	});

	describe('accepted deliveries', () => {
		it('outputs one flat item for a text message', async () => {
			const { run, status } = setup();
			const result = await run();
			expect(status).not.toHaveBeenCalled();
			expect(result.workflowData?.[0]).toHaveLength(1);
			expect(result.workflowData?.[0][0].json).toMatchObject({
				event: 'message',
				message_id: 'wamid.TEST1',
				from: '15550009999',
				name: 'Test User',
				type: 'text',
				text: 'Hello',
				timestamp: 1800000000,
				phone_number_id: '100000000000001',
				display_phone_number: '15550001234',
				waba_id: '200000000000002',
			});
		});

		it('ignores a portal ping by default', async () => {
			const { run } = setup(signedBody(pingPayload));
			await expect(run()).resolves.toEqual({ webhookResponse: 'OK' });
		});

		it('starts the workflow for a portal ping when Include Portal Pings is on', async () => {
			const { run } = setup({ ...signedBody(pingPayload), options: { includePings: true } });
			const result = await run();
			expect(result.workflowData?.[0][0].json).toMatchObject({ event: 'ping', object: 'automiq' });
		});

		it('outputs the whole delivery as one item when Raw Payload is on', async () => {
			const { run } = setup({ options: { rawPayload: true } });
			const result = await run();
			expect(result.workflowData?.[0]).toHaveLength(1);
			expect(result.workflowData?.[0][0].json).toEqual(messagePayload);
		});

		it('returns OK without starting the workflow when the Events filter drops everything', async () => {
			const { run } = setup({ events: ['statuses'] });
			await expect(run()).resolves.toEqual({ webhookResponse: 'OK' });
		});

		it('outputs statuses when Statuses is selected', async () => {
			const { run } = setup({ ...signedBody(statusPayload), events: ['statuses'] });
			const result = await run();
			expect(result.workflowData?.[0][0].json).toMatchObject({
				event: 'status',
				message_id: 'wamid.TEST2',
				status: 'delivered',
			});
		});
	});
});
