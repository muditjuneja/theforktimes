// Fetch and hydrate "ready" edition entries from D1 into the shape the
// `repos` content schema expects. The one place this happens, so it happens
// once: src/lib/d1-loader.ts (the Astro Content Layer loader, at build time)
// and scripts/generate-latest.js (the /md and /json export, which runs
// before Astro even starts and so cannot go through the content collection)
// both call fetchReadyEntries() rather than each re-deriving industry,
// section and the rest by hand.
//
// Only editions.status = 'ready' rows are read - see d1-loader.ts for why
// that filter is load-bearing, not incidental.
import fs from 'node:fs';
import path from 'node:path';
import { d1Query, sqlList, sqlLiteral } from '../../scripts/lib/d1.js';
import { forkRatio } from '../../scripts/lib/rank.js';
import { industryFor, aiCategoryFor, alternativesFor } from '../data/taxonomy.ts';

const AI_HINTS = ['llm', 'ai', 'machine-learning', 'inference', 'agent', 'model', 'neural'];
const LANGUAGE_SECTION: Record<string, string> = {
	Rust: 'systems', Zig: 'systems', C: 'systems', 'C++': 'systems', Go: 'systems',
	Python: 'ai', Jupyter: 'ai', Cuda: 'ai',
	TypeScript: 'web', JavaScript: 'web', Svelte: 'web', Vue: 'web', CSS: 'web',
	Shell: 'devtools', Lua: 'devtools', Nix: 'devtools',
};

/** Same heuristic as scripts/ingest.js's sectionFor() - kept in step by hand. */
function sectionFor(language: string | null, topics: string[], description: string | null) {
	const blob = `${topics.join(' ')} ${description ?? ''}`.toLowerCase();
	if (AI_HINTS.some((h) => blob.includes(h))) return 'ai';
	return LANGUAGE_SECTION[language ?? ''] ?? 'devtools';
}

/** Cosmetic id shaping only - mirrors the old `NN-owner-name` filenames so a
 * D1-backed entry id still reads like a path. Nothing downstream parses it
 * besides the edition-date prefix (see dayOf() in src/lib/editions.ts). */
function dashSlug(slug: string) {
	return slug.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

/** Must match writeReadme()'s id in scripts/ingest.js and the lookup in
 * src/pages/repo/[...repo].astro - this is the one place both sides agree on
 * the README filename convention (owner--name, not owner-name). */
function readmeId(slug: string) {
	return slug.replace('/', '--').toLowerCase();
}

function hasReadme(slug: string) {
	return fs.existsSync(path.join(process.cwd(), 'src/content/readmes', `${readmeId(slug)}.md`));
}

interface EntryRow {
	edition: string;
	rank: number;
	slug: string;
	title: string | null;
	stars: number;
	forks: number | null;
	stars_delta_7d: number | null;
	stars_per_day: number | null;
	interest_score: number | null;
	why_it_matters: string | null;
	owner: string;
	name: string;
	description: string | null;
	homepage: string | null;
	language: string | null;
	license: string | null;
	topics: string | null;
	repo_created_at: string;
}

interface HnRow {
	slug: string;
	hn_id: string;
	points: number;
	num_comments: number;
}

export interface EditionEntry {
	id: string;
	edition: string;
	data: Record<string, unknown>;
}

/**
 * The site build's own entry point: every ready edition. See d1-loader.ts
 * for why "ready" is the gate.
 */
export async function fetchReadyEntries(): Promise<EditionEntry[]> {
	return fetchEntries({ statusFilter: "e.status = 'ready'" });
}

/**
 * One edition by date, whatever its status - for the human-facing tools
 * (issue.js, tweet.js, blurbs.js) that draft from a slate before it is
 * necessarily marked ready. Empty if the edition does not exist.
 */
export async function fetchEditionByDate(date: string): Promise<EditionEntry[]> {
	return fetchEntries({ statusFilter: `ee.edition = ${sqlLiteral(date)}` });
}

async function fetchEntries({ statusFilter }: { statusFilter: string }): Promise<EditionEntry[]> {
	const entries = (await d1Query(`
		SELECT
			ee.edition, ee.rank, ee.slug, ee.title, ee.stars, ee.forks,
			ee.stars_delta_7d, ee.stars_per_day, ee.interest_score, ee.why_it_matters,
			r.owner, r.name, r.description, r.homepage, r.language, r.license,
			r.topics, r.repo_created_at
		FROM edition_entries ee
		JOIN repos r ON r.slug = ee.slug
		JOIN editions e ON e.edition = ee.edition
		WHERE ${statusFilter}
		ORDER BY ee.edition ASC, ee.rank ASC
	`)) as EntryRow[];

	if (entries.length === 0) return [];

	// Best (highest-points) Hacker News mention per repo, for the "Discussed
	// on HN" byline. Scoped to the slugs actually in play rather than the
	// whole table, which only grows.
	const slugs = [...new Set(entries.map((e) => e.slug))];
	const hnRows = (await d1Query(`
		SELECT slug, hn_id, points, num_comments FROM hn_mentions
		WHERE slug IN ${sqlList(slugs)}
		ORDER BY points DESC
	`)) as HnRow[];
	const hnBySlug = new Map<string, HnRow>();
	for (const h of hnRows) if (!hnBySlug.has(h.slug)) hnBySlug.set(h.slug, h);

	return entries.map((e) => {
		const slug = e.slug;
		const topics: string[] = e.topics ? JSON.parse(e.topics) : [];
		const hn = hnBySlug.get(slug);
		const taxonomyText = `${e.description ?? ''} ${topics.join(' ')} ${e.language ?? ''}`;

		const id = `${e.edition}/${String(e.rank).padStart(2, '0')}-${dashSlug(slug)}`;
		const data = {
			repo: slug,
			title: e.title ?? slug,
			description: e.description ?? undefined,
			url: `https://github.com/${slug}`,
			source: hn ? ('hn' as const) : ('github' as const),
			date: e.edition,
			section: sectionFor(e.language, topics, e.description),

			stars: e.stars,
			forks: e.forks ?? 0,
			...(typeof e.stars_delta_7d === 'number' ? { stars_delta_7d: e.stars_delta_7d } : {}),
			...(typeof e.stars_per_day === 'number' ? { stars_per_day: e.stars_per_day } : {}),
			fork_ratio: forkRatio({ stars: e.stars, forks: e.forks ?? 0 }) ?? undefined,
			language: e.language ?? undefined,
			repo_created_at: e.repo_created_at,

			...(hn
				? {
						hn_id: hn.hn_id,
						hn_points: hn.points,
						hn_comments: hn.num_comments,
						comments: `https://news.ycombinator.com/item?id=${hn.hn_id}`,
					}
				: {}),

			industry: industryFor(slug, taxonomyText),
			ai_category: aiCategoryFor(slug, taxonomyText),
			alternative_to: alternativesFor(slug),
			has_readme: hasReadme(slug),

			why_it_matters: e.why_it_matters ?? undefined,
			interest_score: e.interest_score ?? undefined,
			authors: [e.owner],
			tags: [e.language, ...topics].filter((t): t is string => Boolean(t)).slice(0, 8),
		};

		return { id, edition: e.edition, data };
	});
}
