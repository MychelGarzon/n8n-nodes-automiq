import { createHmac, timingSafeEqual } from 'crypto';

export const MAX_TIMESTAMP_SKEW_SECONDS = 300;

export type SignatureCheck = { valid: true } | { valid: false; reason: string };

/**
 * Checks x-automiq-signature: "sha256=" + hex HMAC-SHA256 of "{timestamp}.{raw body}" with the
 * webhook secret, and rejects timestamps more than 5 minutes off. Always over the raw bytes.
 */
export function verifyAutomiqSignature(input: {
	secret: string;
	timestamp: string | undefined;
	signature: string | undefined;
	rawBody: Buffer;
	nowSeconds: number;
	maxSkewSeconds?: number;
}): SignatureCheck {
	const maxSkew = input.maxSkewSeconds ?? MAX_TIMESTAMP_SKEW_SECONDS;
	const timestamp = String(input.timestamp ?? '');
	const signature = String(input.signature ?? '');

	if (!/^\d{9,11}$/.test(timestamp)) return { valid: false, reason: 'missing_or_bad_timestamp' };
	if (Math.abs(input.nowSeconds - Number(timestamp)) > maxSkew) {
		return { valid: false, reason: 'stale_timestamp' };
	}
	if (!signature.startsWith('sha256=')) return { valid: false, reason: 'missing_signature' };

	const expected =
		'sha256=' +
		createHmac('sha256', input.secret).update(`${timestamp}.`, 'utf8').update(input.rawBody).digest('hex');
	const a = Buffer.from(signature, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };

	return { valid: true };
}

export function isPing(payload: unknown): boolean {
	const p = payload as { object?: string; type?: string } | null;
	return p?.object === 'automiq' && p?.type === 'ping';
}

export type EventKind = 'messages' | 'statuses' | 'other';
export type FlatEvent = Record<string, unknown> & { event: string };

interface WebhookPayload {
	entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {});

/** The readable parts of one incoming message. Optional keys are left out, not undefined. */
function messageFields(m: Dict): Dict {
	const type = String(m.type ?? '');
	const content = asDict(m[type]);
	const out: Dict = {};

	if (type === 'text') out.text = asDict(m.text).body;
	if (type === 'button') out.text = asDict(m.button).text;
	if (type === 'interactive') {
		const i = asDict(m.interactive);
		const reply = asDict(i.button_reply ?? i.list_reply);
		if (reply.title !== undefined) out.text = reply.title;
		if (reply.id !== undefined) out.reply_id = reply.id;
	}
	if (['image', 'document', 'audio', 'video', 'sticker'].includes(type)) {
		if (content.id !== undefined) out.media_id = content.id;
		if (content.mime_type !== undefined) out.mime_type = content.mime_type;
		if (content.caption !== undefined) out.caption = content.caption;
		if (content.filename !== undefined) out.filename = content.filename;
	}
	if (type === 'location') {
		for (const key of ['latitude', 'longitude', 'name', 'address']) {
			if (content[key] !== undefined) out[key === 'name' ? 'location_name' : key] = content[key];
		}
	}
	if (type === 'reaction') {
		if (content.emoji !== undefined) out.emoji = content.emoji;
		if (content.message_id !== undefined) out.reacted_message_id = content.message_id;
	}
	const context = asDict(m.context);
	if (context.id !== undefined) out.reply_to_message_id = context.id;
	return out;
}

/** One item per message, status or other change. Each item also keeps Meta's original object in "raw". */
export function flattenEvents(payload: unknown, kinds: EventKind[]): FlatEvent[] {
	const out: FlatEvent[] = [];
	for (const entry of (payload as WebhookPayload)?.entry ?? []) {
		for (const change of entry.changes ?? []) {
			const value = asDict(change.value);
			const metadata = asDict(value.metadata);
			const where: Dict = {
				...(metadata.phone_number_id !== undefined ? { phone_number_id: metadata.phone_number_id } : {}),
				...(metadata.display_phone_number !== undefined
					? { display_phone_number: metadata.display_phone_number }
					: {}),
				...(entry.id !== undefined ? { waba_id: entry.id } : {}),
			};

			const messages = Array.isArray(value.messages) ? (value.messages as Dict[]) : [];
			const statuses = Array.isArray(value.statuses) ? (value.statuses as Dict[]) : [];

			if (change.field === 'messages' && messages.length > 0) {
				if (!kinds.includes('messages')) continue;
				const names = new Map<string, string>();
				for (const c of Array.isArray(value.contacts) ? (value.contacts as Dict[]) : []) {
					const name = asDict(c.profile).name;
					if (typeof c.wa_id === 'string' && typeof name === 'string') names.set(c.wa_id, name);
				}
				for (const m of messages) {
					const from = m.from as string | undefined;
					out.push({
						event: 'message',
						message_id: m.id,
						...(from !== undefined ? { from } : {}),
						...(m.from_user_id !== undefined ? { from_user_id: m.from_user_id } : {}),
						...(from && names.has(from) ? { name: names.get(from) } : {}),
						type: m.type,
						timestamp: Number(m.timestamp),
						...messageFields(m),
						...where,
						raw: m,
					});
				}
			} else if (change.field === 'messages' && statuses.length > 0) {
				if (!kinds.includes('statuses')) continue;
				for (const s of statuses) {
					out.push({
						event: 'status',
						message_id: s.id,
						status: s.status,
						...(s.recipient_id !== undefined ? { recipient_id: s.recipient_id } : {}),
						...(s.recipient_user_id !== undefined ? { recipient_user_id: s.recipient_user_id } : {}),
						timestamp: Number(s.timestamp),
						...(Array.isArray(s.errors) ? { errors: s.errors } : {}),
						...where,
						raw: s,
					});
				}
			} else {
				if (!kinds.includes('other')) continue;
				out.push({ event: 'other', field: change.field, ...where, raw: value });
			}
		}
	}
	return out;
}

const MAX_SEEN_KEYS = 1000;

/** The key used to recognise the same delivery again. Other events are never deduplicated. */
export function dedupeKey(event: FlatEvent): string | undefined {
	if (event.event === 'message') return `m:${String(event.message_id)}`;
	if (event.event === 'status') return `s:${String(event.message_id)}:${String(event.status)}`;
	return undefined;
}

/** Drops events seen before and returns the updated list of seen keys (newest last, capped). */
export function filterNewEvents(events: FlatEvent[], seen: string[]): { fresh: FlatEvent[]; seen: string[] } {
	const known = new Set(seen);
	const fresh: FlatEvent[] = [];
	const updated = [...seen];
	for (const e of events) {
		const key = dedupeKey(e);
		if (key && known.has(key)) continue;
		if (key) {
			known.add(key);
			updated.push(key);
		}
		fresh.push(e);
	}
	return { fresh, seen: updated.slice(-MAX_SEEN_KEYS) };
}
