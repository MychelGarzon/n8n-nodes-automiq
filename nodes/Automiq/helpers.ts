// Pure helpers with no n8n runtime dependency, so they are easy to unit test.

export interface TextMessageInput {
	to: string;
	text: string;
	previewUrl?: boolean;
	replyToMessageId?: string;
}

export interface ApiErrorText {
	message: string;
	description: string;
}

const MAX_TEXT_LENGTH = 4096;

function asText(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number') return String(value);
	return '';
}

/** Digits only, international format, no leading + or 00. */
export function normalizeRecipient(raw: string): string {
	const text = (raw as unknown) == null ? '' : String(raw).trim();
	if (!text || text === 'undefined' || text === 'null') {
		throw new Error(
			'The recipient phone number is empty. If it comes from an expression, check that the field exists in the incoming item, for example {{ $json.from }} exists on messages but not on statuses.',
		);
	}
	if (text.includes('{{')) {
		throw new Error(
			`"${text}" looks like an expression typed in Fixed mode. Click Expression on this field so n8n fills in the value.`,
		);
	}
	const digits = String(raw)
		.trim()
		.replace(/[\s\-().]/g, '')
		.replace(/^\+/, '')
		.replace(/^00/, '');
	if (!/^\d{6,15}$/.test(digits)) {
		throw new Error(
			`"${raw}" is not a valid phone number. Use international format with the country code, for example 16505551234.`,
		);
	}
	return digits;
}

/** The Meta Cloud API body for a text message. Optional keys are left out, not set to undefined. */
export function buildTextMessage(input: TextMessageInput): Record<string, unknown> {
	const text = String(input.text ?? '');
	if (!text.trim()) {
		throw new Error('The message text is empty.');
	}
	if (text.length > MAX_TEXT_LENGTH) {
		throw new Error(
			`The message text is ${text.length} characters long. WhatsApp allows up to ${MAX_TEXT_LENGTH}.`,
		);
	}
	const replyTo = asText(input.replyToMessageId);

	return {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to: normalizeRecipient(input.to),
		type: 'text',
		text: {
			body: text,
			...(input.previewUrl ? { preview_url: true } : {}),
		},
		...(replyTo ? { context: { message_id: replyTo } } : {}),
	};
}

// Meta Cloud API error codes with a plain explanation. Only codes confirmed in documentation.
const META_ERRORS: Record<number, ApiErrorText> = {
	131047: {
		message: 'Outside the 24-hour customer service window',
		description:
			'The recipient has not messaged this number in the last 24 hours, so WhatsApp only allows an approved template message.',
	},
	131026: {
		message: 'WhatsApp could not deliver the message',
		description:
			'The recipient may not have WhatsApp, or may not be able to receive messages from this number.',
	},
	130429: {
		message: 'WhatsApp rate limit reached',
		description:
			'This number sent too many messages per second. Turn on Retry On Fail in the node settings, or slow the workflow down.',
	},
};

interface ErrorBody {
	error?: {
		message?: string;
		type?: string;
		code?: number;
		error_data?: { details?: string };
	};
}

/** Clear messages for errors returned by the AutomiQ Gateway itself. */
function describeGatewayError(status: number | undefined, gatewayMessage: string): ApiErrorText {
	if (status === 401) {
		return {
			message: 'Invalid or revoked AutomiQ API key',
			description:
				'Create a new key in the AutomiQ portal under API keys and update the AutomiQ API credential.',
		};
	}
	if (status === 403 && /suspended/i.test(gatewayMessage)) {
		return {
			message: 'This AutomiQ account is suspended',
			description: 'Contact AutomiQ support.',
		};
	}
	if (status === 403 && /first path segment|not one of your active numbers/i.test(gatewayMessage)) {
		return {
			message: 'This phone number is not linked to your AutomiQ account',
			description: 'Pick a number from the Sender Phone Number list, or check the phone number ID.',
		};
	}
	if (status === 413) {
		return { message: 'The request is too large', description: gatewayMessage };
	}
	if (status === 502) {
		return {
			message: 'AutomiQ could not reach WhatsApp',
			description: 'This is usually temporary. Try again in a moment.',
		};
	}
	return { message: 'AutomiQ Gateway rejected the request', description: gatewayMessage };
}

/** The Meta Cloud API body that marks a received message as read, optionally with "typing...". */
export function buildMarkAsRead(
	messageId: string,
	showTypingIndicator = false,
): Record<string, unknown> {
	const id = String(messageId ?? '').trim();
	if (!id) {
		throw new Error(
			'The message ID is empty. Use the ID of a received message, for example from the AutomiQ for WhatsApp Trigger.',
		);
	}
	return {
		messaging_product: 'whatsapp',
		status: 'read',
		message_id: id,
		...(showTypingIndicator ? { typing_indicator: { type: 'text' } } : {}),
	};
}

export interface MediaMessageInput {
	to: string;
	mediaType: string;
	source: string;
	value: string;
	caption?: string;
	filename?: string;
	replyToMessageId?: string;
}

const MEDIA_TYPES = ['audio', 'document', 'image', 'video'];
const CAPTION_TYPES = ['document', 'image', 'video'];
const MAX_CAPTION_LENGTH = 1024;
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/** The Meta Cloud API body for an audio, document, image or video message. */
export function buildMediaMessage(input: MediaMessageInput): Record<string, unknown> {
	const mediaType = String(input.mediaType ?? '');
	if (!MEDIA_TYPES.includes(mediaType)) {
		throw new Error(`Unsupported media type "${mediaType}". Use audio, document, image or video.`);
	}

	const value = String(input.value ?? '').trim();
	const media: Record<string, unknown> = {};
	if (input.source === 'link') {
		if (!HTTPS_URL.test(value)) {
			throw new Error(
				`"${value}" is not a valid URL. Use a public link that starts with https://.`,
			);
		}
		media.link = value;
	} else if (input.source === 'id') {
		if (!/^\d+$/.test(value)) {
			throw new Error(
				`"${value}" is not a valid media ID. A WhatsApp media ID contains only digits.`,
			);
		}
		media.id = value;
	} else {
		throw new Error(`Unsupported media source "${input.source}". Use a URL or a media ID.`);
	}

	const caption = asText(input.caption);
	if (caption && CAPTION_TYPES.includes(mediaType)) {
		if (caption.length > MAX_CAPTION_LENGTH) {
			throw new Error(
				`The caption is ${caption.length} characters long. WhatsApp allows up to ${MAX_CAPTION_LENGTH}.`,
			);
		}
		media.caption = caption;
	}

	const filename = asText(input.filename);
	if (filename && mediaType === 'document') {
		media.filename = filename;
	}

	const replyTo = asText(input.replyToMessageId);

	return {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to: normalizeRecipient(input.to),
		type: mediaType,
		[mediaType]: media,
		...(replyTo ? { context: { message_id: replyTo } } : {}),
	};
}

// Template errors, confirmed in the Cloud API error list.
Object.assign(META_ERRORS, {
	132000: {
		message: 'The template parameters do not match the template',
		description:
			'The number of Body Parameters must match the number of variables in the template, for example {{1}} and {{2}}.',
	},
	132001: {
		message: 'This template does not exist or is not approved',
		description:
			'Check the template name and language, and that the template is approved in WhatsApp Manager.',
	},
});

export interface TemplateParameterInput {
	name?: string;
	value?: string;
}

export interface TemplateMessageInput {
	to: string;
	template: string;
	bodyParameters?: TemplateParameterInput[];
	componentsJson?: unknown;
}

/** Splits "name|language_code" as used by the Template dropdown and by n8n's built-in WhatsApp node. */
export function parseTemplateRef(value: string): { name: string; code: string } {
	const raw = String(value ?? '').trim();
	const separator = raw.lastIndexOf('|');
	const name = separator > 0 ? raw.slice(0, separator).trim() : '';
	const code = separator > 0 ? raw.slice(separator + 1).trim() : '';
	if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(code)) {
		throw new Error(
			`"${raw}" is not a valid template. Pick one from the list, or use name|language_code, for example hello_world|en_US.`,
		);
	}
	return { name, code };
}

function parseComponents(componentsJson: unknown): unknown[] | undefined {
	if (componentsJson === undefined || componentsJson === null) return undefined;
	if (typeof componentsJson === 'string' && !componentsJson.trim()) return undefined;

	let parsed: unknown = componentsJson;
	if (typeof componentsJson === 'string') {
		let valid = true;
		try {
			parsed = JSON.parse(componentsJson);
		} catch {
			valid = false;
		}
		if (!valid) throw new Error('Components (JSON) is not valid JSON.');
	}
	if (
		!Array.isArray(parsed) ||
		parsed.some((c) => typeof c !== 'object' || c === null || !('type' in c))
	) {
		throw new Error(
			'Components (JSON) must be an array of components, each with a "type", as in Meta\'s template documentation.',
		);
	}
	return parsed.length > 0 ? parsed : undefined;
}

function bodyComponent(parameters: TemplateParameterInput[]): unknown[] | undefined {
	if (parameters.length === 0) return undefined;

	const named = parameters.filter((p) => parameterName(p)).length;
	if (named > 0 && named < parameters.length) {
		throw new Error(
			'Use either named parameters (all with a Name) or numbered parameters (all without a Name), not both.',
		);
	}

	return [
		{
			type: 'body',
			parameters: parameters.map((p, index) => {
				const text = String(p.value ?? '');
				if (!text.trim()) {
					throw new Error(
						`Body parameter ${index + 1} is empty. WhatsApp does not accept empty values.`,
					);
				}
				const name = parameterName(p);
				return { type: 'text', ...(name ? { parameter_name: name } : {}), text };
			}),
		},
	];
}

function parameterName(p: TemplateParameterInput): string {
	const name = asText(p.name);
	return /^\d+$/.test(name) ? '' : name;
}

/** The Meta Cloud API body for a template message. Components (JSON) replaces Body Parameters when set. */
export function buildTemplateMessage(input: TemplateMessageInput): Record<string, unknown> {
	const { name, code } = parseTemplateRef(input.template);
	const components =
		parseComponents(input.componentsJson) ?? bodyComponent(input.bodyParameters ?? []);

	return {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to: normalizeRecipient(input.to),
		type: 'template',
		template: {
			name,
			language: { code },
			...(components ? { components } : {}),
		},
	};
}

/** Turns a gateway or Meta error body into a clear message. Returns undefined for unknown shapes. */
export function describeApiError(
	httpCode: number | undefined,
	data: unknown,
): ApiErrorText | undefined {
	const err = (data as ErrorBody | undefined)?.error;
	if (!err) return undefined;

	if (err.type === 'AutomiQGatewayError') {
		return describeGatewayError(httpCode ?? err.code, err.message ?? '');
	}

	if (typeof err.code === 'number') {
		const metaText = [err.message, err.error_data?.details].filter(Boolean).join(': ');
		const known = META_ERRORS[err.code];
		if (known) {
			return {
				message: known.message,
				description: `${known.description} WhatsApp said: ${metaText} (code ${err.code}).`,
			};
		}
		return {
			message: 'WhatsApp rejected the request',
			description: `${metaText} (code ${err.code}).`,
		};
	}

	return undefined;
}
