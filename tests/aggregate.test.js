import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { computeAggregate, isGraded } = await import("../dist/aggregate.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReport(overrides = {}) {
  return {
    repo: "owner/repo",
    letter: "B",
    overall: 75,
    graded: true,
    dimensions: [
      {
        name: "Security",
        score: 80,
        findings: [
          { name: "SECURITY.md", passed: true, detail: "found", weight: 10 },
          { name: "CI workflows", passed: false, detail: "none", weight: 10 },
        ],
        durationMs: 100,
      },
      {
        name: "Testing",
        score: 70,
        findings: [
          { name: "Test files", passed: true, detail: "5 files", weight: 20 },
        ],
        durationMs: 50,
      },
    ],
    totalDurationMs: 150,
    projectType: "application",
    language: "TypeScript",
    analyzedAt: new Date().toISOString(),
    toolVersion: "1.0.0",
    ...overrides,
  };
}

// ── isGraded ───────────────────────────────────────────────────────────────

describe("isGraded", () => {
  it("returns true when graded field is true", () => {
    assert.equal(isGraded(makeReport({ graded: true })), true);
  });

  it("returns false when graded field is false", () => {
    assert.equal(isGraded(makeReport({ graded: false })), false);
  });

  it("returns true when graded is undefined and type is application", () => {
    const report = makeReport({ projectType: "application" });
    delete report.graded;
    assert.equal(isGraded(report), true);
  });

  it("returns false when graded is undefined and type is documentation", () => {
    const report = makeReport({ projectType: "documentation" });
    delete report.graded;
    assert.equal(isGraded(report), false);
  });
});

// ── computeAggregate ───────────────────────────────────────────────────────

describe("computeAggregate", () => {
  it("computes correct totals for a mix of code and doc repos", () => {
    const reports = [
      makeReport({ letter: "A", overall: 95 }),
      makeReport({ letter: "B", overall: 80 }),
      makeReport({ graded: false, letter: "N/A", overall: 50, projectType: "documentation" }),
    ];

    const agg = computeAggregate(reports);
    assert.equal(agg.totalRepos, 3);
    assert.equal(agg.codeRepos, 2);
    assert.equal(agg.documentationRepos, 1);
  });

  it("computes correct grade distribution", () => {
    const reports = [
      makeReport({ letter: "A", overall: 95 }),
      makeReport({ letter: "A", overall: 92 }),
      makeReport({ letter: "B", overall: 85 }),
      makeReport({ letter: "F", overall: 40 }),
    ];

    const agg = computeAggregate(reports);
    assert.equal(agg.gradeDistribution.A, 2);
    assert.equal(agg.gradeDistribution.B, 1);
    assert.equal(agg.gradeDistribution.C, 0);
    assert.equal(agg.gradeDistribution.D, 0);
    assert.equal(agg.gradeDistribution.F, 1);
  });

  it("computes correct average overall score (code repos only)", () => {
    const reports = [
      makeReport({ letter: "A", overall: 90 }),
      makeReport({ letter: "B", overall: 80 }),
      makeReport({ graded: false, overall: 50, projectType: "documentation" }),
    ];

    const agg = computeAggregate(reports);
    assert.equal(agg.averageOverall, 85); // (90 + 80) / 2
  });

  it("computes dimension averages with min/max", () => {
    const reports = [
      makeReport({
        dimensions: [
          { name: "Security", score: 60, findings: [], durationMs: 0 },
          { name: "Testing", score: 80, findings: [], durationMs: 0 },
        ],
      }),
      makeReport({
        dimensions: [
          { name: "Security", score: 100, findings: [], durationMs: 0 },
          { name: "Testing", score: 40, findings: [], durationMs: 0 },
        ],
      }),
    ];

    const agg = computeAggregate(reports);
    const sec = agg.dimensionAverages.find((d) => d.name === "Security");
    const test = agg.dimensionAverages.find((d) => d.name === "Testing");

    assert.ok(sec);
    assert.equal(sec.averageScore, 80); // (60 + 100) / 2
    assert.equal(sec.minScore, 60);
    assert.equal(sec.maxScore, 100);

    assert.ok(test);
    assert.equal(test.averageScore, 60); // (80 + 40) / 2
    assert.equal(test.minScore, 40);
    assert.equal(test.maxScore, 80);
  });

  it("computes type and language breakdowns", () => {
    const reports = [
      makeReport({ projectType: "application", language: "TypeScript" }),
      makeReport({ projectType: "application", language: "Python" }),
      makeReport({ projectType: "library", language: "TypeScript" }),
    ];

    const agg = computeAggregate(reports);
    assert.equal(agg.typeBreakdown.application, 2);
    assert.equal(agg.typeBreakdown.library, 1);
    assert.equal(agg.languageBreakdown.TypeScript, 2);
    assert.equal(agg.languageBreakdown.Python, 1);
  });

  it("computes check pass/fail stats", () => {
    const reports = [
      makeReport({
        dimensions: [{
          name: "Security",
          score: 80,
          findings: [
            { name: "SECURITY.md", passed: true, detail: "", weight: 10 },
            { name: "CI workflows", passed: true, detail: "", weight: 10 },
          ],
          durationMs: 0,
        }],
      }),
      makeReport({
        dimensions: [{
          name: "Security",
          score: 50,
          findings: [
            { name: "SECURITY.md", passed: false, detail: "", weight: 10 },
            { name: "CI workflows", passed: true, detail: "", weight: 10 },
          ],
          durationMs: 0,
        }],
      }),
    ];

    const agg = computeAggregate(reports);

    // CI workflows: 2 pass, 0 fail → 100% pass rate → should be in topPassing
    const ciCheck = agg.topPassingChecks.find((c) => c.name.includes("CI workflows"));
    assert.ok(ciCheck);
    assert.equal(ciCheck.passCount, 2);
    assert.equal(ciCheck.failCount, 0);
    assert.equal(ciCheck.passRate, 100);

    // SECURITY.md: 1 pass, 1 fail → 50% pass rate
    const secCheck = agg.topPassingChecks.find((c) => c.name.includes("SECURITY.md"));
    assert.ok(secCheck);
    assert.equal(secCheck.passRate, 50);
  });

  it("handles empty reports array", () => {
    const agg = computeAggregate([]);
    assert.equal(agg.totalRepos, 0);
    assert.equal(agg.codeRepos, 0);
    assert.equal(agg.documentationRepos, 0);
    assert.equal(agg.averageOverall, 0);
    assert.equal(agg.dimensionAverages.length, 0);
  });

  it("handles null language as 'unknown'", () => {
    const reports = [
      makeReport({ language: null }),
    ];

    const agg = computeAggregate(reports);
    assert.equal(agg.languageBreakdown.unknown, 1);
  });

  it("returns generatedAt timestamp", () => {
    const agg = computeAggregate([makeReport()]);
    assert.ok(agg.generatedAt);
    assert.ok(new Date(agg.generatedAt).getTime() > 0);
  });
});
