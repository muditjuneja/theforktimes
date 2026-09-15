// Titles and meta descriptions.
//
// Everything here is composed from measurements we took or judgements we
// curated. Nothing is padded to hit a character count: a short honest
// description beats a long invented one, and a snippet Google rewrites is
// better than a claim we cannot stand behind.

import { SITE_METADATA } from '../config.ts';
import { INDUSTRY_LABEL } from '../data/taxonomy.ts';

/**
 * `scripts/ingest.js` writes this instead of inventing a blurb, so an edition
 * is never shipped with fabricated editorial claims. It means the editorial
 * pass has not run yet - so it must not reach a meta description, where it
 * would render as "Editorial note pending" in a search result.
 */
const PLACEHOLDER = /editorial note pending/i;

export function hasEditorialNote(why?: string): boolean {
	return !!why && !PLACEHOLDER.test(why);
}

export function withSiteName(title: string): string {
	return `${title} | ${SITE_METADATA.name}`;
}

const list = (items: string[]): string =>
	items.length <= 1
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export interface RepoMeta {
	repo: string;
	why_it_matters?: string;
	stars?: number;
	stars_delta_7d?: number;
	stars_per_day?: number;
	language?: string;
	industry?: string;
	alternative_to?: string[];
}

const num = (n: number) => n.toLocaleString('en-US');

/** The headline number, as a phrase. Says which metric it used. */
export function velocityPhrase(d: RepoMeta): string | null {
	if (typeof d.stars_delta_7d === 'number') {
		return `${d.stars_delta_7d >= 0 ? '+' : ''}${num(d.stars_delta_7d)} stars in the last seven days`;
	}
	if (typeof d.stars_per_day === 'number') {
		return `${d.stars_per_day.toFixed(1)} stars a day since launch`;
	}
	return null;
}

/**
 * Repo page title. Leads with the substitution when we claim one, because
 * that is the query a reader is most likely to have typed.
 */
export function repoTitle(d: RepoMeta): string {
	const alts = d.alternative_to ?? [];
	if (alts.length > 0) {
		return withSiteName(`${d.repo} — open source alternative to ${alts[0]}`);
	}
	const beat = d.industry ? INDUSTRY_LABEL[d.industry as keyof typeof INDUSTRY_LABEL] : null;
	return withSiteName(beat ? `${d.repo} — ${beat}, ranked by velocity` : d.repo);
}

/**
 * Repo page description. Uses the editorial blurb once there is one; until
 * then, states what we measured rather than the placeholder that stands in
 * for the blurb.
 */
export function repoDescription(d: RepoMeta): string {
	if (hasEditorialNote(d.why_it_matters)) return d.why_it_matters!.trim();

	const parts: string[] = [];
	const counts = [
		typeof d.stars === 'number' ? `${num(d.stars)} stars` : null,
		velocityPhrase(d),
	].filter(Boolean);
	if (counts.length) parts.push(`${d.repo}: ${counts.join(', ')}.`);
	else parts.push(`${d.repo}.`);

	const beat = d.industry ? INDUSTRY_LABEL[d.industry as keyof typeof INDUSTRY_LABEL] : null;
	if (d.language && beat) parts.push(`A ${d.language} project on the ${beat} beat.`);
	else if (beat) parts.push(`On the ${beat} beat.`);
	else if (d.language) parts.push(`Written in ${d.language}.`);

	const alts = d.alternative_to ?? [];
	if (alts.length) parts.push(`An open source alternative to ${list(alts)}.`);

	return parts.join(' ');
}

/** Edition title: the date plus its issue number. */
export function editionTitle(label: string, issue: number): string {
	return withSiteName(`${label} — Issue ${issue}`);
}

/**
 * Edition description. Distinct per edition, because it names that edition's
 * own lead repos - a shared boilerplate description across every issue is a
 * duplicate-snippet problem as the archive grows.
 */
export function editionDescription(opts: {
	label: string;
	issue: number;
	count: number;
	leads: string[];
	usesVelocity: boolean;
}): string {
	const metric = opts.usesVelocity ? 'star velocity' : 'stars per day since launch';
	const led = opts.leads.length ? `, led by ${list(opts.leads.slice(0, 3))}` : '';
	return `Issue ${opts.issue}, ${opts.label}: ${opts.count} open source ${
		opts.count === 1 ? 'project' : 'projects'
	} ranked by ${metric}${led}.`;
}
