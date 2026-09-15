// D1 writes for the /admin portal. Runs inside the Worker (via
// `cloudflare:workers`' env.DB), so - unlike scripts/lib/d1.js, which shells
// out to `wrangler d1 execute` for the build-time Node side - this uses the
// native binding's real parameter binding directly. `db` is left loosely
// typed rather than pulling in @cloudflare/workers-types, matching how
// worker/index.js's own D1 calls are already untyped.
import { hasEditorialNote } from './meta.ts';
import { industryFor } from '../data/taxonomy.ts';

/** Same stepped scale worker/index.js's weeklyEdition() assigns at compute
 * time (10,10,10,9,9,9,8,8,8...) - kept in sync here so reordering in
 * /admin still drives the site's actual sort, which is by interest_score,
 * not rank (see editionStories() in src/lib/editions.ts). */
function scoreForRank(rank: number): number {
	return Math.max(1, 10 - Math.floor((rank - 1) / 3));
}

export interface EditionSummary {
	edition: string;
	status: string;
	published_at: string | null;
	entries: number;
	pending: number;
}

export async function listEditions(db: any): Promise<EditionSummary[]> {
	const { results } = await db
		.prepare(
			`SELECT e.edition, e.status, e.published_at,
				COUNT(ee.slug) AS entries,
				SUM(CASE WHEN ee.why_it_matters IS NULL OR ee.why_it_matters LIKE '%editorial note pending%' THEN 1 ELSE 0 END) AS pending
			FROM editions e
			LEFT JOIN edition_entries ee ON ee.edition = e.edition
			GROUP BY e.edition
			ORDER BY e.edition DESC`
		)
		.all();
	return results;
}

export interface AdminEntry {
	slug: string;
	rank: number;
	title: string | null;
	stars: number;
	forks: number | null;
	stars_delta_7d: number | null;
	stars_per_day: number | null;
	interest_score: number | null;
	why_it_matters: string | null;
}

export async function getEdition(db: any, edition: string) {
	const status = await db.prepare('SELECT status FROM editions WHERE edition = ?1').bind(edition).first();
	if (!status) return null;
	const { results } = await db
		.prepare(
			`SELECT slug, rank, title, stars, forks, stars_delta_7d, stars_per_day, interest_score, why_it_matters
			FROM edition_entries WHERE edition = ?1 ORDER BY rank ASC`
		)
		.bind(edition)
		.all();
	return { edition, status: status.status as string, entries: results as AdminEntry[] };
}

async function logRevision(db: any, edition: string, slug: string, field: string, oldValue: string | null) {
	await db
		.prepare(
			`INSERT INTO edition_entry_revisions (edition, slug, field, old_value, changed_at) VALUES (?1,?2,?3,?4,?5)`
		)
		.bind(edition, slug, field, oldValue, new Date().toISOString())
		.run();
}

/** title | why_it_matters - the two fields an editor hand-writes. Logs the
 * previous value first, so the edit is undoable. */
export async function updateEntryField(db: any, edition: string, slug: string, field: 'title' | 'why_it_matters', value: string) {
	const current = await db
		.prepare(`SELECT ${field} AS v FROM edition_entries WHERE edition = ?1 AND slug = ?2`)
		.bind(edition, slug)
		.first();
	if (!current) throw new Error(`No such entry: ${edition}/${slug}`);
	await logRevision(db, edition, slug, field, current.v as string | null);
	await db
		.prepare(`UPDATE edition_entries SET ${field} = ?1 WHERE edition = ?2 AND slug = ?3`)
		.bind(value, edition, slug)
		.run();
}

/** Swap this entry's rank with its neighbor in the given direction, then
 * recompute interest_score for the *whole* edition, not just the pair that
 * moved. Scores already on the other rows can predate this scale (backfilled
 * from the old percentile-based one in scripts/lib/rank.js, say) - leaving
 * them stale risks a later entry outranking an earlier one it should not,
 * since display sorts by score, not rank (see editionStories() in
 * src/lib/editions.ts). Recomputing everyone keeps the two consistent after
 * every move, the same way deleteEntry() already has to. */
export async function moveEntry(db: any, edition: string, slug: string, direction: 'up' | 'down') {
	const { results } = await db
		.prepare('SELECT slug, rank FROM edition_entries WHERE edition = ?1 ORDER BY rank ASC')
		.bind(edition)
		.all();
	const rows = results as { slug: string; rank: number }[];
	const i = rows.findIndex((r) => r.slug === slug);
	const j = direction === 'up' ? i - 1 : i + 1;
	if (i === -1 || j < 0 || j >= rows.length) return;

	const reordered = [...rows];
	[reordered[i], reordered[j]] = [reordered[j], reordered[i]];

	await db.batch(
		reordered.map((r, idx) =>
			db.prepare('UPDATE edition_entries SET rank = ?1, interest_score = ?2 WHERE edition = ?3 AND slug = ?4')
				.bind(idx + 1, scoreForRank(idx + 1), edition, r.slug)
		)
	);
}

/** Drop an entry and re-sequence the remaining ranks to stay contiguous
 * (1..N), same as renaming the old markdown files' NN- prefix used to. */
export async function deleteEntry(db: any, edition: string, slug: string) {
	const { results } = await db
		.prepare('SELECT slug FROM edition_entries WHERE edition = ?1 ORDER BY rank ASC')
		.bind(edition)
		.all();
	const remaining = (results as { slug: string }[]).filter((r) => r.slug !== slug);

	const statements = [
		db.prepare('DELETE FROM edition_entries WHERE edition = ?1 AND slug = ?2').bind(edition, slug),
		...remaining.map((r, i) =>
			db.prepare('UPDATE edition_entries SET rank = ?1, interest_score = ?2 WHERE edition = ?3 AND slug = ?4')
				.bind(i + 1, scoreForRank(i + 1), edition, r.slug)
		),
	];
	await db.batch(statements);
}

/**
 * Flip draft <-> ready. Refuses to mark an edition ready while any entry
 * still carries the "Editorial note pending" placeholder - the same guard
 * scripts/tweet.js already enforces before posting, applied one step
 * earlier. Returns the list of slugs still pending when it refuses.
 */
export async function setEditionStatus(db: any, edition: string, status: 'draft' | 'ready'): Promise<{ ok: true } | { ok: false; pending: string[] }> {
	if (status === 'ready') {
		const { results } = await db
			.prepare('SELECT slug, why_it_matters FROM edition_entries WHERE edition = ?1')
			.bind(edition)
			.all();
		const pending = (results as { slug: string; why_it_matters: string | null }[])
			.filter((r) => !hasEditorialNote(r.why_it_matters ?? undefined))
			.map((r) => r.slug);
		if (pending.length > 0) return { ok: false, pending };
	}

	await db
		.prepare('UPDATE editions SET status = ?1, published_at = ?2 WHERE edition = ?3')
		.bind(status, status === 'ready' ? new Date().toISOString() : null, edition)
		.run();
	return { ok: true };
}

// ─── posting to X (src/pages/admin/[edition]/post/) ────────────────────
//
// See the comment on edition_posts in schema.sql for the full design: a
// draft is persisted (not regenerated on refresh) so a human posts exactly
// the text they reviewed, and post_claimed_at is an atomic claim that makes
// a double post structurally impossible rather than merely unlikely.

/** Shape scripts/lib/post-draft.js's buildPrompt() and hasEditorialNote()
 * both expect - the same fields scripts/tweet.js's loadEdition() produces
 * from the Node side, hydrated here from the native binding instead. */
export interface PostEntry {
	repo: string;
	stars: number;
	forks: number;
	stars_delta_7d: number | null;
	stars_per_day: number | null;
	language: string | null;
	industry: string | null;
	why: string;
	description: string;
}

export async function getEditionEntriesForPost(db: any, edition: string): Promise<PostEntry[]> {
	const { results } = await db
		.prepare(
			`SELECT ee.slug, ee.stars, ee.forks, ee.stars_delta_7d, ee.stars_per_day, ee.why_it_matters,
				r.language, r.description, r.topics
			FROM edition_entries ee
			JOIN repos r ON r.slug = ee.slug
			WHERE ee.edition = ?1
			ORDER BY ee.rank ASC`
		)
		.bind(edition)
		.all();

	return (results as any[]).map((r) => {
		const topics: string[] = r.topics ? JSON.parse(r.topics) : [];
		const taxonomyText = `${r.description ?? ''} ${topics.join(' ')} ${r.language ?? ''}`;
		return {
			repo: r.slug,
			stars: r.stars,
			forks: r.forks,
			stars_delta_7d: typeof r.stars_delta_7d === 'number' ? r.stars_delta_7d : null,
			stars_per_day: typeof r.stars_per_day === 'number' ? r.stars_per_day : null,
			language: r.language ?? null,
			industry: industryFor(r.slug, taxonomyText),
			why: r.why_it_matters ?? '',
			description: r.description ?? '',
		};
	});
}

export interface EditionPost {
	edition: string;
	subject_slug: string;
	draft_text: string | null;
	draft_model: string | null;
	draft_generated_at: string | null;
	post_claimed_at: string | null;
	posted_tweet_id: string | null;
	posted_text: string | null;
	posted_media_id: string | null;
	posted_cost_estimate: number | null;
	posted_at: string | null;
}

export async function getEditionPost(db: any, edition: string): Promise<EditionPost | null> {
	const row = await db.prepare('SELECT * FROM edition_posts WHERE edition = ?1').bind(edition).first();
	return (row as EditionPost | null) ?? null;
}

/** Create or refresh the draft. Upserts, but the conflict branch is
 * `WHERE posted_tweet_id IS NULL` - once a post has actually gone out this
 * is a no-op, the same "never clobber a finalized row" idiom
 * weeklyEdition() uses for why_it_matters. */
export async function saveDraft(db: any, edition: string, opts: { subjectSlug: string; text: string; model: string }) {
	await db
		.prepare(
			`INSERT INTO edition_posts (edition, subject_slug, draft_text, draft_model, draft_generated_at)
			VALUES (?1, ?2, ?3, ?4, ?5)
			ON CONFLICT(edition) DO UPDATE SET
				subject_slug = excluded.subject_slug,
				draft_text = excluded.draft_text,
				draft_model = excluded.draft_model,
				draft_generated_at = excluded.draft_generated_at
			WHERE edition_posts.posted_tweet_id IS NULL`
		)
		.bind(edition, opts.subjectSlug, opts.text, opts.model, new Date().toISOString())
		.run();
}

/**
 * Atomically claim the right to post this edition - the actual double-post
 * guard, not the UI. Succeeds only if it actually flips post_claimed_at from
 * NULL; a losing concurrent request (a double click, a retry) gets false
 * back and must not proceed to any network call. Requires a draft row to
 * already exist (callers check draft_text is present first), so "no row"
 * and "already posted"/"already claimed" all just read as false here - the
 * route only needs to know whether it may proceed, not why it may not.
 *
 * SQLite/D1 serialize writes to one database (single-writer), so the WHERE
 * clause itself is what makes this atomic - whichever request's UPDATE
 * commits first is the only one that can see post_claimed_at IS NULL. But
 * rather than trust `run()`'s returned change count to report that
 * correctly (its exact shape isn't the same across every D1 access path,
 * and this is the one place in the app where being wrong about it means an
 * actual second public post), this confirms by reading the row back and
 * checking that this call's own token - not merely *a* non-null value - is
 * what ended up stored. The token is a plain ISO timestamp (millisecond
 * resolution), which doubles as the value the UI reads for staleness -
 * a same-millisecond collision between two genuinely independent claims is
 * not a realistic risk for a human clicking a button.
 */
export async function claimPost(db: any, edition: string): Promise<boolean> {
	const token = new Date().toISOString();
	await db
		.prepare(
			`UPDATE edition_posts SET post_claimed_at = ?1
			WHERE edition = ?2 AND posted_tweet_id IS NULL AND post_claimed_at IS NULL`
		)
		.bind(token, edition)
		.run();
	const row = await db.prepare('SELECT post_claimed_at FROM edition_posts WHERE edition = ?1').bind(edition).first();
	return row?.post_claimed_at === token;
}

/** Record a successful post. WHERE posted_tweet_id IS NULL so this can never
 * overwrite an already-finalized row, even if it were somehow called twice. */
export async function recordPosted(db: any, edition: string, opts: {
	text: string;
	tweetId: string;
	mediaId: string | null;
	costEstimate: number;
}) {
	await db
		.prepare(
			`UPDATE edition_posts SET
				posted_tweet_id = ?1, posted_text = ?2, posted_media_id = ?3,
				posted_cost_estimate = ?4, posted_at = ?5
			WHERE edition = ?6 AND posted_tweet_id IS NULL`
		)
		.bind(opts.tweetId, opts.text, opts.mediaId, opts.costEstimate, new Date().toISOString(), edition)
		.run();
}

/** The X call failed after a successful claim - release it so a genuine
 * retry is not locked out. Guarded the same way, so it can never re-open a
 * row that a (theoretically concurrent) success has since finalized. */
export async function clearFailedClaim(db: any, edition: string) {
	await db
		.prepare('UPDATE edition_posts SET post_claimed_at = NULL WHERE edition = ?1 AND posted_tweet_id IS NULL')
		.bind(edition)
		.run();
}
