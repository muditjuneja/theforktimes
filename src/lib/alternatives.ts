// The /alternatives/ gate, in one place.
//
// Both the index and the per-product route need to agree on which products
// have a page: the index must not link a page that was never generated, and
// the route must not generate one the index does not know about. So the
// decision lives here and both import it.

import type { CollectionEntry } from 'astro:content';
import { CURATED, alternativeIndex, isProprietary } from '../data/taxonomy';

/**
 * How many substitutes must bring a curated note or a real measurement before
 * a product earns its own page.
 *
 * The competing pages for "open source alternative to X" run to hundreds or
 * thousands of words per product. Generating all 75 regardless would put a
 * thin-content footprint on a domain with no authority yet, so the gate holds
 * a product back until we have something to say about it. Raise this as the
 * notes in taxonomy.ts and the edition archive fill in.
 */
export const MIN_SUBSTANTIVE = 1;

/**
 * How many substitutes a product must have at all.
 *
 * A page listing one project tells the reader nothing the index row does not
 * already tell them, and "alternatives" in the plural is a promise of a
 * choice. Two is the point where the page starts doing work the index cannot.
 */
export const MIN_SUBSTITUTES = 2;

export interface Substitute {
	slug: string;
	note: string | null;
	industry: string | null;
	stars: number | null;
	starsDelta7d: number | null;
	starsPerDay: number | null;
	forkRatio: number | null;
	language: string | null;
	editions: string[];
	/** Has appeared in an edition, so it has measurements and a repo page. */
	measured: boolean;
}

/** Most recent appearance per repo, keyed by the lowercase slug CURATED uses. */
export function latestByRepo(entries: CollectionEntry<'repos'>[]) {
	const map = new Map<string, CollectionEntry<'repos'>>();
	for (const entry of entries) {
		const key = entry.data.repo.toLowerCase();
		const prev = map.get(key);
		if (!prev || entry.data.date > prev.data.date) map.set(key, entry);
	}
	return map;
}

function substitute(slug: string, entry?: CollectionEntry<'repos'>): Substitute {
	const d = entry?.data;
	return {
		slug,
		note: CURATED[slug]?.note ?? null,
		industry: d?.industry ?? CURATED[slug]?.industry ?? null,
		stars: d?.stars ?? null,
		starsDelta7d: d?.stars_delta_7d ?? null,
		starsPerDay: d?.stars_per_day ?? null,
		forkRatio: d?.fork_ratio ?? null,
		language: d?.language ?? null,
		editions: entry ? [entry.data.date] : [],
		measured: !!entry,
	};
}

/**
 * Ranked by the metric the paper is built on. Tiered rather than blended:
 * velocity and stars/day are different units, so projects are compared within
 * a metric and never across one. Unmeasured projects sort last rather than
 * being dropped - we still stand behind the claim.
 */
function rank(a: Substitute, b: Substitute) {
	const tier = (s: Substitute) =>
		s.starsDelta7d !== null ? 3 : s.starsPerDay !== null ? 2 : s.stars !== null ? 1 : 0;
	const within = (s: Substitute) => s.starsDelta7d ?? s.starsPerDay ?? s.stars ?? 0;
	return tier(b) - tier(a) || within(b) - within(a);
}

export interface ProductPage {
	product: string;
	substitutes: Substitute[];
}

/**
 * Every product that earns its own page, with its ranked substitutes.
 * The single source of truth for both /alternatives/ and /alternatives/<x>/.
 */
export function productPages(entries: CollectionEntry<'repos'>[]): ProductPage[] {
	const measured = latestByRepo(entries);
	const pages: ProductPage[] = [];

	for (const [product, slugs] of alternativeIndex()) {
		if (!isProprietary(product)) continue;

		const substitutes = slugs.map((slug) => substitute(slug, measured.get(slug)));
		if (substitutes.length < MIN_SUBSTITUTES) continue;
		if (substitutes.filter((s) => s.note || s.measured).length < MIN_SUBSTANTIVE) continue;

		pages.push({ product, substitutes: substitutes.sort(rank) });
	}
	return pages;
}
