// Draft an X post: the voice, the prompt, the OpenRouter call, and the alt
// text for whatever card goes with it.
//
// Pulled out of scripts/tweet.js so the CLI and the admin portal's
// /admin/<date>/post/ (src/pages/admin/[edition]/post/index.astro) share the
// exact same prompt and rules - the voice cannot drift between "posting from
// the terminal" and "posting from the browser" if there is only one copy of
// it to drift from. Pure `fetch`, no Node-only API, so it runs unmodified in
// both the plain-Node CLI and the Cloudflare Worker.
import { SITE_METADATA } from '../../src/config.ts';

export const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-opus-5';
export const LIMIT = 280;

export const VOICE = `You write the X account for The Fork Times, a newspaper that ranks open
source projects by star velocity. The masthead slogan is "All the Code That's
Fit to Ship".

The voice is a broadsheet newspaper reporting on open source as if it were
civic news: deadpan, precise, faintly amused. The humour comes from the
register - treating repo drama with the gravity of a front page - and from
exact numbers used well. It never comes from puns, exclamation marks, or
telling the reader something is interesting.

Rules:
- One idea. Under 280 characters, and shorter is better.
- Lead with the most surprising true thing. Usually a number, and the number
  must be one of the supplied figures, exactly as given.
- Dry understatement over enthusiasm. "This is the third week running" is
  funnier than "incredible growth".
- No hashtags. No emoji. No thread markers. No "Here's why". No "just
  dropped". No engagement bait, no questions to the audience.
- Never manufacture significance. If a repo is trending because it is a joke,
  the joke is the story - report it straight and let it be funny on its own.
- Never claim anything the supplied data does not support.

Reply with the post text only. No quotes, no preamble, no alternatives.`;

/**
 * Build the user prompt for a draft. `entries` is the shape both
 * scripts/tweet.js's loadEdition() and src/lib/admin-db.ts's
 * getEditionEntriesForPost() already produce: { repo, stars, forks,
 * stars_delta_7d, stars_per_day, language, industry, why, description }.
 *
 * `repo` narrows the post to one entry (the CLI's `--repo`); omitted, it
 * covers the edition's top entries in rank order, same as a bare
 * `npm run tweet -- --date ...`.
 */
export function buildPrompt(entries, { date, link, repo }) {
	const subject = repo ? entries.filter((e) => e.repo === repo) : entries.slice(0, 6);
	if (subject.length === 0) {
		throw new Error(`Repo ${repo} is not in the ${date} edition.`);
	}
	const lines = subject.map((e, i) => {
		const metric = e.stars_delta_7d !== null
			? `+${e.stars_delta_7d.toLocaleString('en-US')} stars this week`
			: `${e.stars_per_day?.toFixed(1)} stars/day since launch`;
		return `${i + 1}. ${e.repo} - ${metric}; ${e.stars.toLocaleString('en-US')} stars total; ${e.forks.toLocaleString('en-US')} forks${e.language ? `; ${e.language}` : ''}${e.industry ? `; beat: ${e.industry}` : ''}
   ${e.description ?? ''}
   Editorial line: ${e.why}`;
	}).join('\n');

	const url = link ? `${SITE_METADATA.url}/${date}/` : null;
	return `Edition of ${date}.

${repo ? 'Write about this repository:' : 'The edition leads with these, in rank order:'}
${lines}

${url
	? `End the post with this URL on its own, exactly: ${url}\nBudget for it: the URL costs 23 characters against the 280 limit.`
	: 'Do NOT include any URL or domain name in the post.'}

Write the post.`;
}

export async function generate(prompt, { model = DEFAULT_MODEL, apiKey, n = 1 }) {
	const res = await fetch(OPENROUTER, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': SITE_METADATA.url,
			'X-Title': SITE_METADATA.name,
		},
		body: JSON.stringify({
			model,
			max_tokens: 300,
			n,
			// Some variety is wanted when drafting alternatives to choose between.
			temperature: n > 1 ? 1 : 0.7,
			messages: [
				{ role: 'system', content: [{ type: 'text', text: VOICE, cache_control: { type: 'ephemeral' } }] },
				{ role: 'user', content: prompt },
			],
		}),
	});
	if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = await res.json();
	return (body.choices ?? []).map((c) => c.message?.content?.trim()).filter(Boolean);
}

/** `entry` is one item from the same shape as buildPrompt()'s `entries`. */
export function altTextFor(entry, card) {
	const metric = entry.stars_delta_7d !== null
		? `up ${entry.stars_delta_7d.toLocaleString('en-US')} stars this week`
		: `${entry.stars_per_day?.toFixed(1)} stars per day since launch`;
	const where = card === 'fork' ? 'The Fork Times page' : 'The GitHub page';
	return `${where} for ${entry.repo}: ${metric}, ` +
		`${entry.stars.toLocaleString('en-US')} stars and ${entry.forks.toLocaleString('en-US')} forks total` +
		`${entry.language ? `, written in ${entry.language}` : ''}.`;
}
