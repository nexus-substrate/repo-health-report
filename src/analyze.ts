import { execFile } from "node:child_process";

const GH_TIMEOUT_MS = 15_000;

export interface RepoTree {
  tree: Array<{ path: string; type: string; size?: number }>;
}

export interface RepoMeta {
  default_branch: string;
  language: string | null;
  has_issues: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  license: { spdx_id: string } | null;
  open_issues_count: number;
  archived: boolean;
  description: string | null;
  stargazers_count?: number;
  // Additional fields — already in REST /repos/{slug} response, zero extra cost
  forks_count?: number;
  topics?: string[];
  has_discussions?: boolean;
  has_projects?: boolean;
  is_security_policy_enabled?: boolean;
  pushed_at?: string;
  created_at?: string;
  size?: number;
  // CI status from GraphQL statusCheckRollup (#27)
  ciStatus?: "SUCCESS" | "FAILURE" | "PENDING" | "EXPECTED" | null;
  // Community responsiveness from GraphQL (#28)
  openIssueCount?: number;
  oldestOpenIssues?: Array<{ createdAt: string; updatedAt: string }>;
  openPrCount?: number;
  oldestOpenPrs?: Array<{ createdAt: string; updatedAt: string }>;
  // Dependabot vulnerability alerts from GraphQL (#39)
  dependabotAlerts?: {
    totalCount: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    packages: string[];
  } | null; // null = not available (permissions or feature not enabled)
  // GitHub security features from REST /repos/{slug} (#40)
  security_and_analysis?: {
    advanced_security?: { status: string };
    secret_scanning?: { status: string };
    secret_scanning_push_protection?: { status: string };
    dependabot_security_updates?: { status: string };
  };
}

export interface WorkflowFile {
  name: string;
  path: string;
}

export interface FileContent {
  content: string;
  encoding: string;
}

/**
 * Validate a repo slug (owner/repo) format.
 * Accepts "owner/repo" or "https://github.com/owner/repo".
 */
export function parseRepoSlug(input: string): string {
  const ghUrlMatch = input.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/
  );
  if (ghUrlMatch) {
    return ghUrlMatch[1].replace(/\.git$/, "");
  }

  const slugMatch = input.match(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (slugMatch) {
    return slugMatch[0];
  }

  throw new Error(
    `Invalid repo format: "${input}". Use "owner/repo" or "https://github.com/owner/repo".`
  );
}

/**
 * Run a `gh api` call and parse JSON output.
 * Uses --paginate by default for endpoints that return paginated results.
 */
export async function ghApi<T>(
  endpoint: string,
  options?: { paginate?: boolean }
): Promise<T> {
  const args = ["api", endpoint];
  if (options?.paginate !== false) {
    args.push("--paginate");
  }
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { timeout: GH_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr.trim() || error.message;
          reject(new Error(`gh api ${endpoint} failed: ${msg}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(
            new Error(`Failed to parse JSON from gh api ${endpoint}`)
          );
        }
      }
    );
  });
}

/** GraphQL response shape for the repository metadata query. */
interface GraphQLRepoResponse {
  data: {
    repository: {
      defaultBranchRef: {
        name: string;
        target: {
          statusCheckRollup: { state: string } | null;
        } | null;
      } | null;
      description: string | null;
      isArchived: boolean;
      stargazerCount: number;
      forkCount: number;
      hasIssuesEnabled: boolean;
      hasWikiEnabled: boolean;
      hasDiscussionsEnabled: boolean;
      hasProjectsEnabled: boolean;
      isSecurityPolicyEnabled: boolean;
      pushedAt: string | null;
      createdAt: string;
      diskUsage: number | null;
      primaryLanguage: { name: string } | null;
      licenseInfo: { spdxId: string } | null;
      repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
      openIssues: { totalCount: number };
      issues: {
        totalCount: number;
        nodes: Array<{ createdAt: string; updatedAt: string }>;
      };
      pullRequests: {
        totalCount: number;
        nodes: Array<{ createdAt: string; updatedAt: string }>;
      };
      vulnerabilityAlerts: {
        totalCount: number;
        nodes: Array<{
          securityVulnerability: {
            severity: string;
            package: { name: string; ecosystem: string };
          };
        }>;
      } | null;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Run a GraphQL query via `gh api graphql` and return the parsed response.
 */
export async function ghGraphQL<T>(
  query: string,
  variables: Record<string, string>
): Promise<T> {
  const variableArgs: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    variableArgs.push("-f", `${key}=${value}`);
  }
  const args = ["api", "graphql", "-f", `query=${query}`, ...variableArgs];
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { timeout: GH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr.trim() || error.message;
          reject(new Error(`gh api graphql failed: ${msg}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new Error("Failed to parse JSON from gh api graphql"));
        }
      }
    );
  });
}

/**
 * Fetch repo metadata via GraphQL.
 * Replaces the REST /repos/{slug} call and additionally provides
 * topics, discussions, projects, pushed_at, created_at, and disk size
 * in a single request with no extra API cost.
 *
 * Throws on GraphQL errors so callers can fall back to REST.
 */
export async function fetchRepoMetaGraphQL(slug: string): Promise<RepoMeta> {
  const [owner, name] = slug.split("/");
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          name
          target {
            ... on Commit {
              statusCheckRollup {
                state
              }
            }
          }
        }
        description
        isArchived
        stargazerCount
        forkCount
        hasIssuesEnabled
        hasWikiEnabled
        hasDiscussionsEnabled
        hasProjectsEnabled
        isSecurityPolicyEnabled
        pushedAt
        createdAt
        diskUsage
        primaryLanguage { name }
        licenseInfo { spdxId }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        openIssues: issues(states: OPEN) { totalCount }
        issues(states: OPEN, first: 5, orderBy: {field: UPDATED_AT, direction: ASC}) {
          totalCount
          nodes { createdAt updatedAt }
        }
        pullRequests(states: OPEN, first: 5, orderBy: {field: UPDATED_AT, direction: ASC}) {
          totalCount
          nodes { createdAt updatedAt }
        }
        vulnerabilityAlerts(first: 10, states: OPEN) {
          totalCount
          nodes {
            securityVulnerability {
              severity
              package { name ecosystem }
            }
          }
        }
      }
    }
  `;

  const result = await ghGraphQL<GraphQLRepoResponse>(query, {
    owner: owner ?? "",
    name: name ?? "",
  });

  if (result.errors && result.errors.length > 0) {
    throw new Error(`GraphQL error: ${result.errors[0].message}`);
  }

  const repo = result.data.repository;

  // Extract CI status from statusCheckRollup
  const rollupState = repo.defaultBranchRef?.target?.statusCheckRollup?.state;
  const ciStatus = (rollupState === "SUCCESS" ||
    rollupState === "FAILURE" ||
    rollupState === "PENDING" ||
    rollupState === "EXPECTED")
    ? rollupState
    : null;

  // Parse Dependabot vulnerability alerts (null if not available)
  let dependabotAlerts: RepoMeta["dependabotAlerts"] = null;
  if (repo.vulnerabilityAlerts) {
    const nodes = repo.vulnerabilityAlerts.nodes;
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    const packages: string[] = [];

    for (const node of nodes) {
      const sev = node.securityVulnerability.severity.toUpperCase();
      if (sev === "CRITICAL") critical++;
      else if (sev === "HIGH") high++;
      else if (sev === "MODERATE" || sev === "MEDIUM") medium++;
      else low++;

      const pkgName = node.securityVulnerability.package.name;
      if (!packages.includes(pkgName)) packages.push(pkgName);
    }

    dependabotAlerts = {
      totalCount: repo.vulnerabilityAlerts.totalCount,
      critical,
      high,
      medium,
      low,
      packages,
    };
  }

  return {
    default_branch: repo.defaultBranchRef?.name ?? "main",
    language: repo.primaryLanguage?.name ?? null,
    has_issues: repo.hasIssuesEnabled,
    has_wiki: repo.hasWikiEnabled,
    has_pages: false, // not available via GraphQL — REST-only field
    license: repo.licenseInfo ? { spdx_id: repo.licenseInfo.spdxId } : null,
    open_issues_count: repo.openIssues.totalCount,
    archived: repo.isArchived,
    description: repo.description,
    stargazers_count: repo.stargazerCount,
    forks_count: repo.forkCount,
    topics: repo.repositoryTopics.nodes.map((n) => n.topic.name),
    has_discussions: repo.hasDiscussionsEnabled,
    has_projects: repo.hasProjectsEnabled,
    is_security_policy_enabled: repo.isSecurityPolicyEnabled,
    pushed_at: repo.pushedAt ?? undefined,
    created_at: repo.createdAt,
    size: repo.diskUsage ?? undefined,
    ciStatus,
    openIssueCount: repo.issues.totalCount,
    oldestOpenIssues: repo.issues.nodes,
    openPrCount: repo.pullRequests.totalCount,
    oldestOpenPrs: repo.pullRequests.nodes,
    dependabotAlerts,
  };
}

/**
 * Fetch the full file tree for a repo's default branch.
 */
export async function fetchRepoTree(
  slug: string,
  branch: string
): Promise<RepoTree> {
  return ghApi<RepoTree>(
    `/repos/${slug}/git/trees/${branch}?recursive=1`
  );
}

/**
 * Fetch repo metadata.
 */
export async function fetchRepoMeta(slug: string): Promise<RepoMeta> {
  return ghApi<RepoMeta>(`/repos/${slug}`);
}

/**
 * Fetch file content (base64-encoded by default).
 */
export async function fetchFileContent(
  slug: string,
  path: string
): Promise<string | null> {
  try {
    const data = await ghApi<FileContent>(
      `/repos/${slug}/contents/${path}`
    );
    if (data.encoding === "base64" && data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return data.content ?? null;
  } catch {
    return null;
  }
}

/**
 * List workflow files in .github/workflows/.
 */
export async function fetchWorkflows(
  slug: string
): Promise<WorkflowFile[]> {
  try {
    const data = await ghApi<{ workflows: WorkflowFile[] }>(
      `/repos/${slug}/actions/workflows`
    );
    return data.workflows ?? [];
  } catch {
    return [];
  }
}

/**
 * Check if a file exists in the tree.
 */
export function treeHasFile(tree: RepoTree, path: string): boolean {
  return tree.tree.some(
    (entry) => entry.path.toLowerCase() === path.toLowerCase()
  );
}

/**
 * Maximum file-path length we will run a detector regex against.
 *
 * Git itself limits a tree path to 4096 bytes, so any legitimate entry is
 * comfortably under this bound. Several detector patterns have the shape
 * `prefix.*X.*suffix$` (two unanchored `.*` runs), which can exhibit
 * polynomial backtracking when the suffix fails to match on a long,
 * adversarially-constructed path supplied by an analyzed (untrusted) repo.
 * Bounding the input length keeps that O(n^2) worst case to a constant and
 * closes the `js/polynomial-redos` class without altering match semantics for
 * any real path. See https://codeql.github.com/codeql-query-help/javascript/js-polynomial-redos/
 */
const MAX_TREE_PATH_LENGTH = 4096;

/**
 * Test a single tree path against a detector pattern, skipping pathologically
 * long inputs that could drive regex backtracking. Real git paths are always
 * well under {@link MAX_TREE_PATH_LENGTH}.
 */
function pathMatches(path: string, pattern: RegExp): boolean {
  if (path.length > MAX_TREE_PATH_LENGTH) return false;
  return pattern.test(path);
}

/**
 * Check if any file in the tree matches a pattern.
 */
export function treeHasPattern(tree: RepoTree, pattern: RegExp): boolean {
  return tree.tree.some((entry) => pathMatches(entry.path, pattern));
}

/**
 * Count files matching a pattern.
 */
export function treeCountPattern(tree: RepoTree, pattern: RegExp): number {
  return tree.tree.filter((entry) => pathMatches(entry.path, pattern)).length;
}

export type ProjectType = "application" | "iac" | "library" | "hybrid" | "documentation" | "runtime" | "mirror";

export type RepoSizeTier = "small" | "medium" | "large";

/**
 * Detect repo size tier from the file tree.
 * - small: fewer than 50 files (README-only utilities, personal scripts)
 * - medium: 50–499 files (typical open-source projects)
 * - large: 500+ files (enterprise-scale, monorepos)
 */
export function detectRepoSize(tree: RepoTree): RepoSizeTier {
  const fileCount = tree.tree.filter((e) => e.type === "blob").length;
  if (fileCount < 50) return "small";
  if (fileCount < 500) return "medium";
  return "large";
}

export type RepoLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "shell"
  | "c"
  | "ruby"
  | "other";

const LANGUAGE_MAP: Record<string, RepoLanguage> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  go: "go",
  rust: "rust",
  java: "java",
  kotlin: "java",
  scala: "java",
  "c#": "java",
  dart: "java",
  swift: "java",
  clojure: "java",
  groovy: "java",
  shell: "shell",
  bash: "shell",
  lua: "shell",
  powershell: "shell",
  dockerfile: "shell",
  makefile: "shell",
  nix: "shell",
  c: "c",
  "c++": "c",
  "objective-c": "c",
  zig: "c",
  ruby: "ruby",
  php: "ruby",
  perl: "ruby",
  elixir: "ruby",
  erlang: "ruby",
  vue: "javascript",
  svelte: "javascript",
  scss: "javascript",
  css: "javascript",
  html: "javascript",
  r: "python",
  julia: "python",
  "jupyter notebook": "python",
  hcl: "other",
  haskell: "other",
};

// ── Multi-language detection ────────────────────────────────────────────────

export interface LanguageBreakdownEntry {
  language: RepoLanguage;
  fileCount: number;
  percentage: number;
}

export interface LanguageBreakdown {
  primary: RepoLanguage;
  all: LanguageBreakdownEntry[];
}

/**
 * Extension-to-language map — single source of truth for file extension → language mapping.
 * Used by both detectLanguageFromTree and detectAllLanguages.
 */
const EXT_TO_LANGUAGE: Record<string, RepoLanguage> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript",
  py: "python", pyx: "python",
  go: "go",
  rs: "rust",
  java: "java", kt: "java", scala: "java",
  sh: "shell", bash: "shell",
  c: "c", cpp: "c", h: "c", hpp: "c",
  rb: "ruby",
};

/**
 * Detect language from file extensions in the repo tree.
 * Used as a fallback when GitHub returns null for the language field.
 */
export function detectLanguageFromTree(tree: RepoTree): RepoLanguage {
  const extCounts: Record<string, number> = {};
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const ext = entry.path.split(".").pop()?.toLowerCase();
    if (ext) extCounts[ext] = (extCounts[ext] ?? 0) + 1;
  }

  let bestLang: RepoLanguage = "other";
  let bestCount = 0;
  for (const [ext, count] of Object.entries(extCounts)) {
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang && count > bestCount) {
      bestLang = lang;
      bestCount = count;
    }
  }
  return bestLang;
}

/**
 * Detect ALL languages present in the repo tree with file counts and percentages.
 * Returns a breakdown with the primary language (from GitHub or highest-count)
 * and all detected languages sorted by file count descending.
 */
export function detectAllLanguages(tree: RepoTree, ghLanguage: string | null): LanguageBreakdown {
  const langCounts = new Map<RepoLanguage, number>();
  let totalSourceFiles = 0;

  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const ext = entry.path.split(".").pop()?.toLowerCase();
    if (!ext) continue;
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang) {
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
      totalSourceFiles++;
    }
  }

  const sorted = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language, fileCount]) => ({
      language,
      fileCount,
      percentage: totalSourceFiles > 0 ? Math.round((fileCount / totalSourceFiles) * 100) : 0,
    }));

  const primary = normalizeLanguage(ghLanguage, tree);

  return { primary, all: sorted };
}

export function normalizeLanguage(ghLanguage: string | null, tree?: RepoTree): RepoLanguage {
  const lower = (ghLanguage ?? "").toLowerCase();
  const mapped = LANGUAGE_MAP[lower];
  if (mapped) return mapped;
  if (tree) return detectLanguageFromTree(tree);
  return "other";
}

const KNOWN_RUNTIMES = new Set([
  "golang/go", "rust-lang/rust", "python/cpython", "ruby/ruby",
  "nodejs/node", "openjdk/jdk", "dotnet/runtime", "apple/swift",
  "llvm/llvm-project", "gcc-mirror/gcc", "torvalds/linux",
  "denoland/deno",
]);

/**
 * Detect the project type based on the file tree and repo slug.
 * Checks runtime and documentation repos FIRST, then application entry points
 * to avoid misclassifying Go/Node/Python apps that also contain Terraform configs.
 *
 * - 'runtime': language runtimes, compilers, kernels (known slugs)
 * - 'documentation': awesome lists, educational repos, book repos (>80% markdown, no source)
 * - 'hybrid': has both application code AND IaC configs (e.g., Go + Terraform)
 * - 'application': Go, Node, Python, Rust, Java, etc.
 * - 'iac': purely Terraform, Ansible, Pulumi, or CloudFormation
 * - 'library': no src/ but has lib/ or root index file
 */
export function detectProjectType(tree: RepoTree, slug?: string, meta?: RepoMeta): ProjectType {
  // Runtime detection — check BEFORE everything else
  if (slug && KNOWN_RUNTIMES.has(slug)) return "runtime";

  // Mirror/external-primary detection — repos developed outside GitHub
  // Tight heuristic: issues disabled + no GH Actions + high stars (avoids false positives on small repos)
  if (meta && !meta.has_issues && (meta.stargazers_count ?? 0) > 1000) {
    const hasGitHubActions = treeHasPattern(tree, /^\.github\/workflows\/.*\.ya?ml$/);
    const hasGitHubConfig = treeHasFile(tree, ".github/dependabot.yml") ||
      treeHasFile(tree, "CODEOWNERS") || treeHasFile(tree, ".github/CODEOWNERS");
    if (!hasGitHubActions && !hasGitHubConfig) {
      return "mirror";
    }
  }
  // Documentation detection — check BEFORE application/IaC
  const repoName = slug?.split("/")[1] ?? "";
  // Match "awesome", "awesome-*", "*-awesome", or "*-awesome-*" patterns
  const isAwesomeRepo = /^awesome$/i.test(repoName) || /^awesome-|^.*-awesome$|^.*-awesome-/i.test(repoName);

  const totalFiles = tree.tree.filter((e) => e.type === "blob").length;
  const mdFiles = tree.tree.filter(
    (e) => e.type === "blob" && /\.md$/i.test(e.path)
  ).length;
  const markdownRatio = totalFiles > 0 ? mdFiles / totalFiles : 0;

  const sourceFileCount = tree.tree.filter(
    (e) =>
      e.type === "blob" &&
      /\.(ts|js|py|go|rs|java|rb|c|cpp|cc|cxx|cs|swift|kt|scala|ex|exs|php|lua|r|dart)$/i.test(
        e.path
      )
  ).length;

  const hasSubstantialReadme = treeHasFile(tree, "README.md");

  // A repo is a documentation project when:
  // - Named with the awesome-* pattern, OR
  // - Has no source code files, has a README, and >50% of files are markdown (educational/book repos)
  const isDocumentationRepo =
    isAwesomeRepo ||
    (markdownRatio > 0.5 && sourceFileCount === 0 && hasSubstantialReadme) ||
    (sourceFileCount === 0 && mdFiles > 0 && hasSubstantialReadme && totalFiles <= 5);

  if (isDocumentationRepo) {
    return "documentation";
  }

  // Application entry points — check these FIRST
  const appIndicators =
    treeHasFile(tree, "go.mod") ||
    treeHasFile(tree, "main.go") ||
    treeHasFile(tree, "package.json") ||
    treeHasFile(tree, "Cargo.toml") ||
    treeHasFile(tree, "pyproject.toml") ||
    treeHasFile(tree, "setup.py") ||
    treeHasFile(tree, "pom.xml") ||
    treeHasFile(tree, "build.gradle") ||
    treeHasFile(tree, "build.gradle.kts") ||
    treeHasFile(tree, "mix.exs") ||
    treeHasFile(tree, "Gemfile") ||
    treeHasPattern(tree, /^src\/.*\.(ts|js|py|rs|go|java|rb)$/);

  const iacIndicators =
    treeHasPattern(tree, /\.tf$/) ||
    treeHasPattern(tree, /^terraform\//) ||
    treeHasPattern(tree, /^ansible\//) ||
    treeHasPattern(tree, /^pulumi\//) ||
    treeHasPattern(tree, /^cloudformation\//) ||
    treeHasFile(tree, "Pulumi.yaml") ||
    treeHasFile(tree, "Pulumi.yml") ||
    treeHasPattern(tree, /\.cfn\.ya?ml$/);

  // Hybrid: both application code AND IaC
  if (appIndicators && iacIndicators) {
    return "hybrid";
  }

  // Pure IaC
  if (iacIndicators) {
    return "iac";
  }

  // Library detection
  const hasSrcDir = treeHasPattern(tree, /^src\//);
  const hasLibDir = treeHasPattern(tree, /^lib\//);
  const hasRootIndex =
    treeHasFile(tree, "index.ts") || treeHasFile(tree, "index.js");
  if (!hasSrcDir && (hasLibDir || hasRootIndex)) {
    return "library";
  }

  return "application";
}
