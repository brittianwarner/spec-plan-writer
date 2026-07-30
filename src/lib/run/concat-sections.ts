import type { SpecialistRole, WorkerStatus } from '../protocol/index.ts';

export interface RoleLike {
	roleId: string;
	role: SpecialistRole;
	title: string;
	focus: string;
	sections: string[];
	ordinal: number;
	status: WorkerStatus;
	thought: string;
}

export function concatSections(
	roles: Array<{ roleId: string; ordinal: number }>,
	sections: Record<string, string>,
	titleHint: string
): string {
	const body = [...roles]
		.sort((a, b) => a.ordinal - b.ordinal)
		.map((r) => (sections[r.roleId] ?? '').trim())
		.filter(Boolean)
		.join('\n\n');
	const title = titleHint.trim().split('\n')[0].slice(0, 120) || 'Spec Plan';
	if (!body) return `# ${title}\n\n_No specialist sections were produced._\n`;
	if (/^#\s/m.test(body)) return body;
	return `# ${title}\n\n${body}\n`;
}

export function installRosterEntries(
	roles: Array<{ role: string; title: string; focus: string; sections: string[] }>
): { roles: Record<string, RoleLike>; pending: string[] } {
	const out: Record<string, RoleLike> = {};
	const pending: string[] = [];
	const used = new Set<string>();
	roles.forEach((r, ordinal) => {
		const role = r.role as SpecialistRole;
		let roleId: string = role;
		if (used.has(roleId)) roleId = `${role}-${ordinal}`;
		used.add(roleId);
		out[roleId] = {
			roleId,
			role,
			title: r.title,
			focus: r.focus,
			sections: r.sections,
			ordinal,
			status: 'queued',
			thought: ''
		};
		pending.push(roleId);
	});
	return { roles: out, pending };
}
