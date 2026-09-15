// schema.org builders.
//
// Every value here has to come from something we actually measured or
// curated. There is no aggregateRating and no offer on repo pages, because we
// do not collect ratings or prices - and a fabricated one is exactly the kind
// of claim this project exists not to make. That rules out the richer
// SoftwareApplication treatment, so repos are typed as SoftwareSourceCode,
// which is what a git repository actually is.

import { SITE_METADATA } from '../config';

const SITE = SITE_METADATA.url;

/** Absolute URL for a site-relative path. Schema.org ids must be absolute. */
export function abs(path: string): string {
	return new URL(path, SITE).href;
}

const ORG_ID = abs('/#organization');
const SITE_ID = abs('/#website');

export function organization() {
	return {
		'@type': 'Organization',
		'@id': ORG_ID,
		name: SITE_METADATA.name,
		url: SITE,
		description: SITE_METADATA.description,
		slogan: SITE_METADATA.tagline,
		logo: {
			'@type': 'ImageObject',
			url: abs('/icon.png'),
		},
		sameAs: [`https://x.com/${SITE_METADATA.twitter.replace(/^@/, '')}`],
	};
}

export function webSite() {
	return {
		'@type': 'WebSite',
		'@id': SITE_ID,
		name: SITE_METADATA.name,
		url: SITE,
		description: SITE_METADATA.longDescription,
		publisher: { '@id': ORG_ID },
		inLanguage: 'en',
	};
}

export interface Crumb {
	name: string;
	path: string;
}

/**
 * BreadcrumbList. Always rooted at the masthead, so callers pass only the
 * trail below it.
 */
export function breadcrumbs(trail: Crumb[]) {
	const items = [{ name: SITE_METADATA.name, path: '/' }, ...trail];
	return {
		'@type': 'BreadcrumbList',
		'@id': `${abs(items[items.length - 1].path)}#breadcrumbs`,
		itemListElement: items.map((crumb, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: crumb.name,
			item: abs(crumb.path),
		})),
	};
}

/** A page that exists to list things: an edition, a beat, an alternatives page. */
export function collectionPage(opts: {
	path: string;
	name: string;
	description: string;
	datePublished?: string;
	itemListName?: string;
	items: { path: string; name: string }[];
}) {
	const id = abs(opts.path);
	return {
		'@type': 'CollectionPage',
		'@id': id,
		url: id,
		name: opts.name,
		description: opts.description,
		isPartOf: { '@id': SITE_ID },
		publisher: { '@id': ORG_ID },
		inLanguage: 'en',
		...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
		mainEntity: {
			'@type': 'ItemList',
			...(opts.itemListName ? { name: opts.itemListName } : {}),
			numberOfItems: opts.items.length,
			itemListOrder: 'https://schema.org/ItemListOrderDescending',
			itemListElement: opts.items.map((item, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name: item.name,
				url: abs(item.path),
			})),
		},
	};
}

export interface RepoFacts {
	repo: string;
	url: string;
	description?: string;
	language?: string;
	stars?: number;
	repoCreatedAt?: string;
	editionDate?: string;
}

/**
 * SoftwareSourceCode for a repo page.
 *
 * Stars map to a LikeAction InteractionCounter, which is the closest honest
 * reading of a GitHub star. Forks are deliberately absent: schema.org has no
 * fork interaction, and the nearest candidates all misdescribe it.
 */
export function softwareSourceCode(facts: RepoFacts) {
	const path = `/repo/${facts.repo}/`;
	const id = abs(path);
	return {
		'@type': 'SoftwareSourceCode',
		'@id': `${id}#software`,
		name: facts.repo,
		url: id,
		codeRepository: facts.url,
		...(facts.description ? { description: facts.description } : {}),
		...(facts.language ? { programmingLanguage: facts.language } : {}),
		...(facts.repoCreatedAt ? { dateCreated: facts.repoCreatedAt.slice(0, 10) } : {}),
		...(typeof facts.stars === 'number'
			? {
					interactionStatistic: {
						'@type': 'InteractionCounter',
						interactionType: 'https://schema.org/LikeAction',
						userInteractionCount: facts.stars,
					},
				}
			: {}),
	};
}

/** The wrapper page for a repo, carrying the editorial claim and its date. */
export function repoPage(facts: RepoFacts, opts: { name: string; description: string }) {
	const path = `/repo/${facts.repo}/`;
	const id = abs(path);
	return {
		'@type': 'WebPage',
		'@id': id,
		url: id,
		name: opts.name,
		description: opts.description,
		isPartOf: { '@id': SITE_ID },
		publisher: { '@id': ORG_ID },
		inLanguage: 'en',
		...(facts.editionDate ? { datePublished: facts.editionDate } : {}),
		mainEntity: { '@id': `${id}#software` },
	};
}
