// Edition loading, in one place.
//
// The front page and the dated route render the same thing from the same
// data; keeping that in two files meant the story projection had to be
// updated twice whenever a field was added to the schema, and it drifted.

import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';

export interface EditionDay {
	day: string;
	label: string;
	count: number;
	issue: number;
}

/** The edition date is the entry's folder: `2026-09-14/03-ollama-ollama`. */
export function dayOf(entry: CollectionEntry<'repos'>): string {
	return entry.id.split('/')[0];
}

export function editionLabel(day: string): string {
	return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/** Every edition, oldest first, numbered by publication order. */
export async function allEditions(): Promise<EditionDay[]> {
	const entries = await getCollection('repos');
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const day = dayOf(entry);
		counts.set(day, (counts.get(day) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([day, count], index) => ({ day, count, issue: index + 1, label: editionLabel(day) }));
}

/**
 * One edition's entries, ranked.
 *
 * Spreading `entry.data` rather than listing every field by hand is the point:
 * a new schema field reaches the layout without a second edit here. No
 * render() - D1-backed entries have no file body; StoryBody.astro renders
 * the equivalent facts line directly from these same fields.
 */
export async function editionStories(day: string) {
	const entries = await getCollection('repos');
	const ranked = entries
		.filter((entry) => dayOf(entry) === day)
		.sort((a, b) => (b.data.interest_score ?? 0) - (a.data.interest_score ?? 0));

	return ranked.map((entry) => ({ ...entry.data, slug: entry.id.split('/')[1] }));
}

/** Props for EditionPage, for whichever edition is asked for. */
export async function editionProps(day: string, { isHomepage = false } = {}) {
	const editions = await allEditions();
	const index = editions.findIndex((e) => e.day === day);
	const stories = await editionStories(day);

	return {
		day,
		stories,
		issue: index + 1,
		totalIssues: editions.length,
		prevDay: editions[index - 1]?.day ?? null,
		nextDay: editions[index + 1]?.day ?? null,
		allDays: [...editions].reverse().map(({ day, label }) => ({ day, label })),
		isHomepage,
		// The front page mirrors the newest edition, so the dated route for that
		// edition canonicalises to / while it holds the slot.
		isLatest: index === editions.length - 1,
	};
}
