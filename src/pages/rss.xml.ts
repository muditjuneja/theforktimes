import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE_METADATA } from '../config';
import { allEditions, editionStories } from '../lib/editions';

export async function GET(context: APIContext) {
	// One item per edition rather than per repo: the edition is the unit a
	// reader subscribes to, and a per-repo feed would push thirty items a week
	// that mostly say the same thing.
	const editions = [...(await allEditions())].reverse();

	const items = await Promise.all(
		editions.map(async ({ day, label, issue, count }) => {
			const stories = await editionStories(day);
			const lead = stories.slice(0, 5);

			const description =
				`<p>No. ${issue} &mdash; ${count} ${count === 1 ? 'entry' : 'entries'}, ranked by what moved.</p>` +
				`<ul>${lead
					.map((s) => {
						const metric =
							typeof s.stars_delta_7d === 'number'
								? `${s.stars_delta_7d >= 0 ? '+' : ''}${s.stars_delta_7d.toLocaleString('en-US')} stars this week`
								: typeof s.stars_per_day === 'number'
									? `${s.stars_per_day.toFixed(1)} stars a day`
									: `${(s.stars ?? 0).toLocaleString('en-US')} stars`;
						return `<li><strong>${s.repo}</strong> &mdash; ${metric}</li>`;
					})
					.join('')}</ul>` +
				(count > lead.length ? `<p>&hellip;and ${count - lead.length} more.</p>` : '');

			return {
				title: `${SITE_METADATA.name} — No. ${issue}, ${label}`,
				pubDate: new Date(`${day}T00:00:00Z`),
				description,
				link: `/${day}/`,
			};
		})
	);

	return rss({
		title: SITE_METADATA.name,
		description: SITE_METADATA.description,
		site: context.site ?? 'https://theforktimes.com',
		items,
	});
}
