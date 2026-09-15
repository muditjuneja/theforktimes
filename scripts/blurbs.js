#!/usr/bin/env node
// Generate the `why_it_matters` blurbs for an edition, via OpenRouter.
//
//   node scripts/blurbs.js --date 2026-09-14 [--model ...] [--dry-run] [--force]
//
// This is the editorial pass, and it is the product. ingest.js deliberately
// leaves a factual placeholder behind; this replaces it with a real claim.
//
// OpenRouter is used rather than a provider SDK so the model is a config value
// rather than a code change - editorial quality is worth A/B testing, and the
// blurb prompt is the thing most worth testing. `:batch` model variants are
// half price and asynchronous, which suits a nightly cron.

import fs from 'node:fs';
import path from 'node:path';
import { d1Exec, sqlLiteral } from './lib/d1.js';
import { fetchEditionByDate } from '../src/lib/edition-data.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-opus-5';
const PLACEHOLDER = /Editorial note pending\.?/i;

// Kept verbatim in one constant so it is a byte-stable cache prefix; every
// blurb in a run reuses it. Mirrors the editorial section of AGENTS.md.
const STYLE_GUIDE = `You write the "why it matters" column for The Fork Times, a newspaper that
ranks open source projects by star velocity rather than raw star count.

Your job is to state, specifically, why this repository earned its place in
this edition. You are not summarising the README.

A blurb is good when a reader who already knows the project still learns
something. It is bad when it could have been written from the repo description
alone.

Rules:
- 2 to 4 sentences. A newspaper column, not a review.
- Name what changed and why it moved now, when the data supports a claim.
- Be concrete about the engineering: the tradeoff, the design decision, the
  thing it does that its alternatives do not.
- Use numbers as evidence for a claim, never as the claim itself. "Forks
  running at three times the usual rate for its star count, which suggests
  people are deploying it rather than bookmarking it" beats "10k forks".
- Never use: powerful, seamless, game-changing, revolutionary, blazingly fast,
  or any phrase a launch post would use.
- Never manufacture significance. Some repos trend because they are funny or
  alarming. Say that plainly rather than inventing technical importance.
- Never claim anything the supplied data does not support. If the reason for
  the movement is not evident, say the movement is unexplained.

Reply with the blurb text only. No preamble, no quotes, no markdown.`;

function parseArgs(argv) {
	const args = { date: null, model: DEFAULT_MODEL, dryRun: false, force: false, limit: Infinity };
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--date') args.date = argv[++i];
		else if (a === '--model') args.model = argv[++i];
		else if (a === '--limit') args.limit = Number(argv[++i]);
		else if (a === '--dry-run') args.dryRun = true;
		else if (a === '--force') args.force = true;
	}
	args.date ??= new Date().toISOString().slice(0, 10);
	return args;
}

function buildUserPrompt(meta, readmeExcerpt) {
	const facts = [
		`Repository: ${meta.repo}`,
		meta.description && `Description: ${meta.description}`,
		`Stars: ${meta.stars}`,
		`Forks: ${meta.forks}`,
		meta.fork_ratio && `Fork-to-star ratio: ${(Number(meta.fork_ratio) * 100).toFixed(1)}%`,
		meta.stars_delta_7d && `Stars gained in the last 7 days: ${meta.stars_delta_7d}`,
		meta.stars_per_day && `Stars per day since launch: ${meta.stars_per_day}`,
		meta.language && `Primary language: ${meta.language}`,
		meta.repo_created_at && `Created: ${meta.repo_created_at.slice(0, 10)}`,
		meta.industry && `Beat: ${meta.industry}`,
		meta.alternative_to.length && `Positioned as an open source alternative to: ${meta.alternative_to.join(', ')}`,
		meta.hn_points && `Hacker News: ${meta.hn_points} points`,
	].filter(Boolean).join('\n');

	return `${facts}\n\n${readmeExcerpt ? `README excerpt:\n"""\n${readmeExcerpt}\n"""\n\n` : ''}Write the "why it matters" blurb.`;
}

async function generate(prompt, { model, apiKey }) {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://theforktimes.com',
			'X-Title': 'The Fork Times',
		},
		body: JSON.stringify({
			model,
			max_tokens: 400,
			messages: [
				{
					role: 'system',
					// Array form so the stable prefix carries a cache breakpoint;
					// OpenRouter forwards this to Anthropic's prompt cache.
					content: [{ type: 'text', text: STYLE_GUIDE, cache_control: { type: 'ephemeral' } }],
				},
				{ role: 'user', content: prompt },
			],
		}),
	});
	if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = await res.json();
	const text = body.choices?.[0]?.message?.content?.trim();
	if (!text) throw new Error('empty completion');
	return { text, usage: body.usage };
}

async function main() {
	const args = parseArgs(process.argv);
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey && !args.dryRun) {
		console.error('OPENROUTER_API_KEY is not set. Re-run with --dry-run to inspect prompts without calling the API.');
		process.exit(1);
	}

	const entries = await fetchEditionByDate(args.date);
	if (entries.length === 0) {
		console.error(`No edition ${args.date} in D1. Has the weekly cron run, or npm run ingest?`);
		process.exit(1);
	}
	const readmeDir = path.join(process.cwd(), 'src/content/readmes');

	console.log(`Editorial pass for ${args.date} - ${entries.length} entries, model ${args.model}${args.dryRun ? ' (dry run)' : ''}`);

	let written = 0, skipped = 0, failed = 0;
	let promptTokens = 0, completionTokens = 0;

	for (const { data: d } of entries.slice(0, args.limit)) {
		const existing = d.why_it_matters ?? '';
		if (existing && !PLACEHOLDER.test(existing) && !args.force) {
			skipped++;
			continue;
		}

		const meta = {
			repo: d.repo,
			description: d.description,
			stars: d.stars,
			forks: d.forks,
			fork_ratio: d.fork_ratio,
			stars_delta_7d: d.stars_delta_7d,
			stars_per_day: d.stars_per_day,
			language: d.language,
			repo_created_at: d.repo_created_at,
			industry: d.industry,
			hn_points: d.hn_points,
			alternative_to: d.alternative_to ?? [],
		};

		// The top of a README is where "what is this" lives; the rest is
		// install instructions that add tokens without adding judgement.
		const readmePath = path.join(readmeDir, `${meta.repo.replace('/', '--').toLowerCase()}.md`);
		let excerpt = '';
		if (fs.existsSync(readmePath)) {
			const md = fs.readFileSync(readmePath, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
			excerpt = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 2000);
		}

		const prompt = buildUserPrompt(meta, excerpt);

		if (args.dryRun) {
			console.log(`\n──── ${meta.repo} ────\n${prompt.slice(0, 700)}${prompt.length > 700 ? '\n…' : ''}`);
			continue;
		}

		try {
			const { text, usage } = await generate(prompt, { model: args.model, apiKey });
			promptTokens += usage?.prompt_tokens ?? 0;
			completionTokens += usage?.completion_tokens ?? 0;

			await d1Exec(
				`UPDATE edition_entries SET why_it_matters = ${sqlLiteral(text)} WHERE edition = ${sqlLiteral(args.date)} AND slug = ${sqlLiteral(meta.repo)};`
			);
			written++;
			console.log(`  ✓ ${meta.repo}: ${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`);
		} catch (err) {
			failed++;
			console.warn(`  ✗ ${meta.repo}: ${err.message}`);
		}
	}

	console.log(`\n${written} written, ${skipped} already edited, ${failed} failed`);
	if (promptTokens) {
		console.log(`Tokens: ${promptTokens} in / ${completionTokens} out`);
	}
}

main().catch((err) => { console.error(err); process.exit(1); });
