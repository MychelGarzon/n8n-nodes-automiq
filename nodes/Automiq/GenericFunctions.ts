import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INode,
	INodeProperties,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';

import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { AUTOMIQ_BASE_URL } from '../../credentials/AutomiqApi.credentials';
import { describeApiError } from './helpers';

export const GRAPH_VERSION = 'v21.0';

export function operationProperty(
	resource: string,
	options: INodePropertyOptions[],
	defaultValue: string,
): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options,
		default: defaultValue,
	};
}

/** Every call to the AutomiQ Gateway goes through here. The credential adds X-API-Key. */
export async function automiqApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	itemIndex?: number,
): Promise<IDataObject> {
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'automiqApi', {
			method,
			url: `${AUTOMIQ_BASE_URL}${path}`,
			json: true,
			...(body ? { body } : {}),
		})) as IDataObject;
	} catch (error) {
		const original = error as NodeApiError;
		const data = (original.context?.data ?? {}) as JsonObject;
		const httpCode = Number(original.httpCode) || undefined;
		const described = describeApiError(httpCode, data);

		if (described) {
			throw new NodeApiError(this.getNode(), data, {
				message: described.message,
				description: described.description,
				httpCode: original.httpCode ?? undefined,
				itemIndex,
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}

/** Returns n8n node errors unchanged, wraps anything else, and always records the item. */
export function toNodeError(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}

interface TemplateRow {
	name: string;
	language: string;
	status?: string;
	category?: string;
}

/** Approved templates of this phone number, as dropdown options. The gateway lists them. */
export async function listApprovedTemplates(
	this: ILoadOptionsFunctions,
	phoneNumberId: string,
): Promise<Array<{ name: string; value: string; description?: string }>> {
	const response = (await automiqApiRequest.call(
		this,
		'GET',
		`/api/gateway/templates?number_id=${encodeURIComponent(phoneNumberId)}`,
	)) as { data?: TemplateRow[]; truncated?: boolean };

	const note = response.truncated
		? 'The list is incomplete. For other templates, use an expression: name|language_code'
		: undefined;

	return (response.data ?? [])
		.filter((t) => t.status === 'APPROVED')
		.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
		.map((t) => {
			const description = [t.category?.toLowerCase(), note].filter(Boolean).join('. ');
			return {
				name: `${t.name} (${t.language})`,
				value: `${t.name}|${t.language}`,
				...(description ? { description } : {}),
			};
		});
}
