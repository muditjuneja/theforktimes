// Site identity for the Node-side scripts.
//
// src/config.ts is the source of truth for the site itself, but it is a TS
// module the build consumes; the export scripts run under plain node and would
// otherwise re-parse it with a regex. Kept in step by hand — it is four fields
// that change roughly never.
export const SITE = {
	name: 'The Fork Times',
	description: 'A weekly newspaper for open source, ranked by what is actually moving.',
	url: 'https://theforktimes.com',
	twitter: '@forktimeshq',
};
