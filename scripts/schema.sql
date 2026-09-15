-- The Fork Times - D1 schema
--
-- Design note: `repo_snapshots` is the load-bearing table. Everything
-- editorial (velocity, "biggest mover", momentum) is derived by comparing
-- two snapshots, so the nightly job must write one row per tracked repo per
-- day even when nothing changed. Gaps in this table become gaps in the
-- rankings that no later backfill can reconstruct, because the GitHub API
-- exposes only current star counts, never historical ones.

-- Slow-changing repo identity and metadata. One row per repo, overwritten.
CREATE TABLE IF NOT EXISTS repos (
  slug            TEXT PRIMARY KEY,   -- "oven-sh/bun"
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  homepage        TEXT,
  language        TEXT,
  license         TEXT,
  topics          TEXT,               -- JSON array
  repo_created_at TEXT NOT NULL,      -- ISO8601; drives age-adjusted ranking
  pushed_at       TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  is_fork         INTEGER NOT NULL DEFAULT 0,
  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_language ON repos(language);

-- The stars-delta table. Append-only, one row per repo per observation day.
CREATE TABLE IF NOT EXISTS repo_snapshots (
  slug        TEXT NOT NULL,
  observed_on TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  stars       INTEGER NOT NULL,
  forks       INTEGER NOT NULL,
  watchers    INTEGER,
  open_issues INTEGER,
  PRIMARY KEY (slug, observed_on),
  FOREIGN KEY (slug) REFERENCES repos(slug)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_day ON repo_snapshots(observed_on);

-- Hacker News signal, from the Algolia search API. This is the cross-source
-- edge: star counts say a repo grew, HN says people argued about it.
CREATE TABLE IF NOT EXISTS hn_mentions (
  hn_id        TEXT PRIMARY KEY,
  slug         TEXT,                  -- resolved repo, NULL if not a repo URL
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  points       INTEGER NOT NULL,
  num_comments INTEGER NOT NULL,
  author       TEXT,
  created_at   TEXT NOT NULL,
  ingested_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hn_slug ON hn_mentions(slug);
CREATE INDEX IF NOT EXISTS idx_hn_created ON hn_mentions(created_at);

-- What actually shipped in each edition. Kept so a published edition stays
-- reproducible even after the underlying numbers move on.
-- forks and stars_per_day are frozen here for the same reason stars and
-- stars_delta_7d are: a published edition must read the same tomorrow as it
-- did today. stars_per_day in particular is stars / days-since-creation - if
-- it were recomputed against the *current* date on every rebuild instead of
-- read from here, a past edition's own number would silently drift lower
-- every time the site rebuilds, which is exactly the "reproducible" promise
-- this table exists to keep. fork_ratio is not stored because it has no such
-- time dependency - it is safe to derive from stars/forks at read time.
CREATE TABLE IF NOT EXISTS edition_entries (
  edition        TEXT NOT NULL,       -- YYYY-MM-DD
  slug           TEXT NOT NULL,
  rank           INTEGER NOT NULL,
  title          TEXT,
  stars          INTEGER NOT NULL,
  forks          INTEGER,
  stars_delta_7d INTEGER,
  stars_per_day  REAL,
  velocity       REAL,
  interest_score INTEGER,
  why_it_matters TEXT,
  PRIMARY KEY (edition, slug)
);

CREATE INDEX IF NOT EXISTS idx_edition ON edition_entries(edition);

-- Publishing gate. The weekly cron computes a slate and leaves it 'draft';
-- the static build only ever reads 'ready' editions (src/lib/d1-loader.ts),
-- so a deploy triggered for any reason can never ship a half-edited draft.
-- Publishing itself stays a human running `npm run deploy` - there is no
-- column here for "deployed", only "safe to deploy if it happens".
CREATE TABLE IF NOT EXISTS editions (
  edition      TEXT PRIMARY KEY,               -- YYYY-MM-DD
  status       TEXT NOT NULL DEFAULT 'draft',  -- draft | ready
  published_at TEXT
);

-- Append-only undo trail for admin edits to edition_entries. What git's
-- history gave the old markdown-file workflow for free, kept for the fields
-- an editor actually hand-edits.
CREATE TABLE IF NOT EXISTS edition_entry_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  edition    TEXT NOT NULL,
  slug       TEXT NOT NULL,
  field      TEXT NOT NULL,          -- 'title' | 'why_it_matters' | 'rank'
  old_value  TEXT,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revisions_entry ON edition_entry_revisions(edition, slug);

-- The X (Twitter) post for a given edition, drafted and published from
-- /admin/<date>/post/ - see AGENTS.md "Posting to X". One row per edition,
-- created when a draft is first generated.
--
-- draft_* lets a page refresh reuse the already-reviewed text instead of a
-- second OpenRouter call - and, more importantly, means the human reviewing
-- a draft is guaranteed to post the exact text they read, not a silently
-- re-rolled variant.
--
-- post_claimed_at is an atomic claim, set immediately before the X call:
-- claimPost() (src/lib/admin-db.ts) succeeds only if it actually flips this
-- from NULL, so a losing concurrent request (a double click, a retry) is
-- refused before any network call happens at all - this is the real
-- double-post guard, not the UI. Cleared back to NULL if the X call fails,
-- so a genuine retry is not locked out. Left set with no posted_tweet_id
-- only if a request dies mid-flight (a hard timeout) without reaching
-- either cleanup; /admin surfaces that as a stuck attempt and requires a
-- human to clear it explicitly rather than guessing whether it went out.
--
-- posted_* is the durable record of what actually shipped, written exactly
-- once by a successful postTweet() and never overwritten after - both
-- saveDraft()'s upsert and recordPosted() are WHERE posted_tweet_id IS
-- NULL, the same "never clobber a finalized row" idiom weeklyEdition() uses
-- for why_it_matters.
CREATE TABLE IF NOT EXISTS edition_posts (
  edition              TEXT PRIMARY KEY,
  subject_slug         TEXT NOT NULL,      -- entry the draft/card is about (edition lead, for now)
  draft_text           TEXT,
  draft_model          TEXT,
  draft_generated_at   TEXT,
  post_claimed_at      TEXT,
  posted_tweet_id      TEXT,               -- set once, only after X confirms
  posted_text          TEXT,
  posted_media_id      TEXT,
  posted_cost_estimate REAL,
  posted_at            TEXT
);

-- Seven-day velocity for a given edition date, with the age-adjusted
-- fallback for repos that do not yet have two snapshots a week apart.
CREATE VIEW IF NOT EXISTS repo_velocity AS
SELECT
  cur.slug,
  cur.observed_on,
  cur.stars,
  cur.forks,
  prev.stars                                  AS stars_7d_ago,
  cur.stars - prev.stars                      AS stars_delta_7d,
  CAST(cur.forks AS REAL) / NULLIF(cur.stars, 0) AS fork_ratio
FROM repo_snapshots cur
LEFT JOIN repo_snapshots prev
  ON prev.slug = cur.slug
 AND prev.observed_on = date(cur.observed_on, '-7 days');
