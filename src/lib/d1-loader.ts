// Astro Content Layer loader for the `repos` collection, reading D1 instead
// of src/content/repos/*.md.
//
// D1 is the single source of truth for measurements (see AGENTS.md). The
// actual query + hydration lives in edition-data.ts, shared with
// scripts/generate-latest.js; this file is just the Loader plumbing around
// it (parseData, store), which is why every page that calls
// `getCollection('repos')` (src/lib/editions.ts and friends) needed no
// changes at all.
//
// Only `editions.status = 'ready'` rows are read. Publishing is a human
// running `npm run deploy` at a time of their choosing, and a deploy can be
// triggered for reasons that have nothing to do with the newsletter (a CSS
// fix, a copy edit) - so a *draft* edition being mid-review in /admin must
// never be one unrelated deploy away from going live. This filter is that
// guarantee.
import type { Loader } from 'astro/loaders';
import { fetchReadyEntries } from './edition-data.ts';

export function d1Loader(): Loader {
	return {
		name: 'd1-loader',
		load: async ({ store, parseData, logger }) => {
			const entries = await fetchReadyEntries();

			store.clear();

			if (entries.length === 0) {
				logger.warn('No ready editions in D1 - has one been marked ready in /admin?');
				return;
			}

			for (const { id, data } of entries) {
				const parsed = await parseData({ id, data });
				store.set({ id, data: parsed });
			}

			logger.info(`Loaded ${entries.length} entries across ${new Set(entries.map((e) => e.edition)).size} ready edition(s) from D1`);
		},
	};
}
