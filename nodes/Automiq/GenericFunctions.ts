import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { AUTOMIQ_BASE_URL } from '../../credentials/AutomiqApi.credentials';
import { describeApiError } from './helpers';

export const GRAPH_VERSION = 'v21.0';

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
	status: string;
	category?: string;
}

const MAX_TEMPLATE_PAGES = 10;

/** Approved templates of the WABA that owns this phone number, as dropdown options. */
export async function listApprovedTemplates(
	this: ILoadOptionsFunctions,
	phoneNumberId: string,
): Promise<Array<{ name: string; value: string; description?: string }>> {
	const numbers = (await automiqApiRequest.call(this, 'GET', '/api/gateway/numbers')) as {
		data?: Array<{ phone_number_id: string; waba_id: string }>;
	};
	const wabaId = numbers.data?.find((n) => n.phone_number_id === phoneNumberId)?.waba_id;
	if (!wabaId) return [];

	const rows: TemplateRow[] = [];
	let after: string | undefined;
	// Pages are fetched one after another: each request needs the cursor from the previous answer.
	for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
		const query = `fields=name,language,status,category&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
		const response = (await automiqApiRequest.call(
			this,
			'GET',
			`/api/gateway/whatsapp/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates?${query}`,
		)) as { data?: TemplateRow[]; paging?: { cursors?: { after?: string }; next?: string } };
		rows.push(...(response.data ?? []));
		after = response.paging?.next ? response.paging.cursors?.after : undefined;
		if (!after) break;
	}

	return rows
		.filter((t) => t.status === 'APPROVED')
		.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
		.map((t) => ({
			name: `${t.name} (${t.language})`,
			value: `${t.name}|${t.language}`,
			...(t.category ? { description: t.category.toLowerCase() } : {}),
		}));
}
