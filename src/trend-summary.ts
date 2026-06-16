/**
 * Pure, side-effect-free trend math shared by the `trends` CLI
 * (src/trend-view.ts) and the dashboard trends page (site/src/pages/trends.astro).
 *
 * Keeping the delta / improved-regressed-unchanged / average-delta computation
 * in one place stops the CLI output and the dashboard from drifting apart.
 * This module imports no I/O or rendering deps so it is safe to import at
 * Astro build time.
 */

import type { TrendSnapshot, TrendRepoEntry } from "./trend.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TrendDelta {
  slug: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  previousLetter: string;
  currentLetter: string;
  dimensionDeltas: Record<string, number>;
}

export interface TrendSummary {
  previousMonth: string;
  currentMonth: string;
  totalRepos: number;
  improved: number;
  regressed: number;
  unchanged: number;
  averageDelta: number;
  biggestGainers: TrendDelta[];
  biggestLosers: TrendDelta[];
  newRepos: TrendRepoEntry[];
  droppedRepos: string[];
}

// ── Analysis ────────────────────────────────────────────────────────────────

/**
 * Compute per-repo score deltas between two snapshots, along with the repos
 * that are new (only in `current`) or dropped (only in `previous`). Repos with
 * an `error` in either snapshot are ignored.
 */
export function computeRepoDeltas(
  previous: TrendSnapshot,
  current: TrendSnapshot,
): { deltas: TrendDelta[]; newRepos: TrendRepoEntry[]; droppedRepos: string[] } {
  const prevMap = new Map(
    previous.repos
      .filter((r) => !r.error)
      .map((r) => [r.slug, r])
  );
  const currMap = new Map(
    current.repos
      .filter((r) => !r.error)
      .map((r) => [r.slug, r])
  );

  const deltas: TrendDelta[] = [];
  const newRepos: TrendRepoEntry[] = [];
  const droppedRepos: string[] = [];

  // Compute deltas for repos in both snapshots
  for (const [slug, curr] of currMap) {
    const prev = prevMap.get(slug);
    if (!prev) {
      newRepos.push(curr);
      continue;
    }

    const dimensionDeltas: Record<string, number> = {};
    for (const [dimName, dimScore] of Object.entries(curr.dimensions)) {
      const prevDimScore = prev.dimensions[dimName] ?? 0;
      dimensionDeltas[dimName] = dimScore - prevDimScore;
    }

    deltas.push({
      slug,
      previousScore: prev.score,
      currentScore: curr.score,
      delta: curr.score - prev.score,
      previousLetter: prev.letter,
      currentLetter: curr.letter,
      dimensionDeltas,
    });
  }

  // Find dropped repos (in previous but not current)
  for (const slug of prevMap.keys()) {
    if (!currMap.has(slug)) {
      droppedRepos.push(slug);
    }
  }

  return { deltas, newRepos, droppedRepos };
}

export function computeTrendSummary(
  previous: TrendSnapshot,
  current: TrendSnapshot,
): TrendSummary {
  const { deltas, newRepos, droppedRepos } = computeRepoDeltas(previous, current);

  const improved = deltas.filter((d) => d.delta > 0).length;
  const regressed = deltas.filter((d) => d.delta < 0).length;
  const unchanged = deltas.filter((d) => d.delta === 0).length;
  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);
  const averageDelta = deltas.length > 0 ? Math.round((totalDelta / deltas.length) * 10) / 10 : 0;

  // Sort by delta descending for gainers, ascending for losers
  const sorted = [...deltas].sort((a, b) => b.delta - a.delta);
  const biggestGainers = sorted.filter((d) => d.delta > 0).slice(0, 5);
  const biggestLosers = sorted.filter((d) => d.delta < 0).reverse().slice(0, 5);

  return {
    previousMonth: previous.meta.month,
    currentMonth: current.meta.month,
    totalRepos: deltas.length,
    improved,
    regressed,
    unchanged,
    averageDelta,
    biggestGainers,
    biggestLosers,
    newRepos,
    droppedRepos,
  };
}
