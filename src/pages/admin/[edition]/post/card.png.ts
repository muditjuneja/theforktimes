// On-demand GitHub-page card for the /admin/<date>/post/ preview and
// attachment. Rendered fresh on every request rather than persisted:
// Kitesurf is free (beta pricing) and rendering has no side effects, unlike
// the AI draft text, where the same trade-off went the other way (see the
// comment on edition_posts in scripts/schema.sql). Same GET-endpoint shape
// as src/pages/rss.xml.ts, but needs prerender=false since it reads D1 live.
export const prerender = false;

import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getEditionPost } from '../../../../lib/admin-db.ts';
import { githubCard, pickBackend } from '../../../../../scripts/lib/shot.js';

export async function GET({ params }: APIContext) {
	const edition = params.edition as string;
	const post = await getEditionPost(env.DB, edition);
	if (!post) return new Response('No draft for this edition yet.', { status: 404 });

	try {
		const backend = pickBackend(env, 'kitesurf');
		const png = await githubCard(post.subject_slug, { backend });
		return new Response(png, {
			headers: {
				'Content-Type': 'image/png',
				// Short cache: the same subject repo's card does not need to be
				// re-rendered on every reload while reviewing one draft, but this
				// must not persist across edits to the D1 row (a different
				// subject_slug, in the deferred --repo future) for long.
				'Cache-Control': 'private, max-age=300',
			},
		});
	} catch (err: any) {
		return new Response(err.message ?? 'Card render failed.', { status: 502 });
	}
}
