#!/usr/bin/env node
// One-shot: load the markdown editions already in src/content/repos/ into
// D1, so the switch to the D1 content loader (src/lib/d1-loader.ts) does not
// lose the entries that were already live. Run once, then
// `git rm -r src/content/repos/`.
//
//   node scripts/backfill-d1.js
//   D1_REMOTE=1 node scripts/backfill-d1.js   # once the real database exists
//
// Frontmatter is parsed with the same small regex helpers scripts/review.js
// used (proven against these exact files) rather than pulling in a YAML
// parser for a script that runs once.

import fs from 'node:fs';
import path from 'node:path';
import { d1Exec, sqlLiteral } from './lib/d1.js';

const REPOS_DIR = path.join(process.cwd(), 'src/content/repos');

function field(y, k) {
	const m = y.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'));
	return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : null;
}
function block(y, k) {
	const m = y.match(new RegExp(`^${k}: >-\\n((?:  .*\\n?)+)`, 'm'));
	return m ? m[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ') : field(y, k);
}
function list(y, k) {
	const m = y.match(new RegExp(`^${k}:\\n((?:  - .*\\n?)+)`, 'm'));
	return m
		? m[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
		: [];
}

/** The description buildBody() wrote as the body's first paragraph, if any -
 * it never made it into frontmatter, only the rendered markdown. */
function bodyDescription(body) {
	const first = body.trim().split(/\n\s*\n/)[0]?.trim();
	if (!first || first.startsWith('**') || first.startsWith('Discussed on Hacker News')) return null;
	return first;
}

function bodyCommentCount(body) {
	const m = body.match(/with (\d+) comments/);
	return m ? Number(m[1]) : null;
}

function loadEntry(dir, file) {
	const raw = fs.readFileSync(path.join(dir, file), 'utf8');
	const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!m) throw new Error(`${file}: no frontmatter block found`);
	const [, y, body] = m;
	const tags = list(y, 'tags');
	const language = field(y, 'language');
	return {
		file,
		repo: field(y, 'repo'),
		title: field(y, 'title'),
		date: field(y, 'date'),
		stars: Number(field(y, 'stars')) || 0,
		forks: Number(field(y, 'forks')) || 0,
		stars_delta_7d: field(y, 'stars_delta_7d') ? Number(field(y, 'stars_delta_7d')) : null,
		stars_per_day: field(y, 'stars_per_day') ? Number(field(y, 'stars_per_day')) : null,
		interest_score: field(y, 'interest_score') ? Number(field(y, 'interest_score')) : null,
		why_it_matters: block(y, 'why_it_matters'),
		repo_created_at: field(y, 'repo_created_at'),
		language,
		topics: tags.filter((t) => t !== language),
		hn_id: field(y, 'hn_id'),
		hn_points: field(y, 'hn_points') ? Number(field(y, 'hn_points')) : null,
		hn_comments: bodyCommentCount(body),
		comments: field(y, 'comments'),
		description: bodyDescription(body),
	};
}

async function main() {
	if (!fs.existsSync(REPOS_DIR)) {
		console.log('No src/content/repos/ - nothing to backfill.');
		return;
	}
	const editionDirs = fs.readdirSync(REPOS_DIR).filter((d) =>
		fs.statSync(path.join(REPOS_DIR, d)).isDirectory()
	);
	if (editionDirs.length === 0) {
		console.log('No edition directories under src/content/repos/ - nothing to backfill.');
		return;
	}

	const now = new Date().toISOString();
	const statements = [];

	for (const edition of editionDirs) {
		const dir = path.join(REPOS_DIR, edition);
		const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
		console.log(`${edition}: ${files.length} entries`);

		statements.push(
			`INSERT INTO editions (edition, status, published_at) VALUES (${sqlLiteral(edition)}, 'ready', ${sqlLiteral(now)}) ON CONFLICT(edition) DO NOTHING;`
		);

		files.forEach((file, i) => {
			const e = loadEntry(dir, file);
			const rank = i + 1;

			statements.push(`
				INSERT INTO repos (slug, owner, name, description, language, repo_created_at, first_seen, last_seen)
				VALUES (${sqlLiteral(e.repo)}, ${sqlLiteral(e.repo.split('/')[0])}, ${sqlLiteral(e.repo.split('/')[1])},
					${sqlLiteral(e.description)}, ${sqlLiteral(e.language)}, ${sqlLiteral(e.repo_created_at)}, ${sqlLiteral(now)}, ${sqlLiteral(now)})
				ON CONFLICT(slug) DO UPDATE SET
					description = excluded.description, language = excluded.language, last_seen = excluded.last_seen;
			`);

			statements.push(`
				INSERT OR REPLACE INTO repo_snapshots (slug, observed_on, stars, forks)
				VALUES (${sqlLiteral(e.repo)}, ${sqlLiteral(e.date)}, ${e.stars}, ${e.forks});
			`);

			if (e.hn_id) {
				statements.push(`
					INSERT OR REPLACE INTO hn_mentions (hn_id, slug, url, title, points, num_comments, created_at, ingested_at)
					VALUES (${sqlLiteral(e.hn_id)}, ${sqlLiteral(e.repo)}, ${sqlLiteral(e.comments)}, ${sqlLiteral(e.title)},
						${e.hn_points ?? 0}, ${e.hn_comments ?? 0}, ${sqlLiteral(e.date)}, ${sqlLiteral(now)});
				`);
			}

			statements.push(`
				INSERT OR REPLACE INTO edition_entries
					(edition, slug, rank, title, stars, forks, stars_delta_7d, stars_per_day, interest_score, why_it_matters)
				VALUES (${sqlLiteral(edition)}, ${sqlLiteral(e.repo)}, ${rank}, ${sqlLiteral(e.title)}, ${e.stars}, ${e.forks},
					${e.stars_delta_7d === null ? 'NULL' : e.stars_delta_7d},
					${e.stars_per_day === null ? 'NULL' : e.stars_per_day},
					${e.interest_score === null ? 'NULL' : e.interest_score},
					${sqlLiteral(e.why_it_matters)});
			`);
		});
	}

	await d1Exec(statements.join('\n'));
	console.log(`\nBackfilled ${editionDirs.length} edition(s) into D1 (${process.env.D1_REMOTE ? 'remote' : 'local'}).`);
	console.log('Verify, then: git rm -r src/content/repos/');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
