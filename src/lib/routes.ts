// Canonical URL construction.
//
// Every link to a repo page, and the route that generates it, go through here
// so there is exactly one spelling of a repo's URL on the site.

/**
 * The `owner/name` segment used in a repo URL, lowercased.
 *
 * GitHub owner and repo names preserve case but compare case-insensitively,
 * so the same repo can reach us spelled several ways. URLs are case-sensitive,
 * which made each spelling a separate page - and the curated table in
 * taxonomy.ts is keyed lowercase, so every link built from it pointed at a URL
 * that did not exist (`/repo/automatic1111/...` against a page generated at
 * `/repo/AUTOMATIC1111/...`). One lowercased spelling is the canonical one;
 * the display name still comes from the repo data.
 */
export function repoSlug(repo: string): string {
	return repo.toLowerCase();
}

/** Canonical path for a repo page. */
export function repoPath(repo: string): string {
	return `/repo/${repoSlug(repo)}/`;
}

/** Anchor/slug for a proprietary product name, e.g. "Google Analytics". */
export function productSlug(product: string): string {
	return product
		.toLowerCase()
		.replace(/\+/g, '-plus')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
