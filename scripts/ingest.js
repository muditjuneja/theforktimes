#!/usr/bin/env node
// Fetch READMEs and star history for a D1 edition.
//
//   node scripts/ingest.js --date 2026-09-14
//
// Candidate discovery, GitHub enrichment and ranking now happen in D1
// (worker/index.js's weeklyEdition(), triggered by the Tuesday cron or by
// hand with `POST /run?job=edition`) - that runtime already talks to
// GitHub's GraphQL API and D1 directly, so duplicating it here would just be
// a second, drifting copy (see AGENTS.md's note on why the Worker is
// self-contained rather than sharing this file).
//
// What is left for this script is the one thing the Worker cannot do:
// write files. READMEs and the stargazer-sampled star history stay a
// filesystem cache next to the site's other content, fetched here for
// whichever repos are already in the given edition's D1 rows.
//
// Set GITHUB_TOKEN for star history (stargazers pagination needs auth) and
// for a higher-rate-limited README fetch; without it READMEs still work
// (raw.githubusercontent.com is unauthenticated) but star history is
// skipped for that run.

import fs from 'node:fs';
import path from 'node:path';
import { fetchReadme, fetchStarHistory } from './lib/sources.js';
import { fetchEditionByDate } from '../src/lib/edition-data.ts';

const RAW_BASE = 'https://raw.githubusercontent.com';

function parseArgs(argv) {
	const args = { date: null, force: false };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--date') args.date = argv[++i];
		else if (argv[i] === '--force') args.force = true;
	}
	args.date ??= new Date().toISOString().slice(0, 10);
	return args;
}

/** True for anything already resolvable without a base. */
function isAbsoluteRef(ref) {
	return /^(https?:|data:|mailto:|#|\/\/)/i.test(ref);
}

/**
 * Prepare a README for rendering inside our own site.
 *
 * READMEs address their assets relative to the repository root, so a bare
 * `docs/logo.png` resolves against theforktimes.com once inlined - and Astro
 * fails the whole build looking for a local file that was never ours. Every
 * relative reference is rewritten to an absolute GitHub URL: images to the raw
 * host, links to the blob view.
 */
function sanitizeReadme(md, slug, branch = 'main') {
	const raw = `${RAW_BASE}/${slug}/${branch}`;
	const blob = `https://github.com/${slug}/blob/${branch}`;
	let out = md.replace(/\r\n/g, '\n').trimStart();

	out = out.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, head, ref) =>
		isAbsoluteRef(ref) ? m : `${head}${raw}/${ref.replace(/^\.?\//, '')}`
	);
	out = out.replace(/(^|[^!])(\[[^\]]*\]\()([^)\s]+)/g, (m, pre, head, ref) =>
		isAbsoluteRef(ref) ? m : `${pre}${head}${blob}/${ref.replace(/^\.?\//, '')}`
	);
	out = out.replace(/(<img[^>]+src=")([^"]+)/gi, (m, head, ref) =>
		isAbsoluteRef(ref) ? m : `${head}${raw}/${ref.replace(/^\.?\//, '')}`
	);
	out = out.replace(/(<a[^>]+href=")([^"]+)/gi, (m, head, ref) =>
		isAbsoluteRef(ref) ? m : `${head}${blob}/${ref.replace(/^\.?\//, '')}`
	);

	if (out.startsWith('---')) out = '\n' + out;
	return out;
}

/** Astro's glob loader slugifies ids, which lowercases them - readmeId must
 * match src/lib/edition-data.ts's hasReadme() and the lookup in
 * src/pages/repo/[...repo].astro exactly. */
function readmeId(slug) {
	return slug.replace('/', '--').toLowerCase();
}

async function writeReadme(slug, readmeDir) {
	// No default_branch in D1's repos table (see AGENTS.md's note on GraphQL
	// batching for what it does carry) - main/master covers the near-total
	// majority of repos, and fetchReadme() already falls back through both.
	const readme = await fetchReadme(slug);
	if (!readme) return false;
	const id = readmeId(slug);
	const fm = [
		`repo: ${JSON.stringify(slug)}`,
		`fetched_at: '${new Date().toISOString()}'`,
		`source_url: ${readme.source_url}`,
	].join('\n');
	fs.writeFileSync(
		path.join(readmeDir, `${id}.md`),
		`---\n${fm}\n---\n${sanitizeReadme(readme.markdown, slug, readme.branch)}\n`,
		'utf8'
	);
	return true;
}

async function main() {
	const args = parseArgs(process.argv);
	console.log(`The Fork Times - fetching README/history for edition ${args.date}`);

	const entries = await fetchEditionByDate(args.date);
	if (entries.length === 0) {
		console.error(`No edition ${args.date} in D1. Has the weekly cron run, or POST /run?job=edition?`);
		process.exit(1);
	}

	const readmeDir = path.join(process.cwd(), 'src/content/readmes');
	fs.mkdirSync(readmeDir, { recursive: true });

	let readmes = 0, histories = 0;
	for (const { data: d } of entries) {
		const slug = d.repo;
		const id = readmeId(slug);
		const readmePath = path.join(readmeDir, `${id}.md`);
		const historyPath = path.join(readmeDir, `${id}.stars.json`);

		if (args.force || !fs.existsSync(readmePath)) {
			const got = await writeReadme(slug, readmeDir);
			if (got) readmes++;
		}

		if (args.force || !fs.existsSync(historyPath)) {
			const history = await fetchStarHistory(slug, { totalStars: d.stars });
			if (history) {
				fs.writeFileSync(historyPath, JSON.stringify(history), 'utf8');
				histories++;
			}
		}

		console.log(`  ${slug}`);
	}

	console.log(`\n${readmes} README(s), ${histories} star history file(s) written for ${entries.length} entries.`);
	if (!process.env.GITHUB_TOKEN) {
		console.warn('GITHUB_TOKEN not set - star history was skipped for repos that needed it.');
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
