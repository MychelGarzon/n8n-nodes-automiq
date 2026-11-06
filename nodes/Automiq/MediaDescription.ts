import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { AUTOMIQ_BASE_URL } from '../../credentials/AutomiqApi.credentials';

/** Set to false to hide Download Media from the node. */
export const DOWNLOAD_MEDIA_ENABLED = true;

export const downloadMediaOperation: INodePropertyOptions = {
	name: 'Download Media',
	value: 'downloadMedia',
	action: 'Download received media',
	description: 'Download an image, document, audio or video that a customer sent, up to 4 MB',
};

export const downloadMediaFields: INodeProperties[] = [
	{
		displayName: 'Phone Number Name or ID',
		name: 'mediaNumberId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getPhoneNumbers' },
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'The number that received the media',
		displayOptions: { show: { resource: ['message'], operation: ['downloadMedia'] } },
	},
	{
		displayName: 'Media ID',
		name: 'downloadMediaId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 2662315310887503',
		description:
			'The ID of the media in the received message, for example the ID inside the image, audio, document or video object from the AutomiQ for WhatsApp Trigger',
		displayOptions: { show: { resource: ['message'], operation: ['downloadMedia'] } },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: { show: { resource: ['message'], operation: ['downloadMedia'] } },
	},
];

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'audio/ogg': 'ogg',
	'audio/mpeg': 'mp3',
	'audio/aac': 'aac',
	'video/mp4': 'mp4',
	'application/pdf': 'pdf',
};

function asText(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export async function executeDownloadMedia(
	this: IExecuteFunctions,
	i: number,
): Promise<INodeExecutionData[]> {
	const numberId = asText(this.getNodeParameter('mediaNumberId', i));
	const mediaId = asText(this.getNodeParameter('downloadMediaId', i));
	const field = asText(this.getNodeParameter('binaryPropertyName', i)) || 'data';

	if (!numberId) {
		throw new NodeOperationError(this.getNode(), 'Choose a Phone Number', { itemIndex: i });
	}
	if (!/^\d+$/.test(mediaId)) {
		throw new NodeOperationError(this.getNode(), 'Media ID must contain digits only', {
			itemIndex: i,
			description:
				'Use the ID inside the image, audio, document or video object, not the message ID that starts with wamid.',
		});
	}

	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'automiqApi', {
		method: 'GET',
		url: `${AUTOMIQ_BASE_URL}/api/gateway/media/${mediaId}?number_id=${encodeURIComponent(numberId)}`,
		encoding: 'arraybuffer',
		json: false,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	});

	const status = Number(response.statusCode);
	const buffer = Buffer.from(response.body as ArrayBuffer);

	if (status === 413) {
		throw new NodeOperationError(this.getNode(), 'The media is larger than 4 MB', {
			itemIndex: i,
			description: 'The gateway supports media up to 4 MB. Larger files cannot be downloaded yet.',
		});
	}
	if (status === 404) {
		throw new NodeOperationError(this.getNode(), 'Media not found', {
			itemIndex: i,
			description: 'The media ID may be wrong, too old, or belong to another number.',
		});
	}
	if (status >= 400) {
		let body: JsonObject = {};
		try {
			body = JSON.parse(buffer.toString('utf8')) as JsonObject;
		} catch {
			// The error body was not JSON: the status code alone is reported.
		}
		throw new NodeApiError(this.getNode(), body, { httpCode: String(status), itemIndex: i });
	}

	const headers = (response.headers ?? {}) as Record<string, string | undefined>;
	const mimeType = headers['content-type']?.split(';')[0].trim() || 'application/octet-stream';
	const extension = EXTENSIONS[mimeType];
	const fileName = `media-${mediaId}${extension ? `.${extension}` : ''}`;
	const binary = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);

	return [
		{
			json: { media_id: mediaId, mime_type: mimeType, file_size: buffer.length },
			binary: { [field]: binary },
			pairedItem: { item: i },
		},
	];
}
