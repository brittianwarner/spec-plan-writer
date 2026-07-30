/**
 * Provision helpers for a plan's shared agentOS VM.
 *
 * Git clone NEVER embeds the GitHub token in the remote URL. Auth is via
 * `git -c http.extraHeader=…` (process-local argv), then origin is scrubbed.
 */

import { chunkedS3MountPlugin } from '@rivet-dev/agentos-runtime-core/descriptors';
import {
	LIMITS,
	VM_NOTES_DIR,
	VM_PLAN_DIR,
	VM_REPO_DIR,
	VM_SECTIONS_DIR,
	VM_SPEC_PATH,
	VM_WORK_DIR
} from '../../protocol/index.ts';
import { redactSecrets } from '../auth.ts';
import { piModel, s3MountConfig } from '../env.ts';
import { piProvisionFiles } from './pi-config.ts';

export interface VmExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface VmHandle {
	mountFs?(descriptor: {
		path: string;
		plugin: { id: string; config?: object };
		readOnly?: boolean;
	}): Promise<void>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	readFile(path: string): Promise<Uint8Array>;
	exists(path: string): Promise<boolean>;
	exec(command: string): Promise<VmExecResult>;
	sessions: {
		open(input: {
			sessionId?: string;
			agent: string;
			cwd?: string;
			env?: Record<string, string>;
			permissionPolicy?: 'allow_all' | 'ask' | 'reject_all';
		}): Promise<void>;
		prompt(input: {
			sessionId?: string;
			content: Array<{ type: 'text'; text: string }>;
		}): Promise<unknown>;
		delete(input?: { sessionId?: string }): Promise<void>;
		cancelPrompt?(input?: { sessionId?: string }): Promise<unknown>;
	};
	connect?(params?: unknown): VmConn;
}

export interface VmConn {
	on(eventName: string, callback: (...args: unknown[]) => void): (() => void) | void;
	disconnect?(reason?: string): Promise<void>;
	ready?: Promise<void>;
}

export function bytesToString(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

export async function writePiConfig(vm: VmHandle, model = piModel()): Promise<void> {
	await vm.mkdir('/home/agentos/.pi/agent', { recursive: true });
	for (const file of piProvisionFiles(model)) {
		const parent = file.path.slice(0, file.path.lastIndexOf('/'));
		if (parent) await vm.mkdir(parent, { recursive: true });
		await vm.writeFile(file.path, file.content);
	}
}

/**
 * Mount S3 (best-effort, user-scoped prefix), create plan dirs, write pi
 * config, shallow-clone the GitHub repo without credentialed remotes.
 */
export async function provisionWorkspace(
	vm: VmHandle,
	input: {
		userId: string;
		planId: string;
		repoFullName: string;
		defaultBranch: string;
		githubToken: string;
		model?: string;
	}
): Promise<{ statusLine: string }> {
	const s3 = s3MountConfig();
	if (s3) {
		try {
			const plugin = chunkedS3MountPlugin({
				bucket: s3.bucket,
				prefix: `${s3.prefix}plans/${input.userId}/${input.planId}/`,
				region: s3.region,
				endpoint: s3.endpoint,
				credentials: s3.credentials
			});
			if (typeof vm.mountFs === 'function') {
				await vm.mountFs({ path: VM_WORK_DIR, plugin });
			}
		} catch {
			// default VM filesystem
		}
	}

	await vm.mkdir(VM_WORK_DIR, { recursive: true });
	await vm.mkdir(VM_PLAN_DIR, { recursive: true });
	await vm.mkdir(VM_SECTIONS_DIR, { recursive: true });
	await vm.mkdir(VM_NOTES_DIR, { recursive: true });
	await vm.mkdir('/home/agentos/.pi/agent', { recursive: true });
	await writePiConfig(vm, input.model ?? piModel());

	await shallowClone(vm, input.repoFullName, input.defaultBranch, input.githubToken);
	return { statusLine: `Ready · ${input.repoFullName}` };
}

/**
 * Clone without storing the token in .git/config:
 *   git -c http.extraHeader=… (argv-local, survives env-scrubbed guests)
 *   then forced public remote scrub.
 */
async function shallowClone(
	vm: VmHandle,
	repoFullName: string,
	defaultBranch: string,
	githubToken: string
): Promise<void> {
	const publicRemote = `https://github.com/${repoFullName}.git`;
	const branch = defaultBranch.trim();
	const branchArgs = branch ? `-b ${shellQuote(branch)} ` : '';
	const header = `AUTHORIZATION: bearer ${githubToken}`;
	const cloneCmd =
		`git -c http.extraHeader=${shellQuote(header)} ` +
		`clone --depth 1 ${branchArgs}${shellQuote(publicRemote)} ${shellQuote(VM_REPO_DIR)}`;

	await vm.exec(`rm -rf ${shellQuote(VM_REPO_DIR)}`);
	const result = await vm.exec(cloneCmd);
	if (result.exitCode !== 0) {
		const detail = redactSecrets(result.stderr || result.stdout || 'git clone failed').slice(0, 300);
		throw new Error(`Failed to clone ${repoFullName}: ${detail}`);
	}

	await vm.exec(
		`git -C ${shellQuote(VM_REPO_DIR)} remote set-url origin ${shellQuote(publicRemote)}`
	);
	await vm.exec(
		`git -C ${shellQuote(VM_REPO_DIR)} config --local --unset-all http.extraHeader || true`
	);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function collectPlannerContext(vm: VmHandle): Promise<{
	fileTree: string[];
	readmeExcerpt: string | null;
}> {
	const ls = await vm.exec(`git -C ${shellQuote(VM_REPO_DIR)} ls-files`);
	const fileTree = (ls.exitCode === 0 ? ls.stdout : '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(0, LIMITS.plannerTreePaths);

	let readmeExcerpt: string | null = null;
	for (const name of ['README.md', 'readme.md', 'README']) {
		const path = `${VM_REPO_DIR}/${name}`;
		try {
			if (!(await vm.exists(path))) continue;
			readmeExcerpt = bytesToString(await vm.readFile(path)).slice(0, LIMITS.plannerReadmeChars);
			break;
		} catch {
			// try next
		}
	}
	return { fileTree, readmeExcerpt };
}

export async function readSpecMarkdown(vm: VmHandle): Promise<string | null> {
	try {
		if (!(await vm.exists(VM_SPEC_PATH))) return null;
		const md = bytesToString(await vm.readFile(VM_SPEC_PATH)).trim();
		return md || null;
	} catch {
		return null;
	}
}

export async function readSectionMarkdown(vm: VmHandle, roleId: string): Promise<string> {
	const path = `${VM_SECTIONS_DIR}/${roleId}.md`;
	try {
		if (!(await vm.exists(path))) return '';
		return bytesToString(await vm.readFile(path));
	} catch {
		return '';
	}
}

/**
 * Open a one-shot pi session, prompt, tear down.
 *
 * Models & credentials: the OpenRouter key is injected only into this session's
 * env (never host process.env). Approvals: unattended specialists use
 * permissionPolicy `allow_all` so ACP tool prompts auto-resolve — the kernel
 * permission policy on the VM remains the security boundary (see vm.ts and
 * https://agentos-sdk.dev/docs/approvals/).
 */
export async function runPiPrompt(
	vm: VmHandle,
	input: {
		openrouterKey: string;
		prompt: string;
		sessionId?: string;
		cwd?: string;
		onEvent?: (event: unknown) => void;
		connectParams?: unknown;
		abortSignal?: AbortSignal;
	}
): Promise<{ sessionId: string; ok: boolean; error?: string }> {
	const sessionId = input.sessionId ?? crypto.randomUUID();
	let conn: VmConn | null = null;
	let unsub: (() => void) | null = null;

	const onAbort = () => {
		void vm.sessions.cancelPrompt?.({ sessionId }).catch(() => {});
	};
	if (input.abortSignal) {
		if (input.abortSignal.aborted) onAbort();
		else input.abortSignal.addEventListener('abort', onAbort, { once: true });
	}

	try {
		if (input.onEvent && typeof vm.connect === 'function') {
			try {
				conn = vm.connect(input.connectParams);
				if (conn.ready) await conn.ready;
				const off = conn.on('sessionEvent', (...args: unknown[]) => {
					const event = args[0];
					if (!event || typeof event !== 'object') return;
					const e = event as { sessionId?: string };
					if (e.sessionId && e.sessionId !== sessionId) return;
					input.onEvent?.(event);
				});
				if (typeof off === 'function') unsub = off;
			} catch {
				conn = null;
			}
		}

		await vm.sessions.open({
			sessionId,
			agent: 'pi',
			cwd: input.cwd ?? VM_WORK_DIR,
			env: { OPENROUTER_API_KEY: input.openrouterKey },
			permissionPolicy: 'allow_all'
		});
		await vm.sessions.prompt({
			sessionId,
			content: [{ type: 'text', text: input.prompt }]
		});
		return { sessionId, ok: true };
	} catch (err) {
		const message = redactSecrets(err instanceof Error ? err.message : String(err));
		return { sessionId, ok: false, error: message.slice(0, 400) };
	} finally {
		if (input.abortSignal) {
			input.abortSignal.removeEventListener('abort', onAbort);
		}
		try {
			unsub?.();
		} catch {
			// ignore
		}
		try {
			await vm.sessions.delete({ sessionId });
		} catch {
			// ignore
		}
		try {
			await conn?.disconnect?.();
		} catch {
			// ignore
		}
	}
}
