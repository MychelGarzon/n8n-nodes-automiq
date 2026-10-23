import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export const AUTOMIQ_BASE_URL = 'https://www.automiq.fi';

export class AutomiqApi implements ICredentialType {
	name = 'automiqApi';

	displayName = 'AutomiQ API';

	documentationUrl = 'https://github.com/MychelGarzon/n8n-nodes-automiq?tab=readme-ov-file#credentials';

	icon = {
		light: 'file:../nodes/icons/automiq.svg',
		dark: 'file:../nodes/icons/automiq.dark.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'e.g. amq_live_...',
			description: 'Your AutomiQ API key. Create one in the AutomiQ portal under API keys.',
		},
		{
			displayName: 'Webhook Secret',
			name: 'webhookSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Only needed for the AutomiQ for WhatsApp Trigger. Find it in the AutomiQ portal on the Webhook page. Used to verify that incoming events really come from AutomiQ.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Lists the client's active numbers: cheap, authenticated, and needs no IDs.
	test: ICredentialTestRequest = {
		request: {
			baseURL: AUTOMIQ_BASE_URL,
			url: '/api/gateway/numbers',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Invalid or revoked AutomiQ API key. Create a new key in the AutomiQ portal under API keys.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'This AutomiQ account is suspended. Contact AutomiQ support.',
				},
			},
		],
	};
}
