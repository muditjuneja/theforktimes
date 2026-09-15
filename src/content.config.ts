import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { d1Loader } from './lib/d1-loader.ts';

// One entry = one repo in one dated edition.
//
// An earlier iteration of this schema tracked "a story with an interest
// score"; this one tracks "a repo with stars, forks, deltas, language and a
// beat". The fields that drive the newspaper layout itself (title, source,
// section, interest_score, tags, authors, image) are deliberately kept
// under the same names so the edition rendering carries over unchanged, and
// the repo-specific measurements are added alongside them.
//
// D1 is the source of truth (see AGENTS.md); src/lib/d1-loader.ts is what
// turns edition_entries + repos rows into this exact shape, so nothing below
// this line needed to change when the collection stopped being markdown.
const repos = defineCollection({
	loader: d1Loader(),
	schema: z.object({
		// --- identity ---
		// NB: not `slug` - Astro's content loader treats a `slug` frontmatter
		// key as the entry id, which would override the edition-based path.
		repo: z.string(),                       // "oven-sh/bun"
		title: z.string(),                      // editorial headline, not the repo name
		description: z.string().optional(),     // repo's own GitHub description
		url: z.string().url(),
		source: z.enum(['github', 'hn', 'trending']).default('github'),
		date: z.string(),                       // edition date, YYYY-MM-DD
		section: z.string().optional(),         // beat: ai, runtime, devtools, infra, ...

		// --- measurements ---
		stars: z.number(),
		forks: z.number(),
		// Headline number. Absent until a repo has two snapshots a week apart,
		// which is why stars_per_day exists as the day-one fallback.
		stars_delta_7d: z.number().optional(),
		stars_per_day: z.number().optional(),   // age-adjusted: stars / days since creation
		fork_ratio: z.number().optional(),      // forks / stars
		language: z.string().optional(),
		repo_created_at: z.string().optional(),

		// --- Hacker News signal ---
		hn_id: z.string().optional(),
		hn_points: z.number().optional(),
		hn_comments: z.number().optional(),
		comments: z.string().url().optional(),

		// --- taxonomy (src/data/taxonomy.ts) ---
		industry: z.string().optional(),        // ai, data, devtools, security, ...
		ai_category: z.string().optional(),     // set only when industry === 'ai'
		alternative_to: z.array(z.string()).default([]),  // proprietary products replaced
		has_readme: z.boolean().default(false),

		// --- editorial ---
		why_it_matters: z.string().optional(),  // the product; see AGENTS.md
		interest_score: z.number().optional(),  // 0-10, drives sort and layout emphasis
		authors: z.array(z.string()).default([]),
		tags: z.array(z.string()).default([]),
		image: z.string().optional(),
	}),
});

// READMEs are per-repo, not per-edition, so they live in their own collection
// keyed by "owner--name" rather than being duplicated into every edition the
// repo appears in.
const readmes = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/readmes' }),
	schema: z.object({
		repo: z.string(),
		fetched_at: z.string(),
		source_url: z.string().url(),
	}),
});

export const collections = { repos, readmes };
