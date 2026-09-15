# The Fork Times

A curated, ranked open source discovery site, presented as a newspaper rather than a dashboard.
Top repos, biggest movers, and the editorial context for why each one matters.

- Site: [theforktimes.com](https://theforktimes.com)
- X: [@forktimeshq](https://x.com/forktimeshq)

## Why this exists

Ranked repo data is a commodity. gitstar-ranking, ossinsight, trendshift and star-history
all publish the numbers already. The Fork Times is built on the premise that the numbers
are the easy part and the judgement is the product: every repo that makes an edition gets
a short, specific answer to "why does this matter?"

The headline number is **star velocity** — stars gained over the week — not raw star count,
which just reproduces a list everyone already has.

## Development

Requires Node.js >= 22.12.0. D1 holds every measurement and every edition -
see `AGENTS.md`'s "The database of record" - so a first-time setup needs a
local database before there's anything to look at:

```bash
npm install
wrangler d1 execute forktimes --local --file=scripts/schema.sql
npm run dev      # http://localhost:4321 - reads that local D1
npm run build    # writes ./dist/client (static) and ./dist/server (the /admin SSR worker)
```

A fresh local D1 has the schema but no rows, so the site and `/admin` will
both be empty until something writes an edition into it - either a real
`node scripts/ingest.js`/cron run against a real `GITHUB_TOKEN` (see
"Ingestion" in `AGENTS.md`), or by hand via `wrangler d1 execute forktimes
--local --command "..."`. Copy `.dev.vars.example` to `.dev.vars` for the
secrets that unlock drafting/posting/card rendering in `/admin`; none of it
is required just to browse.

Deployment targets Cloudflare Workers (static assets, with `@astrojs/cloudflare`
serving `/admin` on demand); `npm run deploy` builds and ships it.

## Licensing

No LICENSE file yet. The ingestion, ranking, taxonomy and editorial layers
are original throughout; the visual identity (colors, typography, the
"Almanac" concept) has been redesigned from the ground up.
