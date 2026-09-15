// Shared measurement helpers for The Fork Times.
//
// Raw star count is deliberately NOT the headline number: it reproduces the
// list gitstar-ranking and ossinsight already publish, and it rewards
// decade-old incumbents for work they did years ago. The headline is star
// velocity - stars gained over the last seven days.
//
// Velocity needs two snapshots a week apart, which a cold database does not
// have. Until then `stars_per_day` (stars divided by repo age) stands in: it
// is computable from a single observation and still surfaces fast-growing
// young projects rather than incumbents.
//
// The actual candidate ranking (what makes an edition's slate and in what
// order) now happens in D1: worker/index.js's weeklyEdition() computes it
// directly against repo_velocity with its own, simpler step-function score,
// so this file no longer carries a rankCandidates() of its own - the Worker
// runtime is deliberately self-contained (see AGENTS.md). What is left here
// is the small, stateless arithmetic still used at read time by
// src/lib/edition-data.ts and scripts/blurbs.js's prompt.

const DAY_MS = 86400000;

export function daysSince(iso) {
	if (!iso) return null;
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return null;
	return Math.max(1, (Date.now() - then) / DAY_MS);
}

export function starsPerDay(repo) {
	const age = daysSince(repo.repo_created_at);
	if (!age || !repo.stars) return null;
	return repo.stars / age;
}

export function forkRatio(repo) {
	if (!repo.stars) return null;
	return repo.forks / repo.stars;
}
