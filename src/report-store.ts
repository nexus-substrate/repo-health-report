/**
 * Shared helpers for reading stored batch reports from data/reports/.
 *
 * Both `export.ts` and `aggregate.ts` consume the same on-disk report JSON,
 * so the file-discovery, parsing and grading helpers live here to keep their
 * behavior in lockstep (previously they were duplicated byte-for-byte).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DimensionResult } from "./dimensions/security.js";
import type { LanguageBreakdownEntry } from "./analyze.js";
import type { TreeAnalytics } from "./tree-analytics.js";

/**
 * A single repo report as persisted under data/reports/.
 *
 * This is the permissive superset consumed by both export.ts and aggregate.ts:
 * `projectType` is a plain string (the analyze `ProjectType` union is a subset)
 * and the enrichment fields are optional, present only on richer export reports.
 */
export interface StoredReport {
  repo: string;
  letter: string;
  overall: number;
  graded?: boolean;
  dimensions: Array<DimensionResult & { durationMs?: number }>;
  totalDurationMs: number;
  projectType: string;
  language: string | null;
  languages?: { primary: string; all: LanguageBreakdownEntry[] };
  analyzedAt: string;
  toolVersion: string;
  // Enriched metadata (export reports only)
  description?: string;
  topics?: string[];
  pushed_at?: string;
  created_at?: string;
  forks_count?: number;
  size?: number;
  has_discussions?: boolean;
  // Tree analytics
  treeAnalytics?: Partial<TreeAnalytics>;
}

export interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

/**
 * Recursively find all JSON files under a directory.
 */
export async function findJsonFiles(dir: string): Promise<string[]> {
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
 * Load and parse a single report file. Returns null on parse failure.
 */
export async function loadReport(filePath: string): Promise<StoredReport | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as StoredReport;
  } catch {
    return null;
  }
}

/**
 * Whether a stored report is for a graded (code) repository.
 * Reports without the `graded` field fall back to checking projectType.
 */
export function isGraded(report: StoredReport): boolean {
  if (report.graded !== undefined) {
    return report.graded;
  }
  return report.projectType !== "documentation";
}
