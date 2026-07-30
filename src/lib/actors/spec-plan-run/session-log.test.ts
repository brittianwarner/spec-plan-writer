import { describe, expect, it } from 'vitest';
import { sessionEventLogLine } from './session-log.ts';

describe('sessionEventLogLine', () => {
	it('renders an agent message chunk from flat text', () => {
		expect(sessionEventLogLine({ type: 'agent_message_chunk', text: 'writing requirements' })).toBe(
			'writing requirements'
		);
	});

	it('prefixes thought chunks so reasoning reads differently in the pane', () => {
		expect(sessionEventLogLine({ type: 'agent_thought_chunk', text: 'checking auth.ts' })).toBe(
			'… checking auth.ts'
		);
	});

	it('flattens ACP content-block arrays', () => {
		const line = sessionEventLogLine({
			type: 'agent_message_chunk',
			content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }]
		});
		expect(line).toBe('part one part two');
	});

	it('reads a nested content object', () => {
		expect(
			sessionEventLogLine({ type: 'agent_message_chunk', content: { type: 'text', text: 'hi' } })
		).toBe('hi');
	});

	it('labels tool calls by title, name, then nested toolCall', () => {
		expect(sessionEventLogLine({ type: 'tool_call', title: 'read_file' })).toBe('tool: read_file');
		expect(sessionEventLogLine({ type: 'tool_call_update', name: 'bash' })).toBe('tool: bash');
		expect(
			sessionEventLogLine({ type: 'tool_call_start', toolCall: { title: 'write_file' } })
		).toBe('tool: write_file');
	});

	it('surfaces permission requests', () => {
		expect(sessionEventLogLine({ type: 'permission_request', requestId: 'r1' })).toBe(
			'tool: permission requested'
		);
	});

	it('drops empty chunks and unknown shapes instead of logging noise', () => {
		expect(sessionEventLogLine({ type: 'agent_message_chunk', text: '' })).toBeNull();
		expect(sessionEventLogLine({ type: 'session_configured' })).toBeNull();
		expect(sessionEventLogLine(null)).toBeNull();
		expect(sessionEventLogLine('nope')).toBeNull();
		expect(sessionEventLogLine({})).toBeNull();
	});

	it('redacts credential-shaped substrings before they hit the pane', () => {
		expect(
			sessionEventLogLine({
				type: 'agent_message_chunk',
				text: 'remote is https://x-access-token:gho_SECRETtoken@github.com/a/b.git'
			})
		).toContain('[redacted]');
		expect(
			sessionEventLogLine({
				type: 'agent_message_chunk',
				text: 'key=sk-or-v1-abcdefghijklmnopqrstuvwxyz'
			})
		).toContain('[redacted]');
	});

	it('caps line length so one runaway chunk cannot flood actor state', () => {
		const long = sessionEventLogLine({ type: 'agent_message_chunk', text: 'x'.repeat(2_000) });
		expect(long).toHaveLength(400);
	});
});

