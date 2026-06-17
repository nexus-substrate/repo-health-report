import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { treeHasPattern, treeCountPattern } from "../dist/analyze.js";

/** Helper: build a RepoTree from a list of path strings (all blobs). */
function mockTree(paths) {
  return { tree: paths.map((p) => ({ path: p, type: "blob" })) };
}

describe("treeHasPattern / treeCountPattern", () => {
  // ── Behavior preservation ─────────────────────────────────────────────

  it("matches legitimate CodeQL workflow paths", () => {
    const tree = mockTree([
      "README.md",
      ".github/workflows/codeql.yml",
    ]);
    assert.equal(
      treeHasPattern(tree, /\.github\/workflows\/.*codeql.*\.ya?ml$/),
      true
    );
  });

  it("matches with the .yaml (long) extension too", () => {
    const tree = mockTree([".github/workflows/codeql-analysis.yaml"]);
    assert.equal(treeHasPattern(tree, /codeql.*\.ya?ml$/), true);
  });

  it("does not match unrelated paths", () => {
    const tree = mockTree(["src/index.ts", "docs/guide.md"]);
    assert.equal(treeHasPattern(tree, /codeql.*\.ya?ml$/), false);
  });

  it("counts only matching entries", () => {
    const tree = mockTree([
      ".github/workflows/codeql.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/codeql-extended.yaml",
    ]);
    assert.equal(
      treeCountPattern(tree, /codeql.*\.ya?ml$/),
      2
    );
  });

  // ── ReDoS hardening (js/polynomial-redos) ─────────────────────────────

  it("returns quickly on an adversarial long path that forces backtracking", () => {
    // Pattern of the shape prefix.*X.*suffix$ — the classic polynomial
    // backtracking case when the trailing suffix never matches.
    const pattern = /\.github\/workflows\/.*codeql.*\.ya?ml$/;
    // Long path that starts like the prefix but can never satisfy the `$`
    // suffix, which is what drives the worst-case backtracking.
    const evil =
      ".github/workflows/codeql" + "a".repeat(200_000) + "!";
    const tree = mockTree([evil]);

    const start = process.hrtime.bigint();
    const result = treeHasPattern(tree, pattern);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.equal(result, false);
    // Without the length bound this regex can take seconds-to-minutes on
    // such input; bounded, it must complete near-instantly.
    assert.ok(
      elapsedMs < 250,
      `expected bounded match time, took ${elapsedMs.toFixed(1)}ms`
    );
  });

  it("over-long paths never match (skipped before regex runs)", () => {
    const longButValid =
      ".github/workflows/codeql" + "a".repeat(10_000) + ".yml";
    const tree = mockTree([longButValid]);
    // Path exceeds the 4096-byte git path bound, so it is skipped.
    assert.equal(
      treeHasPattern(tree, /\.github\/workflows\/.*codeql.*\.ya?ml$/),
      false
    );
  });
});
