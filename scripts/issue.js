#!/usr/bin/env node
// Render an edition as an email issue, ready to paste into Transmit.
//
//   npm run issue -- --date 2026-09-14
//
// Writes .issues/<date>.html and .issues/<date>.txt. Composing and sending
// happen in the Transmit UI; this only produces the body, because a weekly
// issue is the one thing worth a human looking at before it goes out.
//
// Email is not the web. No flexbox, no grid, no external stylesheet, no web
// font — Outlook renders with Word's engine and silently drops all four. The
// Almanac register survives it because its two defining choices happen to be
// email-safe: Georgia ships old-style numerals by default (one of very few
// web-safe faces that does), and Roman numerals are just text.

import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './lib/site.js';
import { d1Query } from './lib/d1.js';
import { fetchEditionByDate } from '../src/lib/edition-data.ts';

const WIDTH = 600;
const STOCK = '#ecebe3';
const INK = '#232820';
const SOFT = '#34392f';
const FAINT = '#6d7268';
const RULE = '#c3c6ba';
const GREEN = '#2f5d3f';

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const LABEL = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const PLACEHOLDER = /editorial note pending/i;
const ROMAN = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
	[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

const roman = (n) => ROMAN.reduce((out, [v, s]) => { while (n >= v) { out += s; n -= v; } return out; }, '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

function parseArgs(argv) {
	const a = { date: null };
	for (let i = 2; i < argv.length; i++) if (argv[i] === '--date') a.date = argv[++i];
	a.date ??= new Date().toISOString().slice(0, 10);
	return a;
}

/** D1's edition-data.ts shape, renamed to what entryHtml()/renderText() below expect. */
async function loadEdition(date) {
	const entries = await fetchEditionByDate(date);
	if (entries.length === 0) {
		console.error(`No edition ${date} in D1. Has the weekly cron run, or npm run ingest?`);
		process.exit(1);
	}
	return entries.map(({ data: d }) => ({
		repo: d.repo,
		url: d.url,
		stars: d.stars,
		forks: d.forks,
		delta: typeof d.stars_delta_7d === 'number' ? d.stars_delta_7d : null,
		perDay: typeof d.stars_per_day === 'number' ? d.stars_per_day : null,
		language: d.language ?? null,
		industry: d.industry ?? null,
		alternativeTo: d.alternative_to ?? [],
		why: d.why_it_matters ?? '',
		description: d.description ?? '',
	}));
}

const metric = (e) =>
	e.delta !== null ? `${e.delta >= 0 ? '+' : ''}${num(e.delta)} stars this week`
	: e.perDay !== null ? `${e.perDay.toFixed(1)} stars a day since launch`
	: `${num(e.stars)} stars`;

/** A full-bleed rule row. Tables, because a styled <hr> is unreliable in Outlook. */
const ruleRow = (style) =>
	`<tr><td style="padding:0;font-size:0;line-height:0;border-top:${style};">&nbsp;</td></tr>`;

function entryHtml(e, index) {
	const lead = index === 0;
	const alt = e.alternativeTo.length
		? `<div style="font-family:${LABEL};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${FAINT};padding-top:8px;">Substitute for ${esc(e.alternativeTo.join(', '))}</div>`
		: '';
	return `
	<tr><td style="padding:${lead ? '22px 0 8px' : '18px 0 8px'};">
		<div style="font-family:${LABEL};font-size:11px;font-weight:bold;letter-spacing:.18em;text-transform:uppercase;color:${FAINT};">
			${roman(index + 1)} &nbsp;&middot;&nbsp; ${esc(e.industry ?? 'open source')}
		</div>
		<div style="font-family:${SERIF};font-size:${lead ? '30px' : '21px'};font-weight:bold;line-height:1.15;color:${INK};padding-top:6px;">
			<a href="${esc(e.url)}" style="color:${INK};text-decoration:none;">${esc(e.repo)}</a>
		</div>
		<div style="font-family:${SERIF};font-style:italic;font-size:${lead ? '17px' : '15px'};color:${GREEN};padding-top:4px;">
			${esc(metric(e))}
		</div>
		<div style="font-family:${SERIF};font-size:${lead ? '17px' : '15px'};line-height:1.6;color:${SOFT};padding-top:10px;">
			${esc(e.why && !PLACEHOLDER.test(e.why) ? e.why : e.description)}
		</div>
		<div style="font-family:${LABEL};font-size:11px;letter-spacing:.1em;color:${FAINT};padding-top:8px;">
			${num(e.stars)} stars &nbsp;&middot;&nbsp; ${num(e.forks)} forks${e.language ? ` &nbsp;&middot;&nbsp; ${esc(e.language)}` : ''}
		</div>
		${alt}
	</td></tr>
	${ruleRow(lead ? `3px double ${INK}` : `1px solid ${RULE}`)}`;
}

function renderHtml(entries, { date, label, issue }) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SITE.name)} — No. ${issue}</title></head>
<body style="margin:0;padding:0;background:${STOCK};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(entries[0]?.repo ?? '')} leads — ${esc(metric(entries[0] ?? {}))}. ${entries.length} entries.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${STOCK};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${WIDTH}px;max-width:100%;">

  <tr><td align="center" style="font-family:${LABEL};font-size:11px;font-weight:bold;letter-spacing:.22em;text-transform:uppercase;color:${FAINT};padding-bottom:10px;">
    No. ${issue} &nbsp;&middot;&nbsp; ${esc(label)}
  </td></tr>
  ${ruleRow(`3px double ${INK}`)}
  <tr><td align="center" style="font-family:${SERIF};font-size:40px;font-weight:bold;color:${INK};padding:14px 0 4px;">
    ${esc(SITE.name)}
  </td></tr>
  <tr><td align="center" style="font-family:${SERIF};font-style:italic;font-size:15px;color:${FAINT};padding-bottom:14px;">
    Ranked by what is actually moving
  </td></tr>
  ${ruleRow(`1px solid ${INK}`)}

  ${entries.map(entryHtml).join('')}

  <tr><td align="center" style="font-family:${SERIF};font-style:italic;font-size:14px;color:${FAINT};padding:18px 0 6px;">
    End of Edition &mdash; ${esc(label)}
  </td></tr>
  <tr><td align="center" style="font-family:${LABEL};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${FAINT};padding-bottom:6px;">
    <a href="${SITE.url}/${date}/" style="color:${GREEN};text-decoration:none;">Read on the web</a>
    &nbsp;&middot;&nbsp;
    <a href="${SITE.url}/alternatives/" style="color:${GREEN};text-decoration:none;">Alternatives</a>
  </td></tr>
  <tr><td align="center" style="font-family:${LABEL};font-size:10px;letter-spacing:.08em;color:${FAINT};padding-bottom:4px;">
    Editions close two days back, so star counts and Hacker News threads have time to settle.
  </td></tr>
  <tr><td align="center" style="font-family:${LABEL};font-size:10px;color:${FAINT};">
    {{unsubscribe}}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function renderText(entries, { date, label, issue }) {
	const lines = [
		`${SITE.name} — No. ${issue}, ${label}`,
		'Ranked by what is actually moving',
		'='.repeat(60), '',
	];
	entries.forEach((e, i) => {
		lines.push(`${roman(i + 1)}. ${e.repo} — ${metric(e)}`);
		lines.push(e.why && !PLACEHOLDER.test(e.why) ? e.why : e.description);
		lines.push(`${num(e.stars)} stars · ${num(e.forks)} forks${e.language ? ` · ${e.language}` : ''}`);
		if (e.alternativeTo.length) lines.push(`Substitute for ${e.alternativeTo.join(', ')}`);
		lines.push(e.url, '');
	});
	lines.push('-'.repeat(60), `Read on the web: ${SITE.url}/${date}/`, '{{unsubscribe}}');
	return lines.join('\n');
}

async function main() {
	const { date } = parseArgs(process.argv);
	const entries = await loadEdition(date);

	// The issue number is the edition's position in the archive - every
	// edition D1 knows about, not just ready ones: a draft being composed
	// into an issue is still this week's issue.
	const all = (await d1Query('SELECT edition FROM editions ORDER BY edition ASC')).map((r) => r.edition);
	const issue = all.indexOf(date) + 1;
	const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
		weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
	});

	const out = path.join(process.cwd(), '.issues');
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, `${date}.html`), renderHtml(entries, { date, label, issue }), 'utf8');
	fs.writeFileSync(path.join(out, `${date}.txt`), renderText(entries, { date, label, issue }), 'utf8');

	const unedited = entries.filter((e) => !e.why || PLACEHOLDER.test(e.why));
	console.log(`Issue No. ${issue} — ${label}`);
	console.log(`  ${entries.length} entries, leading with ${entries[0].repo} (${metric(entries[0])})`);
	console.log(`  .issues/${date}.html  and  .issues/${date}.txt`);
	console.log(`\nSubject line to use:\n  ${SITE.name} No. ${issue}: ${entries[0].repo} — ${metric(entries[0])}`);
	if (unedited.length > 0) {
		console.warn(
			`\n  ${unedited.length} of ${entries.length} entries have no editorial note, so the issue is` +
			`\n  falling back to the repo's own description for those. Run the blurb pass before sending.`
		);
	}
}

main().catch((err) => { console.error(err); process.exit(1); });
