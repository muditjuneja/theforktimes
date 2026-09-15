#!/usr/bin/env node
// Draft - and optionally publish - The Fork Times' post on X.
//
//   node scripts/tweet.js --date 2026-09-14                 # draft only (default)
//   node scripts/tweet.js --date 2026-09-14 --candidates 3  # three options
//   node scripts/tweet.js --date 2026-09-14 --image         # attach the GitHub page
//   node scripts/tweet.js --date 2026-09-14 --image --backend kitesurf  # require Kitesurf
//   node scripts/tweet.js --date 2026-09-14 --image --card fork  # our page instead
//   node scripts/tweet.js --date 2026-09-14 --link          # opt back into a URL
//   node scripts/tweet.js --date 2026-09-14 --image --post  # actually publish
//
// Publishing is opt-in on purpose. This posts publicly, as the masthead, and
// cannot be meaningfully undone - so the default is to print a draft and stop.
// `--post` is the only thing that sends, and it refuses an edition whose blurbs
// have not been through the editorial pass.

import fs from 'node:fs';
import path from 'node:path';
import { xCredentials, postTweet, uploadMedia, containsUrl, estimateCost } from './lib/x.js';
import { screenshot, githubCard, pickBackend, withCardCss, CARD } from './lib/shot.js';
import { DEFAULT_MODEL, LIMIT, buildPrompt, generate, altTextFor } from './lib/post-draft.js';
import { fetchEditionByDate } from '../src/lib/edition-data.ts';
import { hasEditorialNote } from '../src/lib/meta.ts';

// dist/client, not dist: the @astrojs/cloudflare adapter splits build output
// into dist/client (static assets, what this needs) and dist/server (the
// /admin SSR worker) - see AGENTS.md.
const CLIENT_DIR = 'dist/client';

function parseArgs(argv) {
	const a = { date: null, model: DEFAULT_MODEL, post: false, link: false, candidates: 1, repo: null, image: false, card: 'github', backend: undefined };
	for (let i = 2; i < argv.length; i++) {
		const k = argv[i];
		if (k === '--date') a.date = argv[++i];
		else if (k === '--model') a.model = argv[++i];
		else if (k === '--candidates') a.candidates = Math.max(1, Number(argv[++i]));
		else if (k === '--repo') a.repo = argv[++i];
		else if (k === '--post') a.post = true;
		else if (k === '--link') a.link = true;
		else if (k === '--no-link') a.link = false;
		else if (k === '--image') a.image = true;
		else if (k === '--card') a.card = argv[++i];
		else if (k === '--backend') a.backend = argv[++i];
	}
	a.date ??= new Date().toISOString().slice(0, 10);
	return a;
}

async function loadEdition(date) {
	const entries = await fetchEditionByDate(date);
	if (entries.length === 0) {
		console.error(`No edition ${date} in D1. Has the weekly cron run, or npm run ingest?`);
		process.exit(1);
	}
	return entries.map(({ data: d }) => ({
		repo: d.repo,
		stars: d.stars,
		forks: d.forks,
		stars_delta_7d: typeof d.stars_delta_7d === 'number' ? d.stars_delta_7d : null,
		stars_per_day: typeof d.stars_per_day === 'number' ? d.stars_per_day : null,
		language: d.language ?? null,
		industry: d.industry ?? null,
		why: d.why_it_matters ?? '',
		description: d.description ?? '',
	}));
}

/**
 * The built repo page, with its stylesheets inlined.
 *
 * Kitesurf and Playwright both render supplied HTML without a document base,
 * so a `<link href="/_astro/x.css">` would silently resolve to nothing and the
 * card would come out unstyled. Reading the CSS out of dist/ and inlining it is
 * what makes a pre-deploy card possible; once the site is live, pass the URL
 * instead and none of this is needed.
 */
function cardHtmlFor(repo) {
	const file = path.join(process.cwd(), CLIENT_DIR, 'repo', repo, 'index.html');
	if (!fs.existsSync(file)) {
		throw new Error(`No built page for ${repo}. Run "npm run build" first.`);
	}
	let html = fs.readFileSync(file, 'utf8');
	html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, (tag) => {
		const href = tag.match(/href="([^"]+)"/)?.[1];
		if (!href || /^https?:/.test(href)) return tag;
		const cssPath = path.join(process.cwd(), CLIENT_DIR, href.replace(/^\//, ''));
		if (!fs.existsSync(cssPath)) return tag;
		return `<style>${fs.readFileSync(cssPath, 'utf8')}</style>`;
	});
	return withCardCss(html);
}

async function main() {
	const args = parseArgs(process.argv);
	const entries = await loadEdition(args.date);

	// Never announce an edition that has not been edited.
	const unedited = entries.filter((e) => !hasEditorialNote(e.why));
	if (args.post && unedited.length > 0) {
		console.error(
			`Refusing to post: ${unedited.length} of ${entries.length} entries still carry the placeholder blurb.\n` +
			`Run "npm run blurbs -- --date ${args.date}" first.`
		);
		process.exit(1);
	}

	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error('OPENROUTER_API_KEY is not set; cannot draft a post.');
		process.exit(1);
	}

	const prompt = buildPrompt(entries, args);
	const drafts = await generate(prompt, { model: args.model, apiKey, n: args.candidates });
	if (drafts.length === 0) {
		console.error('No draft returned.');
		process.exit(1);
	}

	console.log(`\nThe Fork Times - draft post for ${args.date}\n`);
	drafts.forEach((text, i) => {
		const over = text.length > LIMIT;
		console.log(`─── candidate ${i + 1} ─── ${text.length}/${LIMIT}${over ? '  OVER LIMIT' : ''}  ~$${estimateCost(text).toFixed(3)}${containsUrl(text) ? ' (URL surcharge)' : ''}`);
		console.log(text + '\n');
	});

	// The card subject is the repo the post is about, else the edition lead.
	const subject = args.repo ? entries.find((e) => e.repo === args.repo) : entries[0];
	let card = null;

	if (args.image) {
		const backend = pickBackend(process.env, args.backend);
		const source = args.card === 'fork' ? 'our repo page' : 'github.com';
		process.stdout.write(`Rendering ${source} card for ${subject.repo} via ${backend.name} (${CARD.width}x${CARD.height})… `);
		card = args.card === 'fork'
			? await screenshot({ html: cardHtmlFor(subject.repo), backend })
			: await githubCard(subject.repo, { backend });
		const out = path.join(process.cwd(), `.cards/${args.date}-${subject.repo.replace('/', '--')}.png`);
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, card);
		console.log(`${(card.length / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), out)}`);
		console.log(`Alt text: ${altTextFor(subject, args.card)}\n`);
	}

	if (!args.post) {
		console.log('Draft only. Nothing was posted.');
		console.log(`To publish candidate 1: re-run with --post (or copy the text to @forktimeshq by hand).`);
		return;
	}

	const chosen = drafts[0];
	if (chosen.length > LIMIT) {
		console.error(`Refusing to post: ${chosen.length} characters exceeds the ${LIMIT} limit.`);
		process.exit(1);
	}

	const { creds, missing } = xCredentials();
	if (missing.length > 0) {
		console.error(`Cannot post - missing credentials: ${missing.join(', ')}`);
		process.exit(1);
	}

	let mediaIds;
	if (card) {
		mediaIds = [await uploadMedia(card, { creds, altText: altTextFor(subject, args.card) })];
		console.log(`Uploaded card as media ${mediaIds[0]}`);
	}

	const result = await postTweet(chosen, { creds, mediaIds });
	console.log(`Posted as @forktimeshq: https://x.com/forktimeshq/status/${result.id}`);
	console.log(`Billed approximately $${estimateCost(chosen).toFixed(3)}.`);
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
