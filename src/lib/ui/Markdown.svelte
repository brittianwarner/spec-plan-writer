<script lang="ts">
	let {
		source = '',
		class: className = ''
	}: {
		source?: string;
		class?: string;
	} = $props();

	type Inline =
		| { t: 'text'; v: string }
		| { t: 'code'; v: string }
		| { t: 'bold'; kids: Inline[] }
		| { t: 'italic'; kids: Inline[] }
		| { t: 'link'; href: string; kids: Inline[] };

	type Block =
		| { t: 'h'; level: 1 | 2 | 3 | 4; kids: Inline[] }
		| { t: 'p'; kids: Inline[] }
		| { t: 'code'; lang: string; code: string }
		| { t: 'ul'; items: ListItem[] }
		| { t: 'ol'; items: ListItem[] }
		| { t: 'quote'; kids: Inline[] }
		| { t: 'hr' };

	type ListItem = { kids: Inline[]; task: boolean | null; checked: boolean };

	function esc(s: string): string {
		return s
			.replace(/&/g, '\u0026amp;')
			.replace(/</g, '\u0026lt;')
			.replace(/>/g, '\u0026gt;')
			.replace(/"/g, '\u0026quot;');
	}

	function parseInlines(text: string): Inline[] {
		const out: Inline[] = [];
		const re =
			/(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\((?:https?:\/\/[^)\s]+)\))/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
			const tok = m[0];
			if (tok.startsWith('`')) {
				out.push({ t: 'code', v: tok.slice(1, -1) });
			} else if (tok.startsWith('**') || tok.startsWith('__')) {
				out.push({ t: 'bold', kids: parseInlines(tok.slice(2, -2)) });
			} else if (tok.startsWith('*') || tok.startsWith('_')) {
				out.push({ t: 'italic', kids: parseInlines(tok.slice(1, -1)) });
			} else if (tok.startsWith('[')) {
				const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
				if (lm) out.push({ t: 'link', href: lm[2], kids: parseInlines(lm[1]) });
				else out.push({ t: 'text', v: tok });
			}
			last = m.index + tok.length;
		}
		if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
		return out.length ? out : [{ t: 'text', v: text }];
	}

	function renderInlines(kids: Inline[]): string {
		return kids
			.map((n) => {
				if (n.t === 'text') return esc(n.v);
				if (n.t === 'code')
					return `<code class="px-1 py-0.5 rounded bg-spw-bg border border-spw-border text-spw-blue text-[0.9em]">${esc(n.v)}</code>`;
				if (n.t === 'bold') return `<strong class="font-semibold text-spw-text">${renderInlines(n.kids)}</strong>`;
				if (n.t === 'italic') return `<em>${renderInlines(n.kids)}</em>`;
				if (n.t === 'link')
					return `<a href="${esc(n.href)}" target="_blank" rel="noopener noreferrer" class="text-spw-blue underline underline-offset-2">${renderInlines(n.kids)}</a>`;
				return '';
			})
			.join('');
	}

	function parseBlocks(md: string): Block[] {
		const lines = md.replace(/\r\n?/g, '\n').split('\n');
		const blocks: Block[] = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (/^\s*$/.test(line)) {
				i++;
				continue;
			}
			const fence = /^(```|~~~)\s*([\w-]*)\s*$/.exec(line);
			if (fence) {
				const mark = fence[1];
				const lang = fence[2] ?? '';
				i++;
				const buf: string[] = [];
				while (i < lines.length && !lines[i].startsWith(mark)) {
					buf.push(lines[i]);
					i++;
				}
				if (i < lines.length) i++;
				blocks.push({ t: 'code', lang, code: buf.join('\n') });
				continue;
			}
			if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
				blocks.push({ t: 'hr' });
				i++;
				continue;
			}
			const hm = /^(#{1,4})\s+(.+)$/.exec(line);
			if (hm) {
				blocks.push({
					t: 'h',
					level: hm[1].length as 1 | 2 | 3 | 4,
					kids: parseInlines(hm[2].trim())
				});
				i++;
				continue;
			}
			if (/^>\s?/.test(line)) {
				const buf: string[] = [];
				while (i < lines.length && /^>\s?/.test(lines[i])) {
					buf.push(lines[i].replace(/^>\s?/, ''));
					i++;
				}
				blocks.push({ t: 'quote', kids: parseInlines(buf.join(' ')) });
				continue;
			}
			if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
				const ordered = /^\s*\d+\.\s+/.test(line);
				const items: ListItem[] = [];
				while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
					const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
					const task = /^\[([ xX])\]\s+/.exec(raw);
					if (task) {
						items.push({
							task: true,
							checked: task[1].toLowerCase() === 'x',
							kids: parseInlines(raw.slice(task[0].length))
						});
					} else {
						items.push({ task: null, checked: false, kids: parseInlines(raw) });
					}
					i++;
				}
				blocks.push({ t: ordered ? 'ol' : 'ul', items });
				continue;
			}
			const buf: string[] = [line];
			i++;
			while (
				i < lines.length &&
				!/^\s*$/.test(lines[i]) &&
				!/^(#{1,4})\s+/.test(lines[i]) &&
				!/^(```|~~~)/.test(lines[i]) &&
				!/^>\s?/.test(lines[i]) &&
				!/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
				!/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
			) {
				buf.push(lines[i]);
				i++;
			}
			blocks.push({ t: 'p', kids: parseInlines(buf.join(' ')) });
		}
		return blocks;
	}

	function renderBlocks(blocks: Block[]): string {
		return blocks
			.map((b) => {
				if (b.t === 'h') {
					const cls =
						b.level === 1
							? 'text-lg font-semibold text-spw-text mt-5 mb-2'
							: b.level === 2
								? 'text-base font-semibold text-spw-text mt-4 mb-2'
								: b.level === 3
									? 'text-sm font-semibold text-spw-text mt-3 mb-1.5'
									: 'text-[13px] font-semibold text-spw-muted mt-3 mb-1';
					return `<h${b.level} class="${cls}">${renderInlines(b.kids)}</h${b.level}>`;
				}
				if (b.t === 'p')
					return `<p class="my-2 text-spw-text/90 leading-relaxed">${renderInlines(b.kids)}</p>`;
				if (b.t === 'quote')
					return `<blockquote class="my-2 pl-3 border-l-2 border-spw-border text-spw-muted">${renderInlines(b.kids)}</blockquote>`;
				if (b.t === 'hr') return `<hr class="my-4 border-spw-border" />`;
				if (b.t === 'code')
					return `<pre class="my-3 p-3 overflow-x-auto rounded-[var(--radius-spw)] bg-spw-bg border border-spw-border text-[11px] leading-relaxed"><code class="text-spw-text">${esc(b.code)}</code></pre>`;
				if (b.t === 'ul' || b.t === 'ol') {
					const tag = b.t;
					const listCls =
						tag === 'ol'
							? 'my-2 pl-5 list-decimal space-y-1'
							: 'my-2 pl-5 list-disc space-y-1';
					const items = b.items
						.map((it) => {
							if (it.task) {
								const box = it.checked ? '☑' : '☐';
								return `<li class="list-none -ml-5 text-spw-text/90"><span class="mr-1.5 text-spw-muted">${box}</span>${renderInlines(it.kids)}</li>`;
							}
							return `<li class="text-spw-text/90">${renderInlines(it.kids)}</li>`;
						})
						.join('');
					return `<${tag} class="${listCls}">${items}</${tag}>`;
				}
				return '';
			})
			.join('');
	}

	const html = $derived(source.trim() ? renderBlocks(parseBlocks(source)) : '');
</script>

<div class="spw-md max-w-none {className}">
	{#if html}
		{@html html}
	{:else}
		<p class="text-spw-faint italic text-[12px]">empty</p>
	{/if}
</div>
