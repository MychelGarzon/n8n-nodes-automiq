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

import {
	automiqApiRequest,
	GRAPH_VERSION,
	listApprovedTemplates,
	toNodeError,
} from './GenericFunctions';
import {
	buildMarkAsRead,
	buildMediaMessage,
	buildTemplateMessage,
	buildTextMessage,
} from './helpers';

const showFor = (operations: string[], extra: Record<string, string[]> = {}) => ({
	show: { resource: ['message'], operation: operations, ...extra },
});

const replyToMessageIdOption = {
	displayName: 'Reply To Message ID',
	name: 'replyToMessageId',
	type: 'string' as const,
	default: '',
	placeholder: 'e.g. wamid.HBgMMzU4...',
	description:
		'The ID of a received message to reply to. WhatsApp shows the reply quoting that message.',
};

function getPhoneNumberId(this: IExecuteFunctions, i: number): string {
	const raw = this.getNodeParameter('phoneNumberId', i);
	const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
	if (!value) {
		throw new NodeOperationError(this.getNode(), 'Choose a Sender Phone Number', {
			itemIndex: i,
			description:
				'Pick your number from the Sender Phone Number list. If you use an expression, check that it returns the Phone Number ID.',
		});
	}
	return value;
}

function buildRequestBody(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Record<string, unknown> {
	if (resource !== 'message') {
		throw new NodeOperationError(this.getNode(), `The resource "${resource}" is not supported`, {
			itemIndex: i,
		});
	}
	switch (operation) {
		case 'sendText': {
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			return buildTextMessage({
				to: this.getNodeParameter('to', i) as string,
				text: this.getNodeParameter('text', i) as string,
				previewUrl: options.previewUrl as boolean | undefined,
				replyToMessageId: options.replyToMessageId as string | undefined,
			});
		}
		case 'sendMedia': {
			const mediaType = this.getNodeParameter('mediaType', i) as string;
			const source = this.getNodeParameter('mediaSource', i) as string;
			const options = this.getNodeParameter('mediaOptions', i, {}) as IDataObject;
			return buildMediaMessage({
				to: this.getNodeParameter('to', i) as string,
				mediaType,
				source,
				value: this.getNodeParameter(source === 'id' ? 'mediaId' : 'mediaUrl', i) as string,
				caption:
					mediaType === 'audio' ? undefined : (this.getNodeParameter('caption', i, '') as string),
				filename:
					mediaType === 'document'
						? (this.getNodeParameter('filename', i, '') as string)
						: undefined,
				replyToMessageId: options.replyToMessageId as string | undefined,
			});
		}
		case 'sendTemplate': {
			const options = this.getNodeParameter('templateOptions', i, {}) as IDataObject;
			const parameters =
				(
					this.getNodeParameter('bodyParameters', i, {}) as {
						parameter?: Array<{ name?: string; value?: string }>;
					}
				).parameter ?? [];
			return buildTemplateMessage({
				to: this.getNodeParameter('to', i) as string,
				template: this.getNodeParameter('template', i) as string,
				bodyParameters: parameters,
				componentsJson: options.componentsJson,
			});
		}
		case 'markAsRead':
			return buildMarkAsRead(
				this.getNodeParameter('messageId', i) as string,
				this.getNodeParameter('showTypingIndicator', i, false) as boolean,
			);
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
						name: 'Mark as Read',
						value: 'markAsRead',
						action: 'Mark a message as read',
						description: 'Mark a received message as read, optionally showing "typing..."',
					},
					{
						name: 'Send Media',
						value: 'sendMedia',
						action: 'Send a media message',
						description: 'Send an image, document, audio or video to a WhatsApp user',
					},
					{
						name: 'Send Template',
						value: 'sendTemplate',
						action: 'Send a template message',
						description: 'Send an approved template, also outside the 24-hour window',
					},
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
				displayOptions: showFor(['sendText', 'sendMedia', 'sendTemplate', 'markAsRead']),
			},
			{
				displayName: 'Recipient Phone Number',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 16505551234',
				description:
					'The WhatsApp number to send to, in international format with the country code. Spaces, dashes and a leading + are removed.',
				displayOptions: showFor(['sendText', 'sendMedia', 'sendTemplate']),
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'The message text, up to 4096 characters',
				displayOptions: showFor(['sendText']),
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: showFor(['sendText']),
				options: [
					{
						displayName: 'Link Preview',
						name: 'previewUrl',
						type: 'boolean',
						default: false,
						description: 'Whether to show a preview of the first link in the text',
					},
					replyToMessageIdOption,
				],
			},
			{
				displayName: 'Media Type',
				name: 'mediaType',
				type: 'options',
				options: [
					{
						name: 'Audio',
						value: 'audio',
						description: 'AAC, AMR, MP3, M4A or OGG (Opus), up to 16 MB',
					},
					{
						name: 'Document',
						value: 'document',
						description: 'PDF, Word, Excel, PowerPoint or TXT, up to 100 MB',
					},
					{ name: 'Image', value: 'image', description: 'JPEG or PNG, up to 5 MB' },
					{ name: 'Video', value: 'video', description: 'MP4 or 3GP (H.264 and AAC), up to 16 MB' },
				],
				default: 'image',
				displayOptions: showFor(['sendMedia']),
			},
			{
				displayName: 'Media Source',
				name: 'mediaSource',
				type: 'options',
				options: [
					{
						name: 'Media ID',
						value: 'id',
						description: 'The ID of media already uploaded to WhatsApp',
					},
					{ name: 'URL', value: 'link', description: 'A public link that starts with https://' },
				],
				default: 'link',
				displayOptions: showFor(['sendMedia']),
			},
			{
				displayName: 'Media URL',
				name: 'mediaUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. https://example.com/photo.jpg',
				description: 'A public HTTPS link to the file. WhatsApp downloads it from there.',
				displayOptions: showFor(['sendMedia'], { mediaSource: ['link'] }),
			},
			{
				displayName: 'Media ID',
				name: 'mediaId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 1234567890123456',
				description: 'The ID of media already uploaded to WhatsApp',
				displayOptions: showFor(['sendMedia'], { mediaSource: ['id'] }),
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'Text shown under the media, up to 1024 characters',
				displayOptions: showFor(['sendMedia'], { mediaType: ['document', 'image', 'video'] }),
			},
			{
				displayName: 'File Name',
				name: 'filename',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice-march.pdf',
				description:
					'The file name the user sees. Include the extension so WhatsApp shows the right icon.',
				displayOptions: showFor(['sendMedia'], { mediaType: ['document'] }),
			},
			{
				displayName: 'Options',
				name: 'mediaOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: showFor(['sendMedia']),
				options: [replyToMessageIdOption],
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['phoneNumberId'] },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				hint: 'Only approved templates are listed. In an expression, use name|language_code, for example hello_world|en_US.',
				displayOptions: showFor(['sendTemplate']),
			},
			{
				displayName: 'Body Parameters',
				name: 'bodyParameters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				placeholder: 'Add parameter',
				default: {},
				description: 'Values for the variables in the template body',
				displayOptions: showFor(['sendTemplate']),
				options: [
					{
						name: 'parameter',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. first_name',
								description:
									'Only for named variables like {{first_name}}. Leave empty for numbered variables like {{1}}, then the order counts.',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'The text that replaces the variable',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'templateOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: showFor(['sendTemplate']),
				options: [
					{
						displayName: 'Components (JSON)',
						name: 'componentsJson',
						type: 'json',
						default: '',
						description:
							"Advanced: the full components array from Meta's template documentation, for header media and buttons. Replaces Body Parameters when set.",
					},
				],
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. wamid.HBgMMzU4...',
				description:
					'The ID of the received message to mark as read, for example from the AutomiQ for WhatsApp Trigger',
				displayOptions: showFor(['markAsRead']),
			},
			{
				displayName: 'Show Typing Indicator',
				name: 'showTypingIndicator',
				type: 'boolean',
				default: false,
				description:
					'Whether to also show "typing..." to the user. WhatsApp hides it when you reply, or after 25 seconds. Only use it when a reply follows.',
				displayOptions: showFor(['markAsRead']),
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

			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const phoneNumberId = this.getCurrentNodeParameter('phoneNumberId') as string | undefined;
				if (!phoneNumberId) return [];
				return await listApprovedTemplates.call(this, phoneNumberId);
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
				const phoneNumberId = getPhoneNumberId.call(this, i);
				const body = buildRequestBody.call(this, resource, operation, i);

				const response = await automiqApiRequest.call(
					this,
					'POST',
					`/api/gateway/whatsapp/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
					body as IDataObject,
					i,
				);
				returnData.push({ json: response, pairedItem: { item: i } });
			} catch (error) {
				const nodeError = toNodeError(this.getNode(), error, i);
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: nodeError.message,
							...(nodeError.description ? { description: nodeError.description } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw nodeError;
			}
		}

		return [returnData];
	}
}
