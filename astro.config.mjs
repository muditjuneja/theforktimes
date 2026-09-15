// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import { EnumChangefreq } from 'sitemap';

// Pages deliberately kept out of the index belong out of the sitemap too -
// submitting a noindex URL is a contradictory signal. Empty for now.
const EXCLUDED = [];

/** Edition URLs are /YYYY-MM-DD/. */
const EDITION = /^\/\d{4}-\d{2}-\d{2}\/$/;

// https://astro.build/config
export default defineConfig({
  site: 'https://theforktimes.com',
  // The site itself is still fully prerendered (see AGENTS.md - repo pages,
  // the star graph and beat pages are all deliberately deprioritised, and
  // none of that needs a server). The adapter exists for the one exception:
  // /admin/*, which sets `export const prerender = false` and needs a
  // runtime to render on request. worker/index.js stays the deployed
  // entrypoint and delegates into this adapter's own handler - see its
  // comment for why.
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    sitemap({
      filter: (page) => {
        try {
          return !EXCLUDED.includes(new URL(page).pathname);
        } catch {
          return true;
        }
      },
      serialize(item) {
        let pathname;
        try {
          pathname = new URL(item.url).pathname;
        } catch {
          pathname = item.url === '' ? '/' : item.url;
        }

        if (pathname === '/') {
          // The front page is reprinted every edition.
          item.changefreq = EnumChangefreq.WEEKLY;
          item.priority = 1.0;
        } else if (EDITION.test(pathname)) {
          // A published edition is final; its date is its last modification.
          item.changefreq = EnumChangefreq.YEARLY;
          item.priority = 0.6;
          item.lastmod = `${pathname.slice(1, 11)}T00:00:00+00:00`;
        } else if (pathname.startsWith('/alternatives/') || pathname.startsWith('/industry/')) {
          // The evergreen surfaces: re-ranked whenever a new edition lands.
          item.changefreq = EnumChangefreq.WEEKLY;
          item.priority = 0.9;
        } else if (pathname.startsWith('/repo/')) {
          item.changefreq = EnumChangefreq.WEEKLY;
          item.priority = 0.7;
        } else {
          item.changefreq = EnumChangefreq.WEEKLY;
          item.priority = 0.5;
        }

        return item;
      },
    }),
  ],
});
