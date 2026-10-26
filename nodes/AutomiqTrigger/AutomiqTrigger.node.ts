import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { EventKind } from './webhookHelpers';
import { filterNewEvents, flattenEvents, isPing, verifyAutomiqSignature } from './webhookHelpers';

export class AutomiqTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AutomiQ for WhatsApp Trigger',
		name: 'automiqTrigger',
		icon: { light: 'file:../icons/automiq.svg', dark: 'file:../icons/automiq.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when a WhatsApp message or status arrives through the AutomiQ Gateway',
		defaults: {
			name: 'AutomiQ for WhatsApp Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'automiqApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: 'noData',
				path: 'webhook',
			},
		],
		eventTriggerDescription: 'Waiting for a WhatsApp message to your AutomiQ number',
		activationMessage: 'Incoming WhatsApp messages will now start this workflow.',
		properties: [
			{
				displayName:
					'Copy the Production URL above into the AutomiQ portal on the Webhook page. Put the Webhook Secret from that page into the AutomiQ API credential. Every delivery is checked against it.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{ name: 'Messages', value: 'messages', description: 'Messages your customers send' },
					{
						name: 'Other Events',
						value: 'other',
						description: 'Other WhatsApp changes, such as template status updates',
					},
					{
						name: 'Statuses',
						value: 'statuses',
						description: 'Sent, delivered, read and failed updates for messages you sent',
					},
				],
				default: ['messages'],
				required: true,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Ignore Duplicates',
						name: 'ignoreDuplicates',
						type: 'boolean',
						default: false,
						description:
							'Whether to skip messages and statuses that already started this workflow. Only works when the workflow is active.',
					},
					{
						displayName: 'Include Portal Pings',
						name: 'includePings',
						type: 'boolean',
						default: false,
						description:
							'Whether to start the workflow for test deliveries sent from the AutomiQ portal',
					},
					{
						displayName: 'Raw Payload',
						name: 'rawPayload',
						type: 'boolean',
						default: false,
						description:
							'Whether to output the full delivery as one item instead of one item per message or status',
					},
				],
			},
		],
	};

	// AutomiQ has one webhook URL per client, set by hand in the AutomiQ portal (Webhook page).
	// The gateway has no API to change it, on purpose: a key that could change it could redirect
	// every incoming message. So activation and deactivation have nothing to register here.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const credentials = await this.getCredentials('automiqApi');
		const secret = String(credentials.webhookSecret ?? '').trim();
		if (!secret) {
			const res = this.getResponseObject();
			res.status(401).json({ error: 'invalid_signature', reason: 'secret_not_configured' }).end();
			return { noWebhookResponse: true };
		}

		const req = this.getRequestObject();
		const headers = this.getHeaderData() as IDataObject;
		const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

		const check = rawBody
			? verifyAutomiqSignature({
					secret,
					timestamp: headers['x-automiq-timestamp'] as string | undefined,
					signature: headers['x-automiq-signature'] as string | undefined,
					rawBody,
					nowSeconds: Math.floor(Date.now() / 1000),
				})
			: ({ valid: false, reason: 'raw_body_missing' } as const);

		if (!check.valid) {
			const res = this.getResponseObject();
			res.status(401).json({ error: 'invalid_signature', reason: check.reason }).end();
			return { noWebhookResponse: true };
		}

		let payload: IDataObject;
		try {
			payload = JSON.parse((rawBody as Buffer).toString('utf8')) as IDataObject;
		} catch {
			payload = {};
		}

		const options = this.getNodeParameter('options', {}) as IDataObject;

		if (isPing(payload)) {
			if (!options.includePings) return { webhookResponse: 'OK' };
			return { workflowData: [this.helpers.returnJsonArray([{ event: 'ping', ...payload }])] };
		}

		if (options.rawPayload) {
			return { workflowData: [this.helpers.returnJsonArray([payload])] };
		}

		const kinds = this.getNodeParameter('events', []) as EventKind[];
		let events = flattenEvents(payload, kinds);

		if (options.ignoreDuplicates && events.length > 0) {
			const staticData = this.getWorkflowStaticData('node');
			const result = filterNewEvents(events, (staticData.seenKeys as string[] | undefined) ?? []);
			staticData.seenKeys = result.seen;
			events = result.fresh;
		}

		if (events.length === 0) return { webhookResponse: 'OK' };

		return { workflowData: [this.helpers.returnJsonArray(events as IDataObject[])] };
	}
}
