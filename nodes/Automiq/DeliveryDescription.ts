import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { AUTOMIQ_BASE_URL } from '../../credentials/AutomiqApi.credentials';
import { automiqApiRequest, operationProperty } from './GenericFunctions';

const MAX_PAGE_SIZE = 100;

export const deliveryOperations: INodeProperties[] = [
	operationProperty(
		'delivery',
		[
			{
				name: 'Get',
				value: 'get',
				action: 'Get a delivery',
				description: 'Get one webhook delivery from the AutomiQ delivery log',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				action: 'Get many deliveries',
				description: 'List recent webhook deliveries, newest first',
			},
			{
				name: 'Send Test Delivery',
				value: 'sendTest',
				action: 'Send a test delivery',
				description: 'Send a signed test event to the webhook URL set in the AutomiQ portal',
			},
		],
		'getMany',
	),
];

export const deliveryFields: INodeProperties[] = [
	{
		displayName: 'Delivery ID',
		name: 'deliveryId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 615',
		description: 'The ID of a delivery, from Get Many or from a Send Test Delivery result',
		displayOptions: { show: { resource: ['delivery'], operation: ['get'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['delivery'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['delivery'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: { show: { resource: ['delivery'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Phone Number Name or ID',
				name: 'numberId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPhoneNumbers' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				hint: 'Only returns deliveries for this number. Older deliveries do not record a number.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Delivered', value: 'delivered' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Skipped', value: 'skipped' },
				],
				default: 'failed',
				description: 'Only return deliveries with this outcome',
			},
		],
	},
];

export async function executeDelivery(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'get': {
			const id = String(this.getNodeParameter('deliveryId', i)).trim();
			if (!/^\d+$/.test(id)) {
				throw new NodeOperationError(this.getNode(), 'Delivery ID must be a whole number', {
					itemIndex: i,
				});
			}
			const response = await automiqApiRequest.call(
				this,
				'GET',
				`/api/gateway/deliveries/${id}`,
				undefined,
				i,
			);
			return [{ json: response, pairedItem: { item: i } }];
		}
		case 'getMany': {
			const returnAll = this.getNodeParameter('returnAll', i) as boolean;
			const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;

			if ('numberId' in filters && !String(filters.numberId ?? '').trim()) {
				throw new NodeOperationError(this.getNode(), 'Choose a Phone Number for the filter', {
					itemIndex: i,
					description:
						'The Phone Number filter is empty. Pick a number, or remove the filter to list all deliveries.',
				});
			}

			const rows: IDataObject[] = [];
			let cursor: string | undefined;
			// The cursor is opaque: it is passed back exactly as the gateway returned it.
			do {
				const parts = [`limit=${Math.min(MAX_PAGE_SIZE, limit - rows.length)}`];
				if (filters.status) parts.push(`status=${encodeURIComponent(String(filters.status))}`);
				if (filters.numberId)
					parts.push(`number_id=${encodeURIComponent(String(filters.numberId))}`);
				if (cursor) parts.push(`before=${encodeURIComponent(cursor)}`);
				const page = await automiqApiRequest.call(
					this,
					'GET',
					`/api/gateway/deliveries?${parts.join('&')}`,
					undefined,
					i,
				);
				rows.push(...((page.data as IDataObject[] | undefined) ?? []));
				cursor = typeof page.next_cursor === 'string' ? page.next_cursor : undefined;
			} while (cursor && rows.length < limit);
			return rows.slice(0, limit).map((row) => ({ json: row, pairedItem: { item: i } }));
		}
		case 'sendTest': {
			const response = await this.helpers.httpRequestWithAuthentication.call(this, 'automiqApi', {
				method: 'POST',
				url: `${AUTOMIQ_BASE_URL}/api/gateway/webhook/test`,
				json: true,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			});
			const status = Number(response.statusCode);
			const body = (response.body ?? {}) as IDataObject;
			if (status === 409) {
				throw new NodeOperationError(
					this.getNode(),
					'No webhook URL is set in the AutomiQ portal',
					{
						itemIndex: i,
						description:
							'Open the Webhook page in the AutomiQ portal, paste the URL of your AutomiQ for WhatsApp Trigger, and try again.',
					},
				);
			}
			if (status === 429) {
				const retryAfter = (response.headers as IDataObject | undefined)?.['retry-after'];
				throw new NodeOperationError(this.getNode(), 'Too many test deliveries', {
					itemIndex: i,
					description: retryAfter
						? `Try again in ${String(retryAfter)} seconds.`
						: 'Try again in a few minutes.',
				});
			}
			if (status >= 400) {
				throw new NodeApiError(this.getNode(), body as JsonObject, {
					httpCode: String(status),
					itemIndex: i,
				});
			}
			// A failed ping is a normal answer: ok is false and the delivery log has the reason.
			return [{ json: body, pairedItem: { item: i } }];
		}
		default:
			throw new NodeOperationError(
				this.getNode(),
				`The operation "${operation}" is not supported`,
				{
					itemIndex: i,
				},
			);
	}
}
