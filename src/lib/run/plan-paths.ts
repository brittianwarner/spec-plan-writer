/** Pure helpers for PR branch / path layout. */
export function slugifyPlanTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return slug || 'spec-plan';
}

export function buildSpecPrPaths(input: {
	title: string;
	version: number;
	date: string; // YYYY-MM-DD
}): { branch: string; path: string; slug: string } {
	const slug = slugifyPlanTitle(input.title);
	return {
		slug,
		branch: `spec-plan/${slug}-${input.version}`,
		path: `docs/spec-plans/${input.date}-${slug}.md`
	};
}
