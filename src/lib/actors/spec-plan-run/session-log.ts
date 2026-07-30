/**
 * Pi session-event → log-line normalizer.
 *
 * Free of agentOS imports so it stays unit-testable. Redacts credential-
 * shaped substrings before anything reaches the browser log pane.
 */

import { redactSecrets } from '../../security/redact-secrets.ts';

export function sessionEventLogLine(event: unknown): string | null {
	if (!event || typeof event !== 'object') return null;
	const e = event as Record<string, unknown>;
	const type = typeof e.type === 'string' ? e.type : '';

	if (type === 'agent_message_chunk' || type === 'agent_thought_chunk') {
		const text = extractChunkText(e);
		if (!text) return null;
		const prefix = type === 'agent_thought_chunk' ? '… ' : '';
		return redactSecrets(`${prefix}${text}`).slice(0, 400);
	}

	if (type.includes('tool_call')) {
		const title =
			pickString(e, 'title') ||
			pickString(e, 'name') ||
			pickNestedString(e, 'toolCall', 'title') ||
			pickNestedString(e, 'toolCall', 'name') ||
			type;
		return redactSecrets(`tool: ${title}`).slice(0, 200);
	}

	if (type === 'permission_request') return 'tool: permission requested';
	return null;
}

function extractChunkText(e: Record<string, unknown>): string {
	const direct = pickString(e, 'text') || pickString(e, 'delta') || pickString(e, 'content');
	if (direct) return direct;
	const content = e.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === 'string') parts.push(block);
			else if (block && typeof block === 'object') {
				const b = block as Record<string, unknown>;
				const t = pickString(b, 'text') || pickString(b, 'delta');
				if (t) parts.push(t);
			}
		}
		return parts.join('');
	}
	if (content && typeof content === 'object') {
		const c = content as Record<string, unknown>;
		return pickString(c, 'text') || pickString(c, 'delta') || '';
	}
	return '';
}

function pickString(obj: Record<string, unknown>, key: string): string {
	const v = obj[key];
	return typeof v === 'string' ? v : '';
}

function pickNestedString(obj: Record<string, unknown>, a: string, b: string): string {
	const nested = obj[a];
	if (!nested || typeof nested !== 'object') return '';
	return pickString(nested as Record<string, unknown>, b);
}
