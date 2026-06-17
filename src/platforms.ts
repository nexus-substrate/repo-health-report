/**
 * Platform detection and configuration for multi-forge support.
 * Issue #19: GitLab and Codeberg/Gitea API support.
 */

export type Platform = "github" | "gitlab" | "codeberg";

export interface PlatformConfig {
  platform: Platform;
  slug: string; // owner/repo
  apiBase: string; // e.g., https://gitlab.com/api/v4
  webBase: string; // e.g., https://gitlab.com
}

/**
 * Strip trailing slashes, .git suffix, and GitLab's /-/... paths from a slug.
 */
function cleanSlug(raw: string): string {
  return raw
    .replace(/\/-\/.*$/, "") // GitLab /-/tree/main etc.
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/**
 * Parse a GitHub slug from a URL or plain "owner/repo" string.
 * Re-uses the logic from analyze.ts but without throwing on non-GitHub inputs.
 */
function parseGitHubSlug(input: string): string {
  // URL form: https://github.com/owner/repo
  const urlMatch = input.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/
  );
  if (urlMatch) {
    return cleanSlug(urlMatch[1]);
  }

  // Plain slug form: owner/repo
  const slugMatch = input.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (slugMatch) {
    return cleanSlug(slugMatch[0]);
  }

  throw new Error(
    `Invalid repo format: "${input}". Use "owner/repo" or a full URL.`
  );
}

/**
 * Return the URL hostname for a string that looks like a URL, or `null` when
 * the input is not a parseable absolute http(s) URL (e.g. a plain "owner/repo"
 * slug, or a malformed/non-http URL).
 *
 * This is the basis for an exact-host check. A naive `input.includes("gitlab.com")`
 * is bypassable by hosts such as `gitlab.com.attacker.com` or
 * `evil-gitlab.com`, and by credential tricks like
 * `https://gitlab.com@attacker.com/...` (whose host is `attacker.com`).
 */
function urlHostname(input: string): string | null {
  // Accept scheme-relative / bare-host forms like "gitlab.com/owner/repo" by
  // defaulting to https, but only when the first path segment looks like a
  // hostname (contains a dot). A plain "owner/repo" slug must NOT be coerced
  // into a host, so it returns null and falls through to the GitHub default.
  const candidate =
    /^https?:\/\//i.test(input) || !/^[^/]+\.[^/]+\//.test(input)
      ? input
      : `https://${input}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url.hostname.toLowerCase();
}

/**
 * Exact host match, allowing only the host itself or a real subdomain of it.
 * Rejects look-alikes (`evil-github.com`), suffix tricks
 * (`github.com.evil.com`), and substring matches.
 */
function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/**
 * Detect the hosting platform from user input (URL or slug).
 *
 * Supported:
 * - gitlab.com/owner/repo  → GitLab
 * - codeberg.org/owner/repo → Codeberg (Gitea)
 * - github.com/owner/repo  → GitHub
 * - owner/repo (plain)     → GitHub (default)
 */
export function detectPlatform(input: string): PlatformConfig {
  // Resolve the real hostname for URL inputs so that host checks compare the
  // actual host, never a substring of the raw string. Plain "owner/repo"
  // slugs parse to `null` and fall through to the GitHub default below.
  const hostname = urlHostname(input);

  // GitLab
  if (hostname !== null && hostMatches(hostname, "gitlab.com")) {
    const match = input.match(
      /gitlab\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/
    );
    if (!match) {
      throw new Error(
        `Could not parse GitLab repo from "${input}". Use "https://gitlab.com/owner/repo".`
      );
    }
    return {
      platform: "gitlab",
      slug: cleanSlug(match[1]),
      apiBase: "https://gitlab.com/api/v4",
      webBase: "https://gitlab.com",
    };
  }

  // Codeberg
  if (hostname !== null && hostMatches(hostname, "codeberg.org")) {
    const match = input.match(
      /codeberg\.org\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/
    );
    if (!match) {
      throw new Error(
        `Could not parse Codeberg repo from "${input}". Use "https://codeberg.org/owner/repo".`
      );
    }
    return {
      platform: "codeberg",
      slug: cleanSlug(match[1]),
      apiBase: "https://codeberg.org/api/v1",
      webBase: "https://codeberg.org",
    };
  }

  // Default: GitHub
  return {
    platform: "github",
    slug: parseGitHubSlug(input),
    apiBase: "https://api.github.com",
    webBase: "https://github.com",
  };
}
