#!/usr/bin/env node
// Re-serialise the latest edition for machine consumers.
//
// Writes two extensionless files that public/_headers gives explicit
// Content-Types, because Wrangler cannot infer a MIME type without an
// extension and would otherwise serve them as downloads:
//
//   public/md    the edition as one markdown document
//   public/json  the same edition as structured data
//
// Both exist so an agent can read an edition without scraping the HTML.
//
// Runs before Astro starts (see package.json's build script), so it cannot
// go through getCollection('repos') - it calls the same fetchReadyEntries()
// the D1 content loader uses instead, rather than re-deriving the same
// industry/section/etc a second way.

import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './lib/site.js';
import { fetchReadyEntries } from '../src/lib/edition-data.ts';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const RULE = '-'.repeat(72);

const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : null);

/** Plain-markdown equivalent of StoryBody.astro, for the /md export. */
function renderBody(e) {
	const lines = [];
	if (e.description) lines.push(e.description);
	const facts = [`**${num(e.stars)}** stars`, `**${num(e.forks)}** forks`];
	if (typeof e.stars_delta_7d === 'number') {
		facts.push(`**${e.stars_delta_7d >= 0 ? '+' : ''}${num(e.stars_delta_7d)}** this week`);
	} else if (typeof e.stars_per_day === 'number') {
		facts.push(`**${e.stars_per_day.toFixed(1)}** stars/day since launch`);
	}
	if (e.language) facts.push(`primary language **${e.language}**`);
	lines.push('', facts.join(' · ') + '.');
	if (typeof e.hn_points === 'number') {
		lines.push('', `Discussed on Hacker News at ${e.hn_points} points with ${e.hn_comments ?? 0} comments.`);
	}
	return lines.join('\n');
}

function frontmatter(e) {
	const fm = [`repo: ${e.repo}`, `title: ${JSON.stringify(e.title)}`, `url: ${e.url}`, `date: '${e.date}'`];
	if (e.industry) fm.push(`industry: ${e.industry}`);
	fm.push(`stars: ${e.stars}`, `forks: ${e.forks}`);
	if (typeof e.stars_delta_7d === 'number') fm.push(`stars_delta_7d: ${e.stars_delta_7d}`);
	if (e.why_it_matters) fm.push(`why_it_matters: ${JSON.stringify(e.why_it_matters)}`);
	return fm.join('\n');
}

async function main() {
	const entries = await fetchReadyEntries();
	if (entries.length === 0) {
		console.error('No ready editions in D1 - nothing to export. (Has one been marked ready in /admin?)');
		process.exit(1);
	}

	const day = entries.at(-1).edition;
	const dayEntries = entries.filter((e) => e.edition === day).map((e) => e.data);
	fs.mkdirSync(PUBLIC_DIR, { recursive: true });

	const rendered = dayEntries.map((e) => `---\n${frontmatter(e)}\n---\n\n${renderBody(e)}\n`);
	const header = `---\nname: ${SITE.name}\ndescription: ${SITE.description}\nedition: ${day}\nentries: ${dayEntries.length}\n---\n`;
	fs.writeFileSync(
		path.join(PUBLIC_DIR, 'md'),
		`${header}\n${RULE}\n\n${rendered.join(`\n\n${RULE}\n\n`)}\n`,
		'utf8'
	);

	const jsonEntries = dayEntries.map((e) => ({ ...e, content: renderBody(e) }));
	fs.writeFileSync(
		path.join(PUBLIC_DIR, 'json'),
		`${JSON.stringify({ name: SITE.name, description: SITE.description, edition: day, entries: jsonEntries }, null, 2)}\n`,
		'utf8'
	);

	console.log(`Exported edition ${day} (${dayEntries.length} entries) to public/md and public/json`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
