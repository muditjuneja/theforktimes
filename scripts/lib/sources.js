// File-writing data sources for The Fork Times: READMEs and star history.
//
// Candidate discovery and GitHub enrichment (the GraphQL batching, the
// ungh.cc fallback, the Hacker News Algolia search) now happen in D1 -
// worker/index.js's nightlySnapshot()/weeklyEdition() talk to those APIs
// directly, deliberately self-contained rather than sharing this file (see
// AGENTS.md). What is left here is what only a filesystem-writing Node
// script can do: fetch a README and a repo's sampled star history and write
// them to src/content/readmes/, which scripts/ingest.js calls for whichever
// repos are in a given D1 edition.

const RAW = 'https://raw.githubusercontent.com';
const README_NAMES = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README.rst', 'README'];

/**
 * Fetch a repo's README from raw.githubusercontent.
 * Tries the default branch first, then the usual fallbacks, then common
 * filename casings - GitHub is case-sensitive here and projects disagree.
 */
export async function fetchReadme(slug, { defaultBranch } = {}) {
	const branches = [...new Set([defaultBranch, 'main', 'master'].filter(Boolean))];
	for (const branch of branches) {
		for (const name of README_NAMES) {
			try {
				const url = `${RAW}/${slug}/${branch}/${name}`;
				const res = await fetch(url, { headers: { 'User-Agent': 'theforktimes-ingest' } });
				if (!res.ok) continue;
				const text = await res.text();
				if (!text.trim()) continue;
				return { markdown: text, source_url: url, branch };
			} catch {
				// Try the next candidate.
			}
		}
	}
	return null;
}

/**
 * Reconstruct a repo's star history from the stargazers API.
 *
 * GitHub never exposes historical star counts, only the current total, so the
 * only way to draw a curve for a repo we have not been snapshotting is to page
 * the stargazer list with the `star+json` media type, which carries a
 * `starred_at` per entry. That is 1 request per 100 stars, so for anything
 * large we sample evenly spaced pages and interpolate between them rather than
 * pulling the whole list.
 *
 * Going forward, `repo_snapshots` in D1 is the real source; this exists to
 * backfill the curve on a repo's first appearance.
 */
export async function fetchStarHistory(slug, { token = process.env.GITHUB_TOKEN, totalStars, samples = 24 } = {}) {
	if (!token || !totalStars) return null;
	const perPage = 100;
	const lastPage = Math.ceil(totalStars / perPage);
	// GitHub's pagination caps out at 400 pages (40k stars) for this endpoint.
	const reachable = Math.min(lastPage, 400);
	const step = Math.max(1, Math.floor(reachable / samples));

	const pages = [];
	for (let p = 1; p <= reachable; p += step) pages.push(p);
	if (pages[pages.length - 1] !== reachable) pages.push(reachable);

	const points = [];
	for (const page of pages) {
		try {
			const res = await fetch(
				`https://api.github.com/repos/${slug}/stargazers?per_page=${perPage}&page=${page}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: 'application/vnd.github.star+json',
						'User-Agent': 'theforktimes-ingest',
					},
				}
			);
			if (!res.ok) break;
			const rows = await res.json();
			if (!Array.isArray(rows) || rows.length === 0) continue;
			const first = rows[0]?.starred_at;
			if (!first) continue;
			points.push({ date: first.slice(0, 10), stars: (page - 1) * perPage });
		} catch {
			break;
		}
	}
	if (points.length < 2) return null;
	points.push({ date: new Date().toISOString().slice(0, 10), stars: totalStars });
	// Pagination can repeat a boundary date; keep the curve monotonic.
	return points
		.filter((p, i, arr) => i === 0 || p.date >= arr[i - 1].date)
		.sort((a, b) => a.date.localeCompare(b.date));
}
