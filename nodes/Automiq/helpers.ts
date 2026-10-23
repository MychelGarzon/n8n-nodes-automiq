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

/** Digits only, international format, no leading + or 00. */
export function normalizeRecipient(raw: string): string {
	const digits = String(raw)
		.trim()
		.replace(/[\s\-().]/g, '')
		.replace(/^\+/, '')
		.replace(/^00/, '');
	if (!/^\d{6,15}$/.test(digits)) {
		throw new Error(
			`"${raw}" is not a valid phone number. Use international format with the country code, for example 358401234567.`,
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
	const replyTo = input.replyToMessageId?.trim();

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

/** Turns a gateway or Meta error body into a clear message. Returns undefined for unknown shapes. */
export function describeApiError(httpCode: number | undefined, data: unknown): ApiErrorText | undefined {
	const err = (data as ErrorBody | undefined)?.error;
	if (!err) return undefined;

	if (err.type === 'AutomiQGatewayError') {
		const status = httpCode ?? err.code;
		const gatewayMessage = err.message ?? '';
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
		return { message: 'AutomiQ Gateway error', description: gatewayMessage };
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
