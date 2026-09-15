// The Fork Times - the one Worker: serves the site, runs the admin portal,
// and runs the ingestion crons.
//
// Nightly: snapshot every tracked repo into D1.
// Weekly:  compute the edition from the accumulated snapshots and leave it
//          as a draft - see weeklyEdition() for why this does not publish
//          anything by itself.
//
// `main` in wrangler.jsonc points here rather than at an Astro-generated
// entrypoint, so this file owns `fetch` and delegates to Astro's own
// rendering (static assets, and the SSR /admin/* routes) via the adapter's
// `handle()` for everything it does not claim itself. That is also why the
// scheduled crons live here rather than as an Astro route: there is no
// "handle this on a cron" hook to delegate to, and this Worker is the only
// thing running when a trigger fires.
//
// The nightly/weekly job bodies are deliberately self-contained rather than
// sharing scripts/lib/sources.js: the Worker runtime has different
// constraints (subrequest caps, D1 statement batching, no filesystem) and
// pretending otherwise would make both harder.
import { handle } from '@astrojs/cloudflare/handler';

const GRAPHQL = 'https://api.github.com/graphql';
const GRAPHQL_BATCH = 100;   // aliases per request
const D1_BATCH = 50;         // statements per batch; D1 caps at 1000/invocation

// Repos we always measure, so the baseline does not depend on what HN
// happened to discuss this week.
const SEED = [
	'oven-sh/bun', 'ollama/ollama', 'ghostty-org/ghostty', 'zed-industries/zed',
	'astral-sh/uv', 'astral-sh/ruff', 'tursodatabase/turso', 'denoland/deno',
	'withastro/astro', 'cloudflare/workerd', 'vllm-project/vllm', 'pola-rs/polars',
	'duckdb/duckdb', 'tailwindlabs/tailwindcss', 'supabase/supabase', 'qdrant/qdrant',
];

const REPO_FIELDS = `
  nameWithOwner description homepageUrl createdAt pushedAt isArchived isFork
  stargazerCount forkCount watchers { totalCount }
  primaryLanguage { name } licenseInfo { spdxId }
  repositoryTopics(first: 10) { nodes { topic { name } } }
  issues(states: OPEN) { totalCount }
`;

function today() {
	return new Date().toISOString().slice(0, 10);
}

async function fetchReposGraphQL(slugs, token) {
	const out = [];
	for (let i = 0; i < slugs.length; i += GRAPHQL_BATCH) {
		const batch = slugs.slice(i, i + GRAPHQL_BATCH);
		const aliases = batch.map((slug, n) => {
			const [owner, name] = slug.split('/');
			return `r${n}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${REPO_FIELDS} }`;
		}).join('\n');

		const res = await fetch(GRAPHQL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'forktimes-ingest',
			},
			body: JSON.stringify({ query: `query { ${aliases} }` }),
		});
		if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}`);
		const body = await res.json();
		// Partial failures are normal here: a deleted or renamed repo nulls its
		// own alias while the rest of the batch succeeds. Keep what came back.
		for (const node of Object.values(body.data ?? {})) {
			if (!node) continue;
			out.push({
				slug: node.nameWithOwner,
				owner: node.nameWithOwner.split('/')[0],
				name: node.nameWithOwner.split('/')[1],
				description: node.description ?? null,
				homepage: node.homepageUrl ?? null,
				language: node.primaryLanguage?.name ?? null,
				license: node.licenseInfo?.spdxId ?? null,
				topics: JSON.stringify((node.repositoryTopics?.nodes ?? []).map((t) => t.topic.name)),
				repo_created_at: node.createdAt,
				pushed_at: node.pushedAt,
				is_archived: node.isArchived ? 1 : 0,
				is_fork: node.isFork ? 1 : 0,
				stars: node.stargazerCount,
				forks: node.forkCount,
				watchers: node.watchers?.totalCount ?? null,
				open_issues: node.issues?.totalCount ?? null,
			});
		}
	}
	return out;
}

/** Repos HN discussed recently, so the tracked set grows on its own. */
async function fetchHnCandidates(sinceDays = 7, minPoints = 50) {
	const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
	const params = new URLSearchParams({
		tags: 'story',
		numericFilters: `created_at_i>${since},points>${minPoints}`,
		hitsPerPage: '200',
	});
	const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`, {
		headers: { 'User-Agent': 'forktimes-ingest' },
	});
	if (!res.ok) return [];
	const body = await res.json();
	const found = [];
	for (const hit of body.hits ?? []) {
		const m = (hit.url ?? '').match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i);
		if (!m) continue;
		const owner = m[1].toLowerCase();
		if (['orgs', 'topics', 'trending', 'collections', 'sponsors', 'features'].includes(owner)) continue;
		found.push({
			slug: `${m[1]}/${m[2].replace(/\.git$/, '')}`,
			hn_id: String(hit.objectID),
			url: hit.url,
			title: hit.title,
			points: hit.points ?? 0,
			num_comments: hit.num_comments ?? 0,
			author: hit.author ?? null,
			created_at: hit.created_at,
		});
	}
	return found;
}

async function runInBatches(db, statements) {
	for (let i = 0; i < statements.length; i += D1_BATCH) {
		await db.batch(statements.slice(i, i + D1_BATCH));
	}
}

async function nightlySnapshot(env) {
	const observed = today();
	const now = new Date().toISOString();

	const tracked = await env.DB.prepare('SELECT slug FROM repos WHERE is_archived = 0').all();
	const hn = await fetchHnCandidates();
	const slugs = [...new Set([
		...(tracked.results ?? []).map((r) => r.slug),
		...hn.map((h) => h.slug),
		...SEED,
	])];

	const repos = await fetchReposGraphQL(slugs, env.GITHUB_TOKEN);

	const statements = [];
	for (const r of repos) {
		statements.push(
			env.DB.prepare(`
				INSERT INTO repos (slug, owner, name, description, homepage, language, license,
					topics, repo_created_at, pushed_at, is_archived, is_fork, first_seen, last_seen)
				VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
				ON CONFLICT(slug) DO UPDATE SET
					description=excluded.description, homepage=excluded.homepage,
					language=excluded.language, license=excluded.license, topics=excluded.topics,
					pushed_at=excluded.pushed_at, is_archived=excluded.is_archived,
					last_seen=excluded.last_seen
			`).bind(r.slug, r.owner, r.name, r.description, r.homepage, r.language, r.license,
				r.topics, r.repo_created_at, r.pushed_at, r.is_archived, r.is_fork, now)
		);
		// One row per repo per day. INSERT OR REPLACE so a retry after a partial
		// failure is idempotent rather than a primary-key error.
		statements.push(
			env.DB.prepare(`
				INSERT OR REPLACE INTO repo_snapshots (slug, observed_on, stars, forks, watchers, open_issues)
				VALUES (?1,?2,?3,?4,?5,?6)
			`).bind(r.slug, observed, r.stars, r.forks, r.watchers, r.open_issues)
		);
	}

	for (const h of hn) {
		statements.push(
			env.DB.prepare(`
				INSERT OR REPLACE INTO hn_mentions
					(hn_id, slug, url, title, points, num_comments, author, created_at, ingested_at)
				VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
			`).bind(h.hn_id, h.slug, h.url, h.title, h.points, h.num_comments, h.author, h.created_at, now)
		);
	}

	await runInBatches(env.DB, statements);
	return { observed, tracked: slugs.length, snapshotted: repos.length, hn: hn.length };
}

async function weeklyEdition(env) {
	const edition = today();

	// repo_velocity joins each snapshot to the one 7 days earlier. Repos
	// without both ends yet fall back to stars-per-age, which is computable
	// from a single observation.
	const { results } = await env.DB.prepare(`
		SELECT v.slug, v.stars, v.forks, v.stars_delta_7d, v.fork_ratio,
		       r.repo_created_at, r.language,
		       (SELECT MAX(points) FROM hn_mentions h
		         WHERE h.slug = v.slug AND h.created_at >= date('now','-7 days')) AS hn_points
		FROM repo_velocity v
		JOIN repos r ON r.slug = v.slug
		WHERE v.observed_on = ?1 AND r.is_archived = 0 AND r.is_fork = 0
		ORDER BY COALESCE(v.stars_delta_7d, 0) DESC
		LIMIT 30
	`).bind(edition).all();

	if (!results || results.length === 0) {
		return { edition, entries: 0, note: 'no snapshot for today; nothing to publish' };
	}

	// forks and stars_per_day are frozen into the row at compute time, not
	// re-derived at read time - see the comment on edition_entries in
	// schema.sql for why a published edition must not drift on rebuild.
	//
	// This can run again for the same date - a retry after a partial
	// failure, or a manual POST /run?job=edition - so ON CONFLICT refreshes
	// the numbers rather than erroring, but only `WHERE why_it_matters IS
	// NULL`. Once a human has written a note in /admin, that row has moved
	// from "still being computed" to "under review", and a recompute must
	// leave it alone rather than silently overwrite their work (title is
	// never touched here at all, for the same reason).
	const rows = results.map((r, i) => {
		const ageDays = Math.max(1, (Date.now() - new Date(r.repo_created_at).getTime()) / 86400000);
		const starsPerDay = r.stars ? r.stars / ageDays : null;
		return env.DB.prepare(`
			INSERT INTO edition_entries
				(edition, slug, rank, stars, forks, stars_delta_7d, stars_per_day, velocity, interest_score, why_it_matters)
			VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL)
			ON CONFLICT(edition, slug) DO UPDATE SET
				rank=excluded.rank, stars=excluded.stars, forks=excluded.forks,
				stars_delta_7d=excluded.stars_delta_7d, stars_per_day=excluded.stars_per_day,
				velocity=excluded.velocity, interest_score=excluded.interest_score
			WHERE edition_entries.why_it_matters IS NULL
		`).bind(edition, r.slug, i + 1, r.stars, r.forks, r.stars_delta_7d,
			starsPerDay, r.stars_delta_7d ?? null, Math.max(1, 10 - Math.floor(i / 3)));
	});
	// Leave the edition as a draft, not published. There is no deploy hook
	// here on purpose: publishing is a human running `npm run deploy` after
	// reviewing at /admin/<date>/ and marking it ready - a cron firing a
	// build the moment the slate is computed would ship it unedited, with
	// every why_it_matters still NULL. See "The database of record" in
	// AGENTS.md.
	//
	// DO NOTHING, not REPLACE: this runs again on a retry, and on a manual
	// `POST /run?job=edition` - if the edition already exists (a human may
	// already have marked it ready), overwriting it back to 'draft' would
	// silently unpublish their work.
	rows.push(
		env.DB.prepare(`INSERT INTO editions (edition, status) VALUES (?1, 'draft') ON CONFLICT(edition) DO NOTHING`).bind(edition)
	);
	await runInBatches(env.DB, rows);

	return { edition, entries: results.length, status: 'draft' };
}

// ─── subscriptions ──────────────────────────────────────────
//
// The list lives in Transmit (xmit.sh); this endpoint only hands it an
// address. Shapes are taken from Transmit's own MCP client rather than
// guessed: POST {base}/api/contacts, Bearer auth, {email, listId}.
//
// Confirmation and the welcome sequence are configured in the Transmit UI, so
// nothing here decides whether the address is real — it only decides whether
// the address is worth forwarding.

const XMIT_BASE = 'https://api.xmit.sh';

/** Deliberately permissive. Transmit validates properly; this rejects junk. */
function looksLikeEmail(value) {
	return typeof value === 'string' && value.length <= 254 && /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(value);
}

async function readSubmission(request) {
	const type = request.headers.get('content-type') ?? '';
	if (type.includes('application/json')) return await request.json();
	const form = await request.formData();
	return Object.fromEntries(form);
}

async function handleSubscribe(request, env) {
	if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

	let body;
	try {
		body = await readSubmission(request);
	} catch {
		return Response.json({ ok: false, error: 'malformed' }, { status: 400 });
	}

	// A hidden field real people never fill in. Bots fill everything, so a
	// non-empty value is answered with success and dropped on the floor —
	// telling a bot it failed only teaches it to try again.
	if (body.company) return Response.json({ ok: true });

	const email = String(body.email ?? '').trim().toLowerCase();
	if (!looksLikeEmail(email)) {
		return Response.json({ ok: false, error: 'invalid_email' }, { status: 400 });
	}

	if (!env.XMIT_API_KEY || !env.XMIT_LIST_ID) {
		console.error('XMIT_API_KEY / XMIT_LIST_ID not set; cannot record a subscription');
		return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
	}

	const res = await fetch(`${XMIT_BASE}/api/contacts`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.XMIT_API_KEY}`,
			'Content-Type': 'application/json',
			'User-Agent': 'theforktimes',
		},
		body: JSON.stringify({ email, listId: env.XMIT_LIST_ID }),
	});

	if (!res.ok) {
		const detail = (await res.text()).slice(0, 200);
		// An address already on the list is a success from the reader's side.
		if (res.status === 409) return Response.json({ ok: true, already: true });
		console.error(`Transmit ${res.status}: ${detail}`);
		return Response.json({ ok: false, error: 'upstream' }, { status: 502 });
	}

	return Response.json({ ok: true });
}

export default {
	async scheduled(event, env, ctx) {
		if (!env.GITHUB_TOKEN) {
			console.error('GITHUB_TOKEN is not set; refusing to run a crawl that would record nothing.');
			return;
		}
		const job = event.cron === '0 12 * * 2' ? weeklyEdition : nightlySnapshot;
		ctx.waitUntil(
			job(env)
				.then((r) => console.log(`${event.cron} ok:`, JSON.stringify(r)))
				.catch((err) => console.error(`${event.cron} failed:`, err.message))
		);
	},

	// Manual trigger for backfills and testing, guarded by the same token.
	// Everything else - static assets, and the SSR /admin/* routes - is
	// Astro's, via the adapter's own handler.
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === '/subscribe') return handleSubscribe(request, env);

		if (url.pathname === '/run') {
			if (request.headers.get('authorization') !== `Bearer ${env.GITHUB_TOKEN}`) {
				return new Response('unauthorized', { status: 401 });
			}
			const job = url.searchParams.get('job') === 'edition' ? weeklyEdition : nightlySnapshot;
			return Response.json(await job(env));
		}

		return handle(request, env, ctx);
	},
};
