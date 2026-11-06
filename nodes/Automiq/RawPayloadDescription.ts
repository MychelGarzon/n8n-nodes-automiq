import type {
	IDataObject,
	INodeProperties,
	IExecuteFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { GRAPH_VERSION, automiqApiRequest } from './GenericFunctions';

export const rawPayloadFields: INodeProperties[] = [
	{
		displayName: 'Phone Number Name or ID',
		name: 'rawNumberId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPhoneNumbers' },
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: ['message'], operation: ['sendRaw'] } },
	},
	{
		displayName: 'Payload (JSON)',
		name: 'rawPayload',
		type: 'json',
		required: true,
		default: '{\n  "to": "358401234567",\n  "type": "text",\n  "text": { "body": "Hello" }\n}',
		description:
			'The message body in the WhatsApp Cloud API format. The field messaging_product is added for you. Use this for message types the other operations do not cover, such as interactive buttons or lists.',
		displayOptions: { show: { resource: ['message'], operation: ['sendRaw'] } },
	},
];

export async function executeSendRaw(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const rawNumber = this.getNodeParameter('rawNumberId', i);
	const numberId =
		typeof rawNumber === 'string' || typeof rawNumber === 'number' ? String(rawNumber).trim() : '';
	if (!numberId) {
		throw new NodeOperationError(this.getNode(), 'Choose a Phone Number', { itemIndex: i });
	}

	const rawBody = this.getNodeParameter('rawPayload', i);
	let payload: unknown = rawBody;
	if (typeof rawBody === 'string') {
		try {
			payload = JSON.parse(rawBody);
		} catch {
			throw new NodeOperationError(this.getNode(), 'The payload is not valid JSON', {
				itemIndex: i,
				description: 'Check for a missing comma, quote or bracket.',
			});
		}
	}
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		throw new NodeOperationError(this.getNode(), 'The payload must be a JSON object', {
			itemIndex: i,
		});
	}

	const body = { messaging_product: 'whatsapp', ...(payload as IDataObject) };
	const response = await automiqApiRequest.call(
		this,
		'POST',
		`/api/gateway/whatsapp/${GRAPH_VERSION}/${encodeURIComponent(numberId)}/messages`,
		body,
		i,
	);
	return [{ json: response, pairedItem: { item: i } }];
}
