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
		createHmac('sha256', input.secret)
			.update(`${timestamp}.`, 'utf8')
			.update(input.rawBody)
			.digest('hex');
	const a = Buffer.from(signature, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length || !timingSafeEqual(a, b))
		return { valid: false, reason: 'bad_signature' };

	return { valid: true };
}

export function isPing(payload: unknown): boolean {
	const p = payload as { object?: string; type?: string } | null;
	return p?.object === 'automiq' && p?.type === 'ping';
}

export type EventKind = 'messages' | 'statuses' | 'other';
export type FlatEvent = Record<string, unknown> & { event: string };

interface WebhookChange {
	field?: string;
	value?: Record<string, unknown>;
}

interface WebhookPayload {
	entry?: Array<{ id?: string; changes?: WebhookChange[] }>;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {});
const asArray = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : []);

const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];
const MEDIA_FIELDS = {
	id: 'media_id',
	mime_type: 'mime_type',
	caption: 'caption',
	filename: 'filename',
};
const LOCATION_FIELDS = {
	latitude: 'latitude',
	longitude: 'longitude',
	name: 'location_name',
	address: 'address',
};
const REACTION_FIELDS = { emoji: 'emoji', message_id: 'reacted_message_id' };

/** Copies each listed key from source to target under its new name, only when it is defined. */
function copyDefined(target: Dict, source: Dict, keys: Record<string, string>): void {
	for (const [from, to] of Object.entries(keys)) {
		if (source[from] !== undefined) target[to] = source[from];
	}
}

/** The timestamp as a number, or nothing when it is missing or not numeric. */
function timestampField(value: unknown): Dict {
	if (typeof value !== 'string' && typeof value !== 'number') return {};
	if (value === '') return {};
	const n = Number(value);
	return Number.isFinite(n) ? { timestamp: n } : {};
}

/** The readable parts of one incoming message. Optional keys are left out, not undefined. */
function messageFields(m: Dict): Dict {
	const type = String(m.type ?? '');
	const content = asDict(m[type]);
	const out: Dict = {};

	if (type === 'text') out.text = asDict(m.text).body;
	if (type === 'button') out.text = asDict(m.button).text;
	if (type === 'interactive') {
		const i = asDict(m.interactive);
		copyDefined(out, asDict(i.button_reply ?? i.list_reply), { title: 'text', id: 'reply_id' });
	}
	if (MEDIA_MESSAGE_TYPES.includes(type)) copyDefined(out, content, MEDIA_FIELDS);
	if (type === 'location') copyDefined(out, content, LOCATION_FIELDS);
	if (type === 'reaction') copyDefined(out, content, REACTION_FIELDS);
	if (Array.isArray(m.errors)) out.errors = m.errors;
	copyDefined(out, asDict(m.context), { id: 'reply_to_message_id' });
	return out;
}

/** Which number and account the change belongs to. */
function whereFields(entryId: string | undefined, value: Dict): Dict {
	const where: Dict = {};
	copyDefined(where, asDict(value.metadata), {
		phone_number_id: 'phone_number_id',
		display_phone_number: 'display_phone_number',
	});
	if (entryId !== undefined) where.waba_id = entryId;
	return where;
}

function contactNames(value: Dict): Map<string, string> {
	const names = new Map<string, string>();
	for (const c of asArray(value.contacts)) {
		const name = asDict(c.profile).name;
		if (typeof c.wa_id === 'string' && typeof name === 'string') names.set(c.wa_id, name);
	}
	return names;
}

function messageEvents(value: Dict, where: Dict): FlatEvent[] {
	const names = contactNames(value);
	return asArray(value.messages).map((m) => {
		const from = m.from as string | undefined;
		return {
			event: 'message',
			message_id: m.id,
			...(from !== undefined ? { from } : {}),
			...(m.from_user_id !== undefined ? { from_user_id: m.from_user_id } : {}),
			...(from && names.has(from) ? { name: names.get(from) } : {}),
			type: m.type,
			...timestampField(m.timestamp),
			...messageFields(m),
			...where,
			raw: m,
		};
	});
}

function statusEvents(value: Dict, where: Dict): FlatEvent[] {
	return asArray(value.statuses).map((s) => ({
		event: 'status',
		message_id: s.id,
		status: s.status,
		...(s.recipient_id !== undefined ? { recipient_id: s.recipient_id } : {}),
		...(s.recipient_user_id !== undefined ? { recipient_user_id: s.recipient_user_id } : {}),
		...timestampField(s.timestamp),
		...(Array.isArray(s.errors) ? { errors: s.errors } : {}),
		...where,
		raw: s,
	}));
}

/** Messages and statuses in the same change are both kept. Anything else is an "other" event. */
function changeEvents(
	change: WebhookChange,
	entryId: string | undefined,
	kinds: EventKind[],
): FlatEvent[] {
	const value = asDict(change.value);
	const where = whereFields(entryId, value);
	const hasMessages = asArray(value.messages).length > 0;
	const hasStatuses = asArray(value.statuses).length > 0;

	if (change.field !== 'messages' || (!hasMessages && !hasStatuses)) {
		return kinds.includes('other')
			? [{ event: 'other', field: change.field, ...where, raw: value }]
			: [];
	}
	return [
		...(kinds.includes('messages') ? messageEvents(value, where) : []),
		...(kinds.includes('statuses') ? statusEvents(value, where) : []),
	];
}

/** One item per message, status or other change. Each item also keeps Meta's original object in "raw". */
export function flattenEvents(payload: unknown, kinds: EventKind[]): FlatEvent[] {
	const out: FlatEvent[] = [];
	for (const entry of (payload as WebhookPayload)?.entry ?? []) {
		for (const change of entry.changes ?? []) {
			out.push(...changeEvents(change, entry.id, kinds));
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
export function filterNewEvents(
	events: FlatEvent[],
	seen: string[],
): { fresh: FlatEvent[]; seen: string[] } {
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
