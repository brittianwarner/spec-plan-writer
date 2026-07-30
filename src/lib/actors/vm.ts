/**
 * Shared agentOS VM — one per (user, plan).
 *
 * Rivet: internal-only connect; key includes userId.
 * agentOS: kernel permissions are the security boundary for unattended work.
 *   - Do NOT deny .git paths (breaks clone and git ls-files).
 *   - Leave env at default allow (guest needs GIT_CONFIG / tool env); secrets
 *     never sit in host process.env — only pi session env.
 *   - Network: deny-by-default with GitHub + OpenRouter hosts (host + :port).
 */

import { agentOS } from '@rivet-dev/agentos';
import pi from '@agentos-software/pi';
import { bindInternalOnlyConnect } from './auth.ts';

const internal = bindInternalOnlyConnect();

const GH_NET = [
	'openrouter.ai',
	'openrouter.ai:*',
	'*.openrouter.ai',
	'*.openrouter.ai:*',
	'github.com',
	'github.com:*',
	'*.github.com',
	'*.github.com:*',
	'api.github.com',
	'api.github.com:*',
	'codeload.github.com',
	'codeload.github.com:*',
	'*.githubusercontent.com',
	'*.githubusercontent.com:*'
];

export const vm = agentOS({
	software: [pi],
	onBeforeConnect: internal.onBeforeConnect,
	createConnState: internal.createConnState,
	permissions: {
		// Secure default is fs allow (virtualized). Only block host side-channels.
		fs: {
			default: 'allow',
			rules: [
				{ mode: 'deny', operations: ['*'], paths: ['/proc/**'] },
				{ mode: 'deny', operations: ['*'], paths: ['/sys/**'] }
			]
		},
		network: {
			default: 'deny',
			rules: [{ mode: 'allow', operations: ['*'], patterns: GH_NET }]
		},
		// Default allow (virtualized). Restricting env broke clone auth / pi bootstrap.
		env: 'allow',
		childProcess: 'allow',
		process: 'allow'
	}
});
