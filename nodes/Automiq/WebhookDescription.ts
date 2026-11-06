import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { automiqApiRequest } from './GenericFunctions';

export const webhookOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['webhook'] } },
		options: [
			{
				name: 'Get Status',
				value: 'getStatus',
				action: 'Get webhook status',
				description:
					'Check whether a webhook URL is set, the host it points to, the test URL state and the last delivery',
			},
		],
		default: 'getStatus',
	},
];

export async function executeWebhook(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (operation !== 'getStatus') {
		throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not supported`, {
			itemIndex: i,
		});
	}
	const response = await automiqApiRequest.call(
		this,
		'GET',
		'/api/gateway/webhook/status',
		undefined,
		i,
	);
	return [{ json: response, pairedItem: { item: i } }];
}
