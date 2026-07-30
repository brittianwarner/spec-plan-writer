/**
 * Redact credential-shaped substrings from any string that may reach the browser
 * (status lines, clone errors, agent log panes, SPEC markdown).
 */
export function redactSecrets(text: string): string {
	return text
		.replace(/x-access-token:[^@\s/'"]+/gi, 'x-access-token:[redacted]')
		.replace(/\bgho_[A-Za-z0-9_]+/g, 'gho_[redacted]')
		.replace(/\bghp_[A-Za-z0-9_]+/g, 'ghp_[redacted]')
		.replace(/\bghu_[A-Za-z0-9_]+/g, 'ghu_[redacted]')
		.replace(/\bghs_[A-Za-z0-9_]+/g, 'ghs_[redacted]')
		.replace(/\bghr_[A-Za-z0-9_]+/g, 'ghr_[redacted]')
		.replace(/\bgithub_pat_[A-Za-z0-9_]+/g, 'github_pat_[redacted]')
		.replace(/\bsk-or-v1-[A-Za-z0-9_-]+/g, 'sk-or-[redacted]')
		.replace(/\bsk-[A-Za-z0-9]{20,}/g, 'sk-[redacted]')
		.replace(/(Authorization:\s*Bearer\s+)[^\s'"]+/gi, '$1[redacted]')
		.replace(/(AUTHORIZATION:\s*bearer\s+)[^\s'"]+/gi, '$1[redacted]')
		.replace(/(bearer\s+)[A-Za-z0-9_\-./+=]{20,}/gi, '$1[redacted]');
}
