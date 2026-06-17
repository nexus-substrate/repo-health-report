import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { detectPlatform } = await import("../dist/platforms.js");

describe("detectPlatform", () => {
  // ── GitHub ────────────────────────────────────────────────────────────

  it("detects github.com URL", () => {
    const result = detectPlatform("https://github.com/facebook/react");
    assert.equal(result.platform, "github");
    assert.equal(result.slug, "facebook/react");
    assert.equal(result.apiBase, "https://api.github.com");
    assert.equal(result.webBase, "https://github.com");
  });

  it("detects plain owner/repo as GitHub (default)", () => {
    const result = detectPlatform("owner/repo");
    assert.equal(result.platform, "github");
    assert.equal(result.slug, "owner/repo");
  });

  it("strips .git suffix from GitHub URL", () => {
    const result = detectPlatform("https://github.com/owner/repo.git");
    assert.equal(result.slug, "owner/repo");
    assert.equal(result.platform, "github");
  });

  // ── GitLab ────────────────────────────────────────────────────────────

  it("detects gitlab.com URL", () => {
    const result = detectPlatform("https://gitlab.com/inkscape/inkscape");
    assert.equal(result.platform, "gitlab");
    assert.equal(result.slug, "inkscape/inkscape");
    assert.equal(result.apiBase, "https://gitlab.com/api/v4");
    assert.equal(result.webBase, "https://gitlab.com");
  });

  it("detects gitlab.com URL with /-/ path suffix", () => {
    const result = detectPlatform(
      "https://gitlab.com/inkscape/inkscape/-/tree/master"
    );
    assert.equal(result.platform, "gitlab");
    assert.equal(result.slug, "inkscape/inkscape");
  });

  it("detects gitlab.com URL with .git suffix", () => {
    const result = detectPlatform(
      "https://gitlab.com/owner/repo.git"
    );
    assert.equal(result.platform, "gitlab");
    assert.equal(result.slug, "owner/repo");
  });

  it("throws on malformed gitlab.com URL", () => {
    assert.throws(
      () => detectPlatform("https://gitlab.com/"),
      /Could not parse GitLab repo/
    );
  });

  // ── Codeberg ──────────────────────────────────────────────────────────

  it("detects codeberg.org URL", () => {
    const result = detectPlatform("https://codeberg.org/forgejo/forgejo");
    assert.equal(result.platform, "codeberg");
    assert.equal(result.slug, "forgejo/forgejo");
    assert.equal(result.apiBase, "https://codeberg.org/api/v1");
    assert.equal(result.webBase, "https://codeberg.org");
  });

  it("detects codeberg.org URL with trailing slash", () => {
    const result = detectPlatform("https://codeberg.org/owner/repo/");
    assert.equal(result.platform, "codeberg");
    assert.equal(result.slug, "owner/repo");
  });

  it("throws on malformed codeberg.org URL", () => {
    assert.throws(
      () => detectPlatform("https://codeberg.org/"),
      /Could not parse Codeberg repo/
    );
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it("throws on completely invalid input", () => {
    assert.throws(() => detectPlatform("not-a-repo"), /Invalid repo format/);
  });

  it("handles HTTP (non-HTTPS) GitLab URLs", () => {
    const result = detectPlatform("http://gitlab.com/owner/repo");
    assert.equal(result.platform, "gitlab");
    assert.equal(result.slug, "owner/repo");
  });

  it("handles dotted repo names", () => {
    const result = detectPlatform("https://github.com/owner/repo.js");
    assert.equal(result.platform, "github");
    assert.equal(result.slug, "owner/repo.js");
  });

  it("detects bare-host gitlab.com (no scheme)", () => {
    const result = detectPlatform("gitlab.com/owner/repo");
    assert.equal(result.platform, "gitlab");
    assert.equal(result.slug, "owner/repo");
  });

  // ── Host-spoofing rejection (js/incomplete-url-substring-sanitization) ──

  it("does NOT treat suffix-spoof 'gitlab.com.evil.com' as GitLab", () => {
    // Real host is evil.com; must not be classified as GitLab. It falls to the
    // GitHub default, where the spoofed-host URL is rejected outright.
    assert.throws(
      () => detectPlatform("https://gitlab.com.evil.com/owner/repo"),
      /Invalid repo format/
    );
  });

  it("does NOT treat look-alike 'evil-gitlab.com' as GitLab", () => {
    assert.throws(
      () => detectPlatform("https://evil-gitlab.com/owner/repo"),
      /Invalid repo format/
    );
  });

  it("does NOT treat suffix-spoof 'codeberg.org.evil.com' as Codeberg", () => {
    assert.throws(
      () => detectPlatform("https://codeberg.org.evil.com/owner/repo"),
      /Invalid repo format/
    );
  });

  it("rejects credential-host spoof 'https://github.com@evil.com'", () => {
    // URL host is evil.com, not github.com — parseGitHubSlug must reject it.
    assert.throws(
      () => detectPlatform("https://github.com@evil.com/owner/repo"),
      /Invalid repo format/
    );
  });

  it("rejects credential-host spoof 'https://gitlab.com@evil.com'", () => {
    assert.throws(
      () => detectPlatform("https://gitlab.com@evil.com/owner/repo"),
      /Invalid repo format/
    );
  });

  it("still accepts a real gitlab.com subdomain host", () => {
    // Self-managed GitLab on a subdomain should still resolve to GitLab.
    const result = detectPlatform("https://repo.gitlab.com/owner/repo");
    assert.equal(result.platform, "gitlab");
  });
});
