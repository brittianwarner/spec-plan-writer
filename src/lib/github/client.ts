/**
 * Minimal GitHub REST client over fetch — no octokit dependency.
 *
 * Used from: the OAuth callback (profile fetch), the user actor (repo list),
 * and the specPlan actor (PR creation). Always server/actor-side; the user's
 * access token never reaches the browser.
 */

const GITHUB_API = 'https://api.github.com';

export interface GitHubProfile {
	id: number;
	login: string;
	name: string | null;
	avatar_url: string;
}

export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'GitHubError';
	}
}

function utf8ToBase64(text: string): string {
	return Buffer.from(text, 'utf8').toString('base64');
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${GITHUB_API}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
			'user-agent': 'spec-plan-writer',
			...(init?.body ? { 'content-type': 'application/json' } : {}),
			...init?.headers
		}
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new GitHubError(`GitHub ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`, res.status);
	}
	return (await res.json()) as T;
}

export async function fetchProfile(token: string): Promise<GitHubProfile> {
	return gh<GitHubProfile>(token, '/user');
}

interface GhRepo {
	full_name: string;
	description: string | null;
	private: boolean;
	default_branch: string;
	language: string | null;
	updated_at: string;
}

/** Repos the user owns or collaborates on, recently updated first. */
export async function listRepos(token: string): Promise<GhRepo[]> {
	// affiliation=owner,collaborator covers personal + shared repos; `repo`
	// scope makes private repos visible too.
	const affiliation = 'owner,collaborator,organization_member';
	const out: GhRepo[] = [];
	for (let page = 1; page <= 5; page++) {
		const batch = await gh<GhRepo[]>(
			token,
			`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=${affiliation}`
		);
		out.push(...batch);
		if (batch.length < 100) break;
	}
	return out;
}

export interface CreatePrResult {
	prUrl: string;
	branch: string;
	alreadyExisted: boolean;
}

/**
 * Open a PR adding the spec file to the repo. Contents API flow:
 * default-branch SHA → create branch ref → PUT file on branch → open PR.
 * Idempotent-ish: an existing branch is reused, an existing open PR is found.
 */
export async function createSpecPr(
	token: string,
	repoFullName: string,
	input: { branch: string; path: string; content: string; title: string; body: string }
): Promise<CreatePrResult> {
	const repo = await gh<{ default_branch: string }>(token, `/repos/${repoFullName}`);
	const base = repo.default_branch;

	const baseRef = await gh<{ object: { sha: string } }>(
		token,
		`/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(base).replaceAll('%2F', '/')}`
	);

	try {
		await gh(token, `/repos/${repoFullName}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseRef.object.sha })
		});
	} catch (err) {
		// 422 = reference already exists — reuse it.
		if (!(err instanceof GitHubError && err.status === 422)) throw err;
	}

	const contentPath = input.path
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
	let existingSha: string | undefined;
	try {
		const existing = await gh<{ sha: string }>(
			token,
			`/repos/${repoFullName}/contents/${contentPath}?ref=${encodeURIComponent(input.branch)}`
		);
		existingSha = existing.sha;
	} catch (err) {
		if (!(err instanceof GitHubError && err.status === 404)) throw err;
	}

	await gh(token, `/repos/${repoFullName}/contents/${contentPath}`, {
		method: 'PUT',
		body: JSON.stringify({
			message: existingSha
				? `docs: update spec plan (${input.title})`
				: `docs: add spec plan (${input.title})`,
			content: utf8ToBase64(input.content),
			branch: input.branch,
			...(existingSha ? { sha: existingSha } : {})
		})
	});

	try {
		const pr = await gh<{ html_url: string }>(token, `/repos/${repoFullName}/pulls`, {
			method: 'POST',
			body: JSON.stringify({ title: input.title, head: input.branch, base, body: input.body })
		});
		return { prUrl: pr.html_url, branch: input.branch, alreadyExisted: false };
	} catch (err) {
		if (err instanceof GitHubError && err.status === 422) {
			// A PR for this branch already exists — find it.
			const [owner] = repoFullName.split('/');
			const prs = await gh<Array<{ html_url: string }>>(
				token,
				`/repos/${repoFullName}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branch}`)}`
			);
			if (prs.length > 0) {
				return { prUrl: prs[0].html_url, branch: input.branch, alreadyExisted: true };
			}
		}
		throw err;
	}
}
