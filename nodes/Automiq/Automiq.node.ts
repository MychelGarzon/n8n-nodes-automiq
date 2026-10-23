import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class Automiq implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AutomiQ for WhatsApp',
		name: 'automiq',
		icon: { light: 'file:../icons/automiq.svg', dark: 'file:../icons/automiq.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: 'Under development',
		description: 'Send WhatsApp messages through the AutomiQ Gateway (official WhatsApp Cloud API)',
		defaults: {
			name: 'AutomiQ for WhatsApp',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName:
					'This node is under development. Message operations arrive in the next release.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return [this.getInputData()];
	}
}
