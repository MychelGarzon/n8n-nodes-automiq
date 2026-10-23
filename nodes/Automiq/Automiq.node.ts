import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { automiqApiRequest, GRAPH_VERSION, toNodeError } from './GenericFunctions';
import { buildTextMessage } from './helpers';

const showForSendText = { show: { resource: ['message'], operation: ['sendText'] } };

export class Automiq implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AutomiQ for WhatsApp',
		name: 'automiq',
		icon: { light: 'file:../icons/automiq.svg', dark: 'file:../icons/automiq.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp messages through the AutomiQ Gateway (official WhatsApp Cloud API)',
		defaults: {
			name: 'AutomiQ for WhatsApp',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'automiqApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Message', value: 'message' }],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Send Text',
						value: 'sendText',
						action: 'Send a text message',
						description: 'Send a text message to a WhatsApp user',
					},
				],
				default: 'sendText',
			},
			{
				displayName: 'Sender Phone Number Name or ID',
				name: 'phoneNumberId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPhoneNumbers' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: showForSendText,
			},
			{
				displayName: 'Recipient Phone Number',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 358401234567',
				description:
					'The WhatsApp number to send to, in international format with the country code. Spaces, dashes and a leading + are removed.',
				displayOptions: showForSendText,
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The message text, up to 4096 characters',
				displayOptions: showForSendText,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: showForSendText,
				options: [
					{
						displayName: 'Link Preview',
						name: 'previewUrl',
						type: 'boolean',
						default: false,
						description: 'Whether to show a preview of the first link in the text',
					},
					{
						displayName: 'Reply To Message ID',
						name: 'replyToMessageId',
						type: 'string',
						default: '',
						placeholder: 'e.g. wamid.HBgMMzU4...',
						description:
							'The ID of a received message to reply to. WhatsApp shows the reply quoting that message.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getPhoneNumbers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await automiqApiRequest.call(this, 'GET', '/api/gateway/numbers')) as {
					data?: Array<{ phone_number_id: string; display_phone_number: string | null }>;
				};
				return (response.data ?? []).map((number) => ({
					name: number.display_phone_number ?? number.phone_number_id,
					value: number.phone_number_id,
					description: `Phone number ID ${number.phone_number_id}`,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource !== 'message' || operation !== 'sendText') {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported`,
						{ itemIndex: i },
					);
				}

				const phoneNumberId = this.getNodeParameter('phoneNumberId', i) as string;
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const body = buildTextMessage({
					to: this.getNodeParameter('to', i) as string,
					text: this.getNodeParameter('text', i) as string,
					previewUrl: options.previewUrl as boolean | undefined,
					replyToMessageId: options.replyToMessageId as string | undefined,
				});

				const response = await automiqApiRequest.call(
					this,
					'POST',
					`/api/gateway/whatsapp/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
					body as IDataObject,
					i,
				);
				returnData.push({ json: response, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw toNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
