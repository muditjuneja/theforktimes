# The Fork Times — working notes

## What this project is

A ranked open source discovery site presented as a newspaper. The ranked
numbers are a commodity — gitstar-ranking, ossinsight, trendshift and
star-history all publish them. **The editorial judgement is the product.**
Every change should be measured against that: does it make the judgement
better, or does it just add more numbers?

## Development

```bash
npm run dev      # http://localhost:4321 - reads local D1 (.wrangler/state)
npm run build    # runs scripts/generate-latest.js, then astro build
```

When starting the dev server for a long session, use background mode
(`astro dev --background`, managed with `astro dev stop|status|logs`).

Verify `npm run build` passes before committing. If a build error traces to
one entry, the fix is in D1 (`/admin`, or `wrangler d1 execute forktimes
--local --command "..."` ), not a file - there is no `src/content/repos/`
anymore; see "The database of record" below.

A first-time local setup needs a schema, since `.wrangler/state` starts empty:

```bash
wrangler d1 execute forktimes --local --file=scripts/schema.sql
```

## The database of record

**D1 is the source of truth for every measurement and every edition. There is
no markdown fallback.** `src/content/repos/` does not exist; the `repos`
content collection loads from D1 via `src/lib/d1-loader.ts` and
`src/lib/edition-data.ts`, which every page that calls `getCollection('repos')`
goes through unchanged. `scripts/lib/d1.js` is the equivalent for the Node
scripts (`ingest.js`, `issue.js`, `tweet.js`, `blurbs.js`): it shells out to
`wrangler d1 execute` rather than hand-rolling the D1 HTTP API, so those
scripts reuse whatever Cloudflare auth `wrangler deploy` already needs instead
of asking for a second one. Local by default; `D1_REMOTE=1` (which `npm run
deploy` sets) points either client at the real, deployed database instead.

READMEs are the one exception and stay files under `src/content/readmes/` -
they are a fetched cache, not editorial, and `render()` still works for them
the way it always did.

**Publishing is a human running `npm run deploy`, never automatic.** The
weekly cron computes an edition into D1 and leaves it `draft`; the build
(`src/lib/edition-data.ts`) only ever reads `editions.status = 'ready'`, so a
deploy triggered for any reason - a copy fix, nothing to do with the
newsletter - can never ship a half-edited draft. Review and edit an edition,
including marking it ready, at `/admin/<date>/` (see "The admin portal"
below); there is no other review surface. `edition_entry_revisions` is an
append-only undo trail for `/admin`'s hand-edited fields (title,
why_it_matters), the same thing git history gave the old markdown files for
free.

## Ingestion

Candidate discovery, GitHub enrichment and ranking happen in D1, not in a
Node script - `worker/index.js`'s `nightlySnapshot()` (crons nightly) and
`weeklyEdition()` (crons Tuesday, or by hand: `POST /run?job=edition`) talk to
the GitHub GraphQL API and D1 directly. That runtime is deliberately
self-contained rather than sharing code with the scripts below: the Worker has
different constraints (subrequest caps, D1 statement batching, no filesystem),
and pretending otherwise would make both harder.

```bash
node scripts/ingest.js --date 2026-09-14
```

What is left for `ingest.js` is the one thing the Worker cannot do: write
files. It fetches the README and a sampled star history for every repo
already in that date's D1 edition, and writes them under
`src/content/readmes/`. Set `GITHUB_TOKEN` - READMEs work unauthenticated
(`raw.githubusercontent.com`), but star history needs it (stargazers API
pagination).

`scripts/schema.sql` is the D1 schema. `repo_snapshots` is load-bearing: the
nightly job must write one row per tracked repo per day even when nothing
changed, because GitHub exposes only *current* star counts. A gap in that
table is a permanent gap in the rankings — no backfill can reconstruct it.
`edition_entries` freezes `stars`, `forks`, `stars_delta_7d` and
`stars_per_day` at the moment an edition is computed, and reads must use those
columns rather than recomputing from `repos`/`repo_snapshots` - a published
edition has to read the same tomorrow as it did today, and `stars_per_day`
especially would otherwise silently drift lower on every rebuild (it is stars
over days-since-creation, and "now" keeps moving). `editions.status` is the
publishing gate described above.

## The headline number

**Star velocity — stars gained over the last seven days.** Not raw star count,
which reproduces a list everyone already has and rewards decade-old
incumbents for work they did years ago.

Velocity needs two snapshots a week apart. On a cold database the ranking
falls back to `stars_per_day` (stars ÷ repo age), which is computable from a
single observation and still favours fast-growing young projects over
incumbents. The byline says which one it used; never present one as the other.

## Writing `why_it_matters`

This is the product. It is a **specific claim about why this repo earned its
place in this edition**, not a summary of the README.

A blurb is good when a reader who already knows the project still learns
something from it. It is bad when it could be generated from the repo
description alone — if so, the reader could have read the description.

**Do:**
- Name what changed and why it moved *now*. A repo in the edition is there
  because it moved; say what happened.
- Be concrete about the engineering: the tradeoff, the design decision, the
  thing it does that its alternatives do not.
- Use the numbers as evidence for a claim, not as the claim. "Forks running at
  three times the usual rate for its star count, which suggests people are
  deploying it, not just bookmarking it" beats "10k forks".
- Stay in the 2–4 sentence range. This is a newspaper column, not a review.

**Don't:**
- Restate the repo description in different words.
- Use "powerful", "seamless", "game-changing", "revolutionary", "blazingly
  fast", or any phrase a launch post would use.
- Manufacture significance. Some repos trend because they are funny. Say that
  plainly rather than inventing technical importance for them — velocity
  ranking *will* surface joke repos, and pretending otherwise costs trust.
- Claim anything the data does not support. If we don't know why it moved,
  the honest blurb says the movement is unexplained.

```bash
npm run blurbs -- --date 2026-09-14              # needs OPENROUTER_API_KEY
npm run blurbs -- --date 2026-09-14 --dry-run    # inspect prompts, no spend
```

**Model:** `anthropic/claude-opus-5` through OpenRouter (`scripts/blurbs.js`).
Routing through OpenRouter keeps the model a config value rather than a code
change, which matters because the blurb prompt is the single thing most worth
A/B testing. Pricing matches first-party ($5/$25 per MTok), and the `:batch`
suffix (`anthropic/claude-opus-5:batch`) is half price and asynchronous, which
suits the nightly cron.

Roughly 30 blurbs per edition puts a run around $0.45, so quality is the only
real consideration - do not trade it for a cheaper model without measuring.
The style guide is held in one byte-stable constant and sent with a
`cache_control` breakpoint so it is a reusable cache prefix across a run;
editing it invalidates that cache, which is fine but worth knowing.

`weeklyEdition()` leaves `why_it_matters` `NULL` rather than inventing a
blurb, so an edition is never silently shipped with fabricated editorial
claims - `/admin` and `hasEditorialNote()` (`src/lib/meta.ts`) both treat a
`NULL` the same as the old file-based placeholder text, so the guarantee is
unchanged even though the mechanism is. `blurbs.js` only overwrites an entry
that is still `NULL` or carries the (legacy, from a backfilled edition)
placeholder text, unless given `--force`, so a hand-edited blurb is never
clobbered.

## Content schema

`src/content.config.ts` defines the `repos` collection. One entry = one repo
in one dated (`ready`) edition, loaded from D1 by `src/lib/d1-loader.ts`
rather than glob'd off disk - see "The database of record" above.

The `repo` field (not `slug` - Astro's content loader treats a `slug`
frontmatter key as the entry id) is still what most code reads; the loader
sets the actual entry id to `${edition}/${rank}-${dashed-slug}` purely so it
still reads like the old file path, since `dayOf()` (`src/lib/editions.ts`)
still splits it on `/` to get the edition date.

Fields that drive the newspaper layout (`title`, `source`, `section`,
`interest_score`, `tags`, `authors`, `image`) deliberately keep the names the
layout already expects, so the edition rendering carries over unchanged. Repo
measurements are added alongside them. There is no `Content`/`render()` for a
`repos` entry any more - `StoryBody.astro` renders the equivalent facts line
straight from the schema fields, since a D1 row has no markdown body.

## Taxonomy, beats and alternatives

`src/data/taxonomy.ts` is curated on purpose. Industry and "alternative to"
are exactly the judgements the ranked-numbers sites do not make, so they are
not inferred from topics alone: a keyword pass handles the long tail and the
curated table overrides it wherever a human has made a call.

An `alternative_to` entry is a public claim. It belongs to projects that
genuinely replace the named product for a real use case - not every project
whose feature list overlaps with it.

AI is a first-class beat with its own second level (`ai_category`), because a
flat list of every AI repo is not useful to anyone.

Routes:
- `/repo/<owner>/<name>/` - stats, star history, why it matters, README
- `/industry/<industry>/` - one beat, ranked; the AI page groups by category
- `/alternatives/` - every proprietary tool we claim a substitute for

## READMEs

Fetched from `raw.githubusercontent.com` into the `readmes` collection, one
file per repo rather than one per edition.

Two things matter when touching this. READMEs address their assets relative to
the repository root, so every relative link and image is rewritten to an
absolute GitHub URL at ingest time - without that, Astro fails the entire
build hunting for a local file that was never ours. And Astro's glob loader
slugifies ids, which lowercases them, so README files are written under
lowercased names to stay findable by `getEntry`.

## Star history

`src/components/StarGraph.astro` draws from real observations only, and
renders nothing below two points - a single observation can only produce a
straight line from zero, which would look like history while carrying none.

GitHub never exposes historical star counts. The curve is backfilled on a
repo's first appearance by paging the stargazers API with the
`application/vnd.github.star+json` media type, which carries a `starred_at`
per entry; that is one request per 100 stars, so pages are sampled rather than
walked. Pagination caps at 400 pages. Thereafter `repo_snapshots` is the
source.

## Posting to X

**`/admin/<date>/post/`** does this from the browser: generate a draft (same
voice/prompt as the CLI - both import `scripts/lib/post-draft.js`), edit it
in place if needed, a GitHub-card preview, then Post. It covers the CLI's
zero-flag default only - no `--candidates`, `--repo`, `--card fork` or
`--link`; reach for the CLI for those. The one thing it does that the CLI
cannot: the draft persists in D1 (`edition_posts`) rather than being
generated fresh every run, so a page refresh does not cost a second
OpenRouter call, and - the actual point - a human always posts exactly the
text they last saw, never a silently re-rolled variant.

Posting is still exactly as irreversible from the browser as it is from the
terminal, so the same guard applies without exception (refuses while any
entry lacks an editorial note), and `edition_posts.post_claimed_at` is an
atomic, read-verified claim that makes a double post structurally
impossible - not just unlikely - rather than a client-side debounce or a
disabled button. See the comment on `edition_posts` in `scripts/schema.sql`
and `claimPost()`/`recordPosted()`/`clearFailedClaim()` in
`src/lib/admin-db.ts` before touching any of it: the claim step has to stay
the very last check before the network call, and a successful `postTweet()`
must always end up recorded (even with a fabricated `posted_tweet_id` in the
one edge case where X's own response cannot be parsed) rather than ever
leaving the claim to be released after a post has actually gone out - that
would let a retry send the same text again, for real, against an edition
that is already live.

Runs inside the Worker, a different runtime from the CLI's plain Node, which
needed two things: `"compatibility_flags": ["nodejs_compat"]` in
`wrangler.jsonc`, Worker-wide, so `scripts/lib/x.js`'s `node:crypto` OAuth
signing and `scripts/lib/shot.js`'s `Buffer` handling work unmodified,
reusing rather than re-deriving security-sensitive signing code already
verified against X's own test vector; and a `/* @vite-ignore */` on
`shot.js`'s `import('playwright')` - without it, the adapter's build tries to
bundle Playwright's own native internals for the Workers target and fails
outright, even though that branch can never run in a Worker (the route
always forces `pickBackend(env, 'kitesurf')`, never the bare default-arg
form, since `process.env` is not implicitly populated by plain
`nodejs_compat`).

```bash
npm run tweet -- --date 2026-09-14                 # draft only, the default
npm run tweet -- --date 2026-09-14 --candidates 3  # three options to choose from
npm run tweet -- --date 2026-09-14 --image         # attach the GitHub page
npm run tweet -- --date 2026-09-14 --image --card fork   # our page instead
npm run tweet -- --date 2026-09-14 --link          # opt back into a URL
npm run tweet -- --date 2026-09-14 --image --post  # actually publish
```

**Publishing is opt-in and stays that way.** A post goes out publicly as the
masthead and cannot meaningfully be retracted, so the default is to print a
draft and stop. `--post` is the only thing that sends. It refuses outright if
any entry in the edition still has no editorial note in D1 (`NULL`, or the
legacy placeholder text on a backfilled edition) - announcing an unedited
edition is worse than not posting.

**Pricing drives the design.** X removed its free tier in February 2026 and
bills per request: **$0.015 for a plain post, $0.20 for a post containing a
URL** - a 13x surcharge added in April 2026. One linked post per weekly
edition is under a dollar a month; a linked post per repo is not. `--no-link`
exists for that reason, and every draft prints its own estimated cost.

**Posts carry a card, not a link.** `--image` attaches a 1200x675 screenshot.
This sidesteps both problems at once: no URL means no $0.20 surcharge (a media
post is $0.015) and none of the reach penalty X applies to link-bearing posts.
`--link` still exists to opt back in.

**The default card is the repository's own GitHub page**, not ours. Developers
recognise the GitHub chrome instantly, and it shows the project as its
maintainers present it rather than as we reframe it. Our voice and our number
ride in the post text, so the brand comes through the words rather than the
picture. `--card fork` switches to a card of our repo page instead.

A logged-out GitHub page carries a cookie banner, a sign-in dialog and a promo
header, all of which land inside the 675px crop and say nothing about the
repository. `GITHUB_CARD_CSS` strips them before capture.

Cards are rendered by `scripts/lib/shot.js`, which has two interchangeable
backends. **Kitesurf** (Cloudflare Browser Run, free in beta) is the production
path. **Playwright** is the local fallback. Both accept a URL or raw HTML, and
both take an `injectCss` payload.

`pickBackend()` picks Kitesurf whenever Cloudflare credentials are present and
falls back to Playwright when they are not. That fallback is silent, which is
fine locally and dangerous in a scheduled job - so pass `--backend kitesurf`
anywhere the browser actually matters, and a missing credential becomes an
error instead of a quiet downgrade.

Kitesurf returns PNG bytes on success but Cloudflare's JSON envelope on
failure, sometimes with HTTP 200. `shootKitesurf` sniffs the content type
rather than assuming binary, handles a base64-in-envelope response, and checks
the PNG magic number before returning. Without that, an error body is passed
on as a "PNG" and only fails later at X's media endpoint, with a message about
the image being invalid rather than about the token being wrong.

Note for anyone testing in a sandboxed container: Chromium there often cannot
reach the public internet (the agent proxy resets the connection, and
github.com is blocked outright), so the GitHub card can only be exercised from
an environment with real egress - or from Kitesurf, which runs on Cloudflare's
network and has no such restriction. `screenshot({ url })` and `injectCss` are
verified against a locally served page, and the Kitesurf response handling is
verified against stubbed responses, but no real Kitesurf call has been made
yet.

`--card fork` reads the built page out of `dist/client/` (the adapter's static
half - see "Deployment" - not `dist/server`), inlines its stylesheets and
layers on `CARD_CSS`. That lives in the screenshot step rather than the site's
stylesheet on purpose: the repo page is built to be read, a timeline card is
glanced at. Everything past the editorial claim is noise at card size, and the
page's reading measure leaves most of a 2:1 frame empty.

Alt text is generated from the repo's real figures and is not optional - a card
whose content is text is invisible to a screen reader without it.

**Auth** is OAuth 1.0a user context, not OAuth 2.0 PKCE: this posts as exactly
one account we own, so PKCE would add a refresh-token dance and a callback URL
for no benefit. Four secrets, none of which belong in the repo:
`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`.

That choice constrains media uploads, and the constraint is not obvious:
**OAuth 1.0a cannot reach `/2/media/upload`**, which requires an OAuth 2.0
token with `media.write`. Media therefore goes to the v1.1 host
(`upload.x.com/1.1/media/upload.json`), which still accepts 1.0a. Mixing them
up produces a 401 that reads like bad credentials. The upload is sent as
`multipart/form-data` so the body stays out of the signature base string, the
same rule that applies to the JSON post body.

One trap in `scripts/lib/x.js`: the request body is deliberately **excluded**
from the OAuth signature base string. Only form-encoded bodies are signed, and
this endpoint takes JSON - signing the JSON yields a 401 that reads like a
credentials problem and will cost you an afternoon. The percent-encoding and
HMAC-SHA1 signing are verified against X's own published test vector.

**Voice.** A broadsheet reporting on open source as civic news: deadpan,
precise, faintly amused. The humour is in the register - treating repo drama
with front-page gravity - and in exact numbers used well. Never puns, never
exclamation marks, never telling the reader something is interesting. No
hashtags, no emoji, no thread markers, no "here's why". The same rule as the
blurbs applies hardest here: if a repo is trending because it is a joke,
report that straight and let it be funny on its own.

## Deployment (Cloudflare Workers)

```bash
npm run deploy       # astro build && wrangler deploy
npm run preview:cf   # build, then serve through wrangler locally
```

**Workers with static assets, not Pages** - Cloudflare recommends Workers for
new projects and Pages is the legacy path. The site itself is still fully
prerendered; `@astrojs/cloudflare` is in only for `/admin/*`, which sets
`export const prerender = false` and needs a runtime. Its build splits `dist/`
into `dist/client/` (static assets - what `wrangler.jsonc`'s `assets.directory`
points at) and `dist/server/` (the SSR entry for `/admin`).

**One Worker does everything**: serves the site, runs `/admin`, holds the D1
binding, runs both crons. `wrangler.jsonc` at the root is the whole
deployment. `main` stays `worker/index.js` - our own file, not an
Astro-generated one - so it can own `fetch` for `/subscribe` and `/run` and
delegate everything else (static assets, and `/admin`) to the adapter's own
handler:

```js
import { handle } from '@astrojs/cloudflare/handler';
// ...
async fetch(request, env, ctx) {
  if (/* our own routes */) { /* ... */ }
  return handle(request, env, ctx);   // static assets + /admin, Astro's
},
```

`wrangler dev`/`deploy` detect this and transparently swap in the build's own
regenerated config (`dist/server/wrangler.json`) for whatever it computes
itself (`assets.directory` among it) - `wrangler.jsonc` is what a human edits;
that file is derived from it plus the build output, every build.

**`/admin/*` needs to sit behind Cloudflare Access** (Zero Trust) in
production - nothing in the app itself authenticates a request.

This was briefly split into two Workers on the theory that redeploying the
site would disturb the one owning the database. It does not - D1 is a separate
resource and the binding just points at it, so a redeploy never touches the
data. The split cost two configs, two deploys and two places to drift, and
bought nothing at this size.

The one real consequence of merging: a broken site deploy now takes the
nightly crawl with it, and a missed snapshot is the only unrecoverable failure
here. That is a monitoring problem, not an architecture one - watch the cron's
observability logs rather than splitting the Worker again.

Static requests match `dist/client` first, same as before; `/subscribe` and
`/run` are claimed before that; everything else - `/admin` included - falls
through to the adapter's `handle()`, which is how the static site, the admin
portal and the custom endpoints coexist in one Worker.

`public/_headers` replaces what `vercel.json` used to do. `/md` and `/json` are
the extensionless exports from `generate-latest.js`; without an explicit
`Content-Type` Wrangler cannot infer a MIME type from the filename and serves
them as downloads.

**`_headers` rules are additive, not overriding.** Every matching rule
contributes its headers, so a `Cache-Control` in the `/*` catch-all gets
appended to the specific ones and yields
`max-age=31536000, immutable, public, max-age=600`. Caching is therefore
declared only on specific paths and `/*` carries security headers alone. HTML
is left to the platform default (`max-age=0, must-revalidate`), which is what
the homepage needs since it mirrors whichever edition is latest.

## Scheduled ingestion (worker/index.js)

The same Worker that serves the site, on two cron triggers. `wrangler.jsonc`
carries both.

```
0 3 * * *     nightly   snapshot every tracked repo into D1
0 12 * * 2    Tuesday   compute the edition into D1, leave it as a draft
```

The weekly cron does not deploy anything - it only writes `edition_entries`
and an `editions` row with `status = 'draft'`. Publishing is always a human
running `npm run deploy`, at a time of their choosing, after reviewing (and
marking ready) at `/admin` - see "The database of record" and "The admin
portal".

**Crawl nightly, publish weekly - these are different cadences and conflating
them is the trap.** The nightly snapshot cannot be skipped: GitHub exposes only
*current* star counts, so a night without a row in `repo_snapshots` is a
permanent hole that no backfill can fill. Publishing is weekly because velocity
is a 7-day window, so consecutive daily editions would share six of their seven
days of input and rank almost identically - you would be shipping duplicates.
Tuesday, so weekend Hacker News threads have settled, which is also what the
footer's "editions close two days back" note promises.

Setup:

```bash
wrangler d1 create forktimes                   # put the id in wrangler.jsonc
wrangler d1 execute forktimes --remote --file=scripts/schema.sql
wrangler secret put GITHUB_TOKEN               # PAT with public_repo
npm run deploy
```

Needs the **Workers Paid** plan. The free plan's 10ms CPU and 50 subrequests
per invocation cannot complete a crawl of any size; paid gives 15 minutes of
wall time on a >=1h cron and 10,000 subrequests.

Implementation notes:
- The scheduled handler is self-contained rather than importing
  `scripts/lib/sources.js`. The runtimes have genuinely different constraints
  (subrequest caps, D1 statement batching, no filesystem) and sharing would
  make both worse.
- Snapshot writes are `INSERT OR REPLACE`, so re-running a night after a
  partial failure is idempotent rather than a primary-key error.
- Statements are batched 50 at a time; D1 caps at 1,000 queries per invocation,
  so a per-repo loop would fail well before the tracked set is covered.
- A GraphQL batch tolerates partial failure: a deleted or renamed repo nulls
  its own alias while the rest of the batch succeeds, so nulls are skipped
  rather than aborting the run.
- `POST /run` (with `Authorization: Bearer $GITHUB_TOKEN`) triggers either job
  by hand for backfills; `?job=edition` selects the weekly one.

## The admin portal

`src/pages/admin/` - the only editorial review surface (see "The database of
record"). Server-rendered (`export const prerender = false`), reading and
writing D1 directly through the `DB` binding via `cloudflare:workers`' `env`
export (not `Astro.locals.runtime.env`, which this version of the adapter has
removed).

**Every `/admin/*` request is gated by `src/middleware.ts`** - a shared
password (`ADMIN_PASSWORD`) and a signed session cookie (`ADMIN_SESSION_SECRET`,
`src/lib/admin-auth.ts`), not Cloudflare Access: Access is a dashboard-level
policy this codebase cannot see or verify is actually configured, so it was
never a guarantee the app itself could stand behind - this is. One shared
secret rather than a user table on purpose: this is a single-operator tool,
and accounts/password-resets would solve a problem that does not exist here.
The session is a stateless HMAC-signed cookie (`node:crypto`, already enabled
Worker-wide via `nodejs_compat` for the X OAuth signing - see "Posting to
X"), not a D1-backed session: per-session revocation does not matter for one
operator, and this avoids a DB round trip on every admin request. Missing
either secret fails *closed* - `/admin/*` refuses every request with a plain
500 rather than ever serving unauthenticated, the same instinct as
`pickBackend()`'s missing-credential handling below. `/admin/login` is the
one path the middleware lets through unauthenticated; `/admin/logout`
(POST-only, linked from `/admin`) clears the cookie. Nothing stops layering
Cloudflare Access on top later for defense in depth, but nothing here depends
on it anymore.

- `/admin` - every edition, its status, and how many entries still need a
  human.
- `/admin/<date>/` - the slate: reorder (buttons, not drag-and-drop - this is
  a single-operator tool behind the password gate above, so the
  plain-POST-form baseline Subscribe.astro also uses is where it stops
  rather than adding a JS layer on top), drop an entry, edit
  `title`/`why_it_matters` in place, mark ready. Every edit lands in D1
  immediately and changes nothing public.
- **Mark ready** refuses while any entry is still unedited, the same guard
  `tweet.js --post` already enforces, applied one step earlier. Reversible:
  flip back to draft and the next deploy stops including it.
- All mutations go through `src/lib/admin-db.ts`, not ad hoc SQL in the
  pages. Two things there are easy to get wrong a second time if this is ever
  rewritten: reordering has to recompute `interest_score` for the *whole*
  edition, not just the two rows that moved, because the site sorts by score
  and a stale score elsewhere in the list can silently outrank a row that
  should not be outranked; and every hand-edited field writes to
  `edition_entry_revisions` first so the edit is undoable.

Plain POST forms with no client JS, each redirecting back to itself
(POST/redirect/GET) - a refresh never resubmits a write. Astro's own
same-origin check on POST already rejects cross-site submissions, so there is
no separate CSRF token here; that check is what a bare `curl` without an
`Origin` header trips, not a bug.

## The spine

**The Fork Times is a weekly email. The website is its archive and its funnel.**

Everything else is arranged behind that:

- The unit of product is the **issue**, not the page. One email a week; the
  site holds the permalink.
- Success is **subscribers**, not pageviews.
- `/alternatives/` is the **acquisition engine**, not a second product. It
  ranks for "open source alternative to X", captures an address, and hands off.
- **X is top-of-funnel awareness**, not a destination. This is why posts carry
  a card rather than a link and why that is fine.
- The `why_it_matters` blurbs are **the newsletter body**. They are not a
  website feature; they are the thing people subscribe to.

What that deprioritises, on purpose: repo pages (they duplicate a README and
lose to GitHub on GitHub's own content — keep them thin as permalinks), the
star graph, and beat pages. None of them serve the loop. The "live
leaderboards" idea from the original brief is dead under this spine.

## The issue

```bash
npm run issue -- --date 2026-09-14     # writes .issues/<date>.html and .txt
```

Composing and sending happen in the **Transmit (xmit.sh) UI** — this only
renders the body, because a weekly issue is the one thing worth a human
looking at before it reaches a real list. The command prints a suggested
subject line and warns when entries still lack an editorial note. Reads the
edition from D1 by date regardless of its `draft`/`ready` status, unlike the
site build - previewing an issue is part of how you decide it is ready.

Email is not the web, and the constraints are unforgiving: no flexbox, no
grid, no external stylesheet, no web font — Outlook renders with Word's engine
and drops all four silently. Layout is tables with inline styles at 600px.

The register survives that intact by luck of two choices: **Georgia ships
old-style numerals by default** (one of very few web-safe faces that does), so
the defining typographic decision holds with no webfont; and Roman numerals are
just text. `{{unsubscribe}}` is left for Transmit to substitute.

## Subscriptions

`POST /subscribe` on the Worker forwards to Transmit. Shapes were taken from
Transmit's own MCP client source rather than guessed: `POST {base}/api/contacts`
with `{ email, listId }` and `Authorization: Bearer <key>`.

Secrets: `XMIT_API_KEY`, `XMIT_LIST_ID`. **Confirmation and the welcome
sequence are configured in the Transmit UI**, not here — which is why the
success copy says "check your inbox to confirm" and never claims the issue has
arrived.

The form works without JavaScript (a plain POST reaches the endpoint) and is
enhanced so the page does not navigate away — whatever brought a reader to an
alternatives page, sending them to a blank success screen loses them. A
honeypot field answers bots with success and drops the submission; telling a
bot it failed only teaches it to retry.

Verified against `wrangler dev`: unset secrets give 503 `not_configured`, a bad
address 400, a filled honeypot 200 with nothing forwarded, GET 405, and static
assets still serve with their `_headers` rules intact.
