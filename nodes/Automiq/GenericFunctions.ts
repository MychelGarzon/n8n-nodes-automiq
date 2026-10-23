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
