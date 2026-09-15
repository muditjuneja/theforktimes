// D1 access for everything that runs as plain Node: the Astro content loader
// at build time, and the ingest/issue/tweet/blurbs scripts (see AGENTS.md).
//
// The admin portal is the one thing that does NOT use this file - it runs
// inside the Worker and talks to D1 through the native `env.DB` binding,
// which has real parameter binding. This file shells out to
// `wrangler d1 execute` instead of hand-rolling the D1 HTTP API, because
// `npm run deploy` already requires the machine running it to be
// authenticated to Cloudflare (wrangler deploy needs that too) - reusing
// that auth beats asking for a second, separate CLOUDFLARE_API_TOKEN.
//
// Local by default, remote only when D1_REMOTE is set. Same shape as
// GITHUB_TOKEN gating ingest.js's live-vs-ungh.cc fallback: the safe path
// needs nothing, the real path is one explicit flag, and forgetting the flag
// fails safe (an empty local db, caught immediately) rather than silently
// touching production. `npm run deploy` sets it; nothing else should.
//
// The CLI's --command takes one raw SQL string - there is no bind-parameter
// flag (`wrangler d1 execute --help` confirms it: --command or --file only).
// Every value that reaches SQL through this file MUST go through sqlLiteral()
// or bind(); never string-concatenate a value into a query by hand.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const DB_NAME = 'forktimes';

/**
 * Quote a JS value as a SQL literal. The only defense against injection this
 * file has, since the CLI gives us no parameter binding - every write path
 * (backfill, blurbs.js) MUST route values through this rather than
 * interpolating them directly into a query string.
 */
export function sqlLiteral(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`sqlLiteral: not finite: ${value}`);
		return String(value);
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** `IN (...)` list of string literals, or `IN (NULL)` for an empty list. */
export function sqlList(values) {
	if (!values.length) return '(NULL)';
	return `(${values.map(sqlLiteral).join(', ')})`;
}

/**
 * Run one or more `;`-separated statements against D1 and return the results
 * array (one entry per statement, D1's own `{ results, success, meta }`
 * shape). Long statement batches go through a temp .sql file rather than
 * --command, so this never runs into a shell argv length limit.
 */
export async function d1Exec(sql) {
	const mode = process.env.D1_REMOTE ? '--remote' : '--local';
	const tmp = path.join(tmpdir(), `forktimes-d1-${process.pid}-${Date.now()}.sql`);
	await writeFile(tmp, sql, 'utf8');
	try {
		const { stdout } = await run(
			'npx',
			['wrangler', 'd1', 'execute', DB_NAME, mode, '--json', '--file', tmp],
			{ maxBuffer: 64 * 1024 * 1024 }
		);
		return JSON.parse(stdout);
	} finally {
		await unlink(tmp).catch(() => {});
	}
}

/** Run a single SELECT and return just its rows. */
export async function d1Query(sql) {
	const [{ results }] = await d1Exec(sql);
	return results;
}

/** Whether this run is pointed at the real, deployed database. */
export const isRemote = () => Boolean(process.env.D1_REMOTE);
