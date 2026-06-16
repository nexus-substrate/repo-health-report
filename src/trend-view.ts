#!/usr/bin/env node

/**
 * Trend viewer for repo-health-report.
 *
 * Reads trend snapshot JSON files and displays:
 * - Score deltas between the two most recent months
 * - Biggest movers (improved/regressed)
 * - Overall fleet health trajectory
 *
 * Usage:
 *   node dist/trend-view.js
 *   node dist/trend-view.js --dir data/trends
 *   node dist/trend-view.js --json
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { TrendSnapshot } from "./trend.js";

// The trend math lives in a pure, side-effect-free module so the dashboard
// (site/src/pages/trends.astro) can reuse it at build time. Re-exported here
// for backward compatibility with existing importers/tests.
export {
  computeTrendSummary,
  computeRepoDeltas,
  type TrendDelta,
  type TrendSummary,
} from "./trend-summary.js";

import { computeTrendSummary, type TrendSummary } from "./trend-summary.js";

// ── Loading ─────────────────────────────────────────────────────────────────

async function loadTrendFiles(dir: string): Promise<TrendSnapshot[]> {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const jsonFiles = entries
    .filter((f) => f.endsWith(".json"))
    .sort(); // YYYY-MM.json sorts chronologically

  const snapshots: TrendSnapshot[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(dir, file), "utf-8");
      snapshots.push(JSON.parse(content) as TrendSnapshot);
    } catch {
      // Skip malformed files
    }
  }
  return snapshots;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function deltaStr(delta: number): string {
  if (delta > 0) return chalk.green(`+${delta}`);
  if (delta < 0) return chalk.red(`${delta}`);
  return chalk.gray("±0");
}

function renderSummary(summary: TrendSummary): void {
  console.log(chalk.bold("\n  Trend Report"));
  console.log(chalk.gray(`  ${summary.previousMonth} → ${summary.currentMonth}`));
  console.log(chalk.gray("  " + "─".repeat(50)));
  console.log("");

  console.log(`  Repos tracked:  ${summary.totalRepos}`);
  console.log(`  Improved:       ${chalk.green(String(summary.improved))}`);
  console.log(`  Regressed:      ${chalk.red(String(summary.regressed))}`);
  console.log(`  Unchanged:      ${chalk.gray(String(summary.unchanged))}`);
  console.log(`  Avg delta:      ${deltaStr(summary.averageDelta)}`);
  console.log("");

  if (summary.biggestGainers.length > 0) {
    console.log(chalk.bold("  Biggest Gainers:"));
    for (const d of summary.biggestGainers) {
      console.log(
        `    ${deltaStr(d.delta).padEnd(16)} ${d.slug.padEnd(35)} ${d.previousLetter}→${d.currentLetter}  (${d.previousScore}→${d.currentScore})`
      );
    }
    console.log("");
  }

  if (summary.biggestLosers.length > 0) {
    console.log(chalk.bold("  Biggest Regressions:"));
    for (const d of summary.biggestLosers) {
      console.log(
        `    ${deltaStr(d.delta).padEnd(16)} ${d.slug.padEnd(35)} ${d.previousLetter}→${d.currentLetter}  (${d.previousScore}→${d.currentScore})`
      );
    }
    console.log("");
  }

  if (summary.newRepos.length > 0) {
    console.log(chalk.bold(`  New repos (${summary.newRepos.length}):`));
    for (const r of summary.newRepos.slice(0, 5)) {
      console.log(`    ${chalk.cyan("+")} ${r.slug}: ${r.letter} (${r.score}/100)`);
    }
    if (summary.newRepos.length > 5) {
      console.log(chalk.gray(`    ... and ${summary.newRepos.length - 5} more`));
    }
    console.log("");
  }

  if (summary.droppedRepos.length > 0) {
    console.log(chalk.bold(`  Dropped repos (${summary.droppedRepos.length}):`));
    for (const slug of summary.droppedRepos.slice(0, 5)) {
      console.log(`    ${chalk.red("−")} ${slug}`);
    }
    console.log("");
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let dir = "data/trends";
  let jsonOutput = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--dir" && process.argv[i + 1]) {
      dir = process.argv[++i];
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
${chalk.bold("repo-health-report trends")} — View score changes over time

${chalk.bold("Usage:")}
  node dist/trend-view.js                 Show latest trend comparison
  node dist/trend-view.js --json          Output as JSON
  node dist/trend-view.js --dir <path>    Custom trends directory

${chalk.bold("Options:")}
  --dir <path>    Trends directory (default: data/trends)
  --json          Output JSON instead of terminal rendering
  --help, -h      Show this help
`);
      process.exit(0);
    }
  }

  const snapshots = await loadTrendFiles(dir);

  if (snapshots.length === 0) {
    console.log(chalk.yellow("\n  No trend data found in " + dir));
    console.log(chalk.gray("  Run `npm run trend` to generate your first snapshot.\n"));
    process.exit(0);
  }

  if (snapshots.length === 1) {
    const snap = snapshots[0];
    console.log(chalk.bold(`\n  First snapshot: ${snap.meta.month}`));
    console.log(chalk.gray(`  ${snap.meta.successCount} repos analyzed, ${snap.meta.failCount} failed`));
    console.log(chalk.gray("  Run again next month to see trends.\n"));

    const successful = snap.repos.filter((r) => !r.error);
    const avgScore = successful.length > 0
      ? Math.round(successful.reduce((sum, r) => sum + r.score, 0) / successful.length)
      : 0;
    console.log(`  Average score: ${avgScore}/100`);
    const gradeCount: Record<string, number> = {};
    for (const r of successful) {
      gradeCount[r.letter] = (gradeCount[r.letter] ?? 0) + 1;
    }
    for (const [letter, count] of Object.entries(gradeCount).sort()) {
      console.log(`    ${letter}: ${count} repos`);
    }
    console.log("");
    process.exit(0);
  }

  // Compare the two most recent snapshots
  const previous = snapshots[snapshots.length - 2];
  const current = snapshots[snapshots.length - 1];
  const summary = computeTrendSummary(previous, current);

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    renderSummary(summary);
  }
}

main().catch((err: unknown) => {
  console.error(chalk.red(`Fatal: ${(err as Error).message}`));
  process.exit(1);
});
