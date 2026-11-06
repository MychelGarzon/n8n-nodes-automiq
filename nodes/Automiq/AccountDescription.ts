import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { automiqApiRequest, operationProperty } from './GenericFunctions';

export const accountOperations: INodeProperties[] = [
	operationProperty(
		'account',
		[
			{
				name: 'Get',
				value: 'get',
				action: 'Get account details',
				description: 'Get your AutomiQ account status and usage in the last 30 days',
			},
			{
				name: 'Get Many Numbers',
				value: 'getManyNumbers',
				action: 'Get many phone numbers',
				description: 'List the WhatsApp numbers connected to your AutomiQ account',
			},
			{
				name: 'Get Number',
				value: 'getNumber',
				action: 'Get a phone number',
				description: 'Get the status and quality rating of one connected number',
			},
		],
		'get',
	),
];

export const accountFields: INodeProperties[] = [
	{
		displayName: 'Phone Number Name or ID',
		name: 'accountNumberId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPhoneNumbers' },
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: { resource: ['account'], operation: ['getNumber'] } },
	},
];

export async function executeAccount(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operation) {
		case 'get': {
			const response = await automiqApiRequest.call(
				this,
				'GET',
				'/api/gateway/account',
				undefined,
				i,
			);
			return [{ json: response, pairedItem: { item: i } }];
		}
		case 'getManyNumbers': {
			const response = await automiqApiRequest.call(
				this,
				'GET',
				'/api/gateway/numbers',
				undefined,
				i,
			);
			const rows = (response.data as IDataObject[] | undefined) ?? [];
			return rows.map((row) => ({ json: row, pairedItem: { item: i } }));
		}
		case 'getNumber': {
			const raw = this.getNodeParameter('accountNumberId', i);
			const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
			if (!id) {
				throw new NodeOperationError(this.getNode(), 'Choose a Phone Number', { itemIndex: i });
			}
			const response = await automiqApiRequest.call(
				this,
				'GET',
				`/api/gateway/numbers/${encodeURIComponent(id)}`,
				undefined,
				i,
			);
			return [{ json: response, pairedItem: { item: i } }];
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
