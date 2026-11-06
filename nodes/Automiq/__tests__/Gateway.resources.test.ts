import type { IDataObject, IExecuteFunctions, INode } from 'n8n-workflow';

import { Automiq } from '../Automiq.node';

const BASE = 'https://www.automiq.fi/api/gateway';
const NUMBER_ID = '100000000000001';

const node: INode = {
	id: 'test-node',
	name: 'AutomiQ for WhatsApp',
	type: '@automiq/n8n-nodes-automiq.automiq',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** Builds a fake execute context. Each call to the request mock returns the next answer. */
function setup(params: IDataObject, answers: unknown[]) {
	const queue = [...answers];
	const request = jest.fn(async () => queue.shift());
	const prepareBinaryData = jest.fn(
		async (_buffer: Buffer, fileName: string, mimeType: string) => ({
			data: 'BINARY',
			fileName,
			mimeType,
		}),
	);

	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		getNode: () => node,
		continueOnFail: () => false,
		helpers: { httpRequestWithAuthentication: request, prepareBinaryData },
	};

	const run = () => new Automiq().execute.call(context as unknown as IExecuteFunctions);
	return { run, request, prepareBinaryData };
}

const callOptions = (request: jest.Mock, n = 0) => request.mock.calls[n][1] as IDataObject;

describe('Account resource', () => {
	it('gets the account', async () => {
		const { run, request } = setup({ resource: 'account', operation: 'get' }, [
			{ client: { name: 'AutomiQ' }, numbers_count: 1 },
		]);
		const [out] = await run();

		expect(callOptions(request).url).toBe(`${BASE}/account`);
		expect(out[0].json).toEqual({ client: { name: 'AutomiQ' }, numbers_count: 1 });
	});

	it('returns one item per number', async () => {
		const { run, request } = setup({ resource: 'account', operation: 'getManyNumbers' }, [
			{ data: [{ phone_number_id: 'a' }, { phone_number_id: 'b' }] },
		]);
		const [out] = await run();

		expect(callOptions(request).url).toBe(`${BASE}/numbers`);
		expect(out.map((o) => o.json.phone_number_id)).toEqual(['a', 'b']);
	});

	it('gets one number by ID', async () => {
		const { run, request } = setup(
			{ resource: 'account', operation: 'getNumber', accountNumberId: NUMBER_ID },
			[{ phone_number_id: NUMBER_ID, status: 'active' }],
		);
		await run();

		expect(callOptions(request).url).toBe(`${BASE}/numbers/${NUMBER_ID}`);
	});

	it('asks for a number when none is chosen', async () => {
		const { run } = setup({ resource: 'account', operation: 'getNumber', accountNumberId: '' }, []);
		await expect(run()).rejects.toThrow('Choose a Phone Number');
	});
});

describe('Delivery resource', () => {
	it('gets one delivery', async () => {
		const { run, request } = setup({ resource: 'delivery', operation: 'get', deliveryId: '615' }, [
			{ id: 615 },
		]);
		await run();

		expect(callOptions(request).url).toBe(`${BASE}/deliveries/615`);
	});

	it('rejects a delivery ID that is not a number', async () => {
		const { run, request } = setup(
			{ resource: 'delivery', operation: 'get', deliveryId: '615/../x' },
			[],
		);
		await expect(run()).rejects.toThrow('Delivery ID must be a whole number');
		expect(request).not.toHaveBeenCalled();
	});

	it('follows the opaque cursor when returning all', async () => {
		const { run, request } = setup(
			{ resource: 'delivery', operation: 'getMany', returnAll: true, filters: {} },
			[
				{ data: [{ id: 3 }, { id: 2 }], next_cursor: 'CURSOR+/=' },
				{ data: [{ id: 1 }], next_cursor: null },
			],
		);
		const [out] = await run();

		expect(out.map((o) => o.json.id)).toEqual([3, 2, 1]);
		expect(request).toHaveBeenCalledTimes(2);
		expect(callOptions(request, 0).url).not.toContain('before=');
		expect(callOptions(request, 1).url).toContain(`before=${encodeURIComponent('CURSOR+/=')}`);
	});

	it('stops at the limit', async () => {
		const { run } = setup(
			{ resource: 'delivery', operation: 'getMany', returnAll: false, limit: 2, filters: {} },
			[{ data: [{ id: 3 }, { id: 2 }, { id: 1 }], next_cursor: 'MORE' }],
		);
		const [out] = await run();

		expect(out).toHaveLength(2);
	});

	it('sends the status and number filters', async () => {
		const { run, request } = setup(
			{
				resource: 'delivery',
				operation: 'getMany',
				returnAll: false,
				limit: 10,
				filters: { status: 'failed', numberId: NUMBER_ID },
			},
			[{ data: [] }],
		);
		await run();

		const url = callOptions(request).url as string;
		expect(url).toContain('status=failed');
		expect(url).toContain(`number_id=${NUMBER_ID}`);
	});

	it('rejects an empty number filter', async () => {
		const { run, request } = setup(
			{
				resource: 'delivery',
				operation: 'getMany',
				returnAll: false,
				limit: 10,
				filters: { numberId: '' },
			},
			[],
		);
		await expect(run()).rejects.toThrow('Choose a Phone Number for the filter');
		expect(request).not.toHaveBeenCalled();
	});

	describe('Send Test Delivery', () => {
		const sendTest = (response: IDataObject) =>
			setup({ resource: 'delivery', operation: 'sendTest' }, [response]);

		it('returns the result, also when the ping failed', async () => {
			const { run } = sendTest({
				statusCode: 200,
				body: { ok: false, status_code: 500, delivery_id: 9 },
			});
			const [out] = await run();

			expect(out[0].json).toEqual({ ok: false, status_code: 500, delivery_id: 9 });
		});

		it('explains that no webhook URL is set', async () => {
			const { run } = sendTest({ statusCode: 409, body: {} });
			await expect(run()).rejects.toThrow('No webhook URL is set in the AutomiQ portal');
		});

		it('reports the Retry-After seconds when rate limited', async () => {
			const { run } = sendTest({ statusCode: 429, headers: { 'retry-after': '120' }, body: {} });
			await expect(run()).rejects.toMatchObject({ description: 'Try again in 120 seconds.' });
		});
	});
});

describe('Webhook resource', () => {
	it('gets the webhook status', async () => {
		const { run, request } = setup({ resource: 'webhook', operation: 'getStatus' }, [
			{ configured: true, url_host: 'example.com' },
		]);
		const [out] = await run();

		expect(callOptions(request).url).toBe(`${BASE}/webhook/status`);
		expect(out[0].json.url_host).toBe('example.com');
	});
});

describe('Download Media', () => {
	const params = {
		resource: 'message',
		operation: 'downloadMedia',
		mediaNumberId: NUMBER_ID,
		downloadMediaId: '2662315310887503',
		binaryPropertyName: 'data',
	};

	it('returns the file as binary data', async () => {
		const { run, request, prepareBinaryData } = setup(params, [
			{
				statusCode: 200,
				headers: { 'content-type': 'image/jpeg' },
				body: new Uint8Array([1, 2, 3]).buffer,
			},
		]);
		const [out] = await run();

		expect(callOptions(request).url).toBe(`${BASE}/media/2662315310887503?number_id=${NUMBER_ID}`);
		expect(prepareBinaryData).toHaveBeenCalledWith(
			expect.any(Buffer),
			'media-2662315310887503.jpg',
			'image/jpeg',
		);
		expect(out[0].json).toEqual({
			media_id: '2662315310887503',
			mime_type: 'image/jpeg',
			file_size: 3,
		});
		expect(out[0].binary?.data).toBeDefined();
	});

	it('explains the 4 MB limit', async () => {
		const { run } = setup(params, [{ statusCode: 413, body: new ArrayBuffer(0) }]);
		await expect(run()).rejects.toThrow('The media is larger than 4 MB');
	});

	it('says when the media is not found', async () => {
		const { run } = setup(params, [{ statusCode: 404, body: new ArrayBuffer(0) }]);
		await expect(run()).rejects.toThrow('Media not found');
	});

	it('rejects a message ID in place of a media ID', async () => {
		const { run, request } = setup({ ...params, downloadMediaId: 'wamid.HBgM' }, []);
		await expect(run()).rejects.toThrow('Media ID must contain digits only');
		expect(request).not.toHaveBeenCalled();
	});
});

describe('Send Raw Payload', () => {
	const raw = (payload: string) => ({
		resource: 'message',
		operation: 'sendRaw',
		rawNumberId: NUMBER_ID,
		rawPayload: payload,
	});

	it('adds messaging_product and posts the body', async () => {
		const { run, request } = setup(
			raw('{"to":"358401234567","type":"text","text":{"body":"Hi"}}'),
			[{ messages: [{ id: 'wamid.X' }] }],
		);
		await run();

		const options = callOptions(request);
		expect(options.url).toBe(`${BASE}/whatsapp/v21.0/${NUMBER_ID}/messages`);
		expect(options.body).toEqual({
			messaging_product: 'whatsapp',
			to: '358401234567',
			type: 'text',
			text: { body: 'Hi' },
		});
	});

	it('rejects invalid JSON', async () => {
		const { run, request } = setup(raw('{ not json'), []);
		await expect(run()).rejects.toThrow('The payload is not valid JSON');
		expect(request).not.toHaveBeenCalled();
	});

	it('rejects a payload that is not an object', async () => {
		const { run } = setup(raw('[1,2]'), []);
		await expect(run()).rejects.toThrow('The payload must be a JSON object');
	});
});
