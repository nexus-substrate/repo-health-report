#!/usr/bin/env node

/**
 * Aggregate stats from stored batch reports.
 *
 * Reads all JSON files in data/reports/, computes summary statistics,
 * and writes data/aggregate.json.
 *
 * Usage: node dist/aggregate.js
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import type { DimensionResult, Finding } from "./dimensions/security.js";
import type { ProjectType } from "./analyze.js";

const DATA_DIR = join(process.cwd(), "data");
const REPORTS_DIR = join(DATA_DIR, "reports");
const AGGREGATE_PATH = join(DATA_DIR, "aggregate.json");
const INDEX_PATH = join(DATA_DIR, "index.json");

interface StoredReport {
  repo: string;
  letter: string;
  overall: number;
  graded?: boolean;
  dimensions: DimensionResult[];
  totalDurationMs: number;
  projectType: ProjectType;
  language: string | null;
  analyzedAt: string;
  toolVersion: string;
}

interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

interface DimensionAverage {
  name: string;
  averageScore: number;
  minScore: number;
  maxScore: number;
}

interface CheckStat {
  name: string;
  passCount: number;
  failCount: number;
  passRate: number;
}

interface AggregateResult {
  totalRepos: number;
  codeRepos: number;
  documentationRepos: number;
  generatedAt: string;
  gradeDistribution: GradeDistribution;
  averageOverall: number;
  dimensionAverages: DimensionAverage[];
  typeBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  topPassingChecks: CheckStat[];
  topFailingChecks: CheckStat[];
}

/**
 * Recursively find all JSON files under a directory.
 */
async function findJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findJsonFiles(fullPath);
      files.push(...nested);
    } else if (entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Load and parse a report file.
 */
async function loadReport(filePath: string): Promise<StoredReport | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as StoredReport;
  } catch {
    return null;
  }
}

/**
 * Determine whether a stored report represents a graded (code) repo.
 * Older reports without the `graded` field are treated as graded unless
 * their projectType is "documentation".
 */
export function isGraded(report: StoredReport): boolean {
  if (report.graded !== undefined) {
    return report.graded;
  }
  return report.projectType !== "documentation";
}

/**
 * Compute aggregate statistics from all reports.
 * Documentation repos are counted separately and excluded from grade
 * distribution and average score calculations.
 */
export function computeAggregate(reports: StoredReport[]): AggregateResult {
  const gradeDistribution: GradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const typeBreakdown: Record<string, number> = {};
  const languageBreakdown: Record<string, number> = {};
  const dimensionScores: Record<string, number[]> = {};
  const checkStats: Record<string, { pass: number; fail: number }> = {};

  let totalOverall = 0;
  let codeRepos = 0;
  let documentationRepos = 0;

  for (const report of reports) {
    const graded = isGraded(report);

    if (graded) {
      // Grade distribution — only code repos
      const grade = report.letter as keyof GradeDistribution;
      if (grade in gradeDistribution) {
        gradeDistribution[grade]++;
      }
      totalOverall += report.overall;
      codeRepos++;
    } else {
      documentationRepos++;
    }

    // Type breakdown includes all repos
    const pType = report.projectType ?? "unknown";
    typeBreakdown[pType] = (typeBreakdown[pType] ?? 0) + 1;

    // Language breakdown includes all repos
    const lang = report.language ?? "unknown";
    languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1;

    // Dimension scores and check stats include all repos
    for (const dim of report.dimensions) {
      if (!dimensionScores[dim.name]) {
        dimensionScores[dim.name] = [];
      }
      dimensionScores[dim.name].push(dim.score);

      // Check-level stats
      for (const finding of dim.findings) {
        const key = `${dim.name}: ${finding.name}`;
        if (!checkStats[key]) {
          checkStats[key] = { pass: 0, fail: 0 };
        }
        if (finding.passed) {
          checkStats[key].pass++;
        } else {
          checkStats[key].fail++;
        }
      }
    }
  }

  // Dimension averages
  const dimensionAverages: DimensionAverage[] = Object.entries(dimensionScores)
    .map(([name, scores]) => ({
      name,
      averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Check stats sorted by pass/fail rate
  const allChecks: CheckStat[] = Object.entries(checkStats).map(
    ([name, stats]) => ({
      name,
      passCount: stats.pass,
      failCount: stats.fail,
      passRate: Math.round((stats.pass / (stats.pass + stats.fail)) * 100),
    })
  );

  const topPassingChecks = [...allChecks]
    .sort((a, b) => b.passRate - a.passRate || b.passCount - a.passCount)
    .slice(0, 15);

  const topFailingChecks = [...allChecks]
    .sort((a, b) => a.passRate - b.passRate || b.failCount - a.failCount)
    .slice(0, 15);

  return {
    totalRepos: reports.length,
    codeRepos,
    documentationRepos,
    generatedAt: new Date().toISOString(),
    gradeDistribution,
    averageOverall: codeRepos > 0
      ? Math.round(totalOverall / codeRepos)
      : 0,
    dimensionAverages,
    typeBreakdown,
    languageBreakdown,
    topPassingChecks,
    topFailingChecks,
  };
}

function printAggregate(agg: AggregateResult): void {
  console.log(chalk.bold(`\n  Aggregate Report (${agg.totalRepos} repos)\n`));

  // Code vs documentation split
  console.log(
    `  Code Repos:          ${agg.codeRepos} analyzed, average ${agg.averageOverall}/100`
  );
  console.log(
    `  Documentation Repos: ${agg.documentationRepos} analyzed (not graded)\n`
  );

  // Grade distribution (code repos only)
  console.log(chalk.bold("  Grade Distribution (code repos only):"));
  const grades: Array<keyof GradeDistribution> = ["A", "B", "C", "D", "F"];
  for (const g of grades) {
    const count = agg.gradeDistribution[g];
    const bar = "#".repeat(count);
    console.log(`    ${g}: ${String(count).padStart(4)} ${chalk.gray(bar)}`);
  }
  console.log(`\n    Average: ${agg.averageOverall}/100\n`);

  // Dimension averages
  console.log(chalk.bold("  Dimension Averages:"));
  for (const dim of agg.dimensionAverages) {
    console.log(
      `    ${dim.name.padEnd(20)} avg=${dim.averageScore} min=${dim.minScore} max=${dim.maxScore}`
    );
  }

  // Type breakdown
  console.log(chalk.bold("\n  Project Types:"));
  for (const [type, count] of Object.entries(agg.typeBreakdown).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`    ${type.padEnd(15)} ${count}`);
  }

  // Language breakdown (top 10)
  console.log(chalk.bold("\n  Top Languages:"));
  const langEntries = Object.entries(agg.languageBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [lang, count] of langEntries) {
    console.log(`    ${lang.padEnd(15)} ${count}`);
  }

  // Most common failing checks
  console.log(chalk.bold("\n  Most Common Failing Checks:"));
  for (const check of agg.topFailingChecks.slice(0, 10)) {
    console.log(
      `    ${check.name.padEnd(45)} fail=${check.failCount} (${check.passRate}% pass)`
    );
  }

  console.log("");
}

async function main(): Promise<void> {
  console.log(chalk.gray("  Scanning reports..."));

  const jsonFiles = await findJsonFiles(REPORTS_DIR);
  if (jsonFiles.length === 0) {
    console.log(
      chalk.yellow(
        "  No reports found in data/reports/. Run batch analysis first."
      )
    );
    process.exit(0);
  }

  console.log(chalk.gray(`  Found ${jsonFiles.length} report files`));

  const reports: StoredReport[] = [];
  for (const file of jsonFiles) {
    const report = await loadReport(file);
    if (report) {
      reports.push(report);
    }
  }

  console.log(chalk.gray(`  Loaded ${reports.length} valid reports`));

  const aggregate = computeAggregate(reports);

  // Write aggregate.json
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    AGGREGATE_PATH,
    JSON.stringify(aggregate, null, 2),
    "utf-8"
  );
  console.log(chalk.gray(`  Aggregate written to ${AGGREGATE_PATH}`));

  // Also update index.json from reports
  const indexEntries = reports.map((r) => ({
    slug: r.repo,
    grade: r.letter,
    score: r.overall,
    type: r.projectType,
    language: r.language,
    reportPath: `reports/${sanitizeForPath(r.repo)}/${r.analyzedAt.replace(/:/g, "-")}.json`,
    analyzedAt: r.analyzedAt,
  }));

  indexEntries.sort((a, b) => a.slug.localeCompare(b.slug));

  await writeFile(
    INDEX_PATH,
    JSON.stringify({ repos: indexEntries }, null, 2),
    "utf-8"
  );
  console.log(chalk.gray(`  Index written to ${INDEX_PATH}`));

  // Print to terminal
  printAggregate(aggregate);
}

function sanitizeForPath(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._/-]/g, "_");
}

main().catch((err: unknown) => {
  console.error(chalk.red(`Fatal: ${(err as Error).message}`));
  process.exit(1);
});
