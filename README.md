# repo-health-report

[![CI](https://github.com/nexus-substrate/repo-health-report/actions/workflows/ci.yml/badge.svg)](https://github.com/nexus-substrate/repo-health-report/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/repo-health-report)](https://www.npmjs.com/package/repo-health-report)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Analyze any GitHub repository's health across 6 dimensions and generate a color-coded terminal report with a markdown file.

**Static analysis via the GitHub API. No cloning, no secrets required.** Optional `--ai` flag for AI-assisted analysis via [nexus-agents](https://github.com/williamzujkowski/nexus-agents).

## Installation

```bash
# Run directly without installing
npx repo-health-report williamzujkowski/nexus-agents

# Install globally
npm install -g repo-health-report
repo-health-report williamzujkowski/nexus-agents

# Or with a full GitHub URL
npx repo-health-report https://github.com/facebook/react
```

## Quick Start

```bash
# Requires: gh CLI installed and authenticated
gh auth login

npx repo-health-report williamzujkowski/nexus-agents
```

## Example Output

Running against [nexus-agents](https://github.com/williamzujkowski/nexus-agents) — a Grade A result:

```
  Repo Health Report: williamzujkowski/nexus-agents
  ──────────────────────────────────────────────────

  Overall Grade: A (94/100)

  Security         ████████████████████ 100/100
  Testing          ████████████████████ 100/100
  Documentation    ████████████████████ 100/100
  Architecture     ████████████████████ 100/100
  DevOps           ██████████████░░░░░░  70/100
  Maintenance      ████████████████████ 100/100

  Findings:
  ──────────────────────────────────────────────────

  Security
    ✔ Security policy (SECURITY.md)
    ✔ Dependency update automation
    ✔ CODEOWNERS file
    ✔ No committed .env files
    ✔ .gitignore present
    ✔ CI workflows (branch protection proxy)

  Testing
    ✔ CI workflows
    ✔ Test files
    ✔ Coverage configuration
    ✔ Test runner configured
    ✔ Pre-commit hooks

  Documentation
    ✔ README.md quality
    ✔ LICENSE file
    ✔ CONTRIBUTING.md
    ✔ CHANGELOG
    ✔ Documentation directory or API docs
    ✔ Repository description

  Architecture
    ✔ Type safety
    ✔ Linter configuration
    ✔ Code formatter
    ✔ Organized source structure
    ✔ Monorepo tooling
    ✔ Build configuration

  DevOps
    ✔ CI/CD pipeline
    ✔ Release automation
    ✔ Issue/PR templates
    ✗ Container support (Docker)
    ✗ Deployment/Infrastructure config
```

A markdown report (`health-report.md`) is also written with a full findings table and prioritized recommendations.

## How It Works

`repo-health-report` uses the GitHub API exclusively — no repo cloning, no external services beyond `gh` authentication. An optional `--ai` flag integrates with nexus-agents for AI-assisted analysis.

1. **Fetch metadata** — pulls repo info (description, default branch, license) via `gh api`.
2. **Fetch file tree** — gets a flat list of all paths in the repo in a single API call.
3. **Run 6 dimensions in parallel** — each dimension pattern-matches on the file tree and fetches specific file contents only when needed (e.g., README length, package.json scripts).
4. **Score and grade** — weighted scores per dimension are averaged into an overall 0–100 score and converted to a letter grade (A/B/C/D/F).
5. **Render output** — color-coded terminal output via chalk, plus a markdown report with a findings table and prioritized recommendations.

All analysis is deterministic: the same repo always produces the same score unless the repo itself changes.

## What It Checks

### Security (0-100)
- SECURITY.md vulnerability disclosure policy
- Dependabot or Renovate for dependency updates
- CODEOWNERS for review enforcement
- No committed `.env` files
- `.gitignore` present
- CI workflows (branch protection proxy)

### Testing (0-100)
- GitHub Actions or other CI workflows
- Test files (`test/`, `__tests__/`, `*.test.*`, `*.spec.*`)
- Coverage/test runner configuration (vitest, jest, pytest, etc.)
- Test scripts in package.json (or language-equivalent)
- Pre-commit hooks (Husky, pre-commit)

### Documentation (0-100)
- README.md quality (existence and length)
- LICENSE file
- CONTRIBUTING.md
- CHANGELOG
- `docs/` directory or API documentation
- Repository description on GitHub

### Architecture (0-100)
- Type safety (TypeScript, mypy, Rust, Go, Java)
- Linter configuration (ESLint, flake8, ruff, clippy, biome)
- Code formatter (Prettier, editorconfig, rustfmt, black)
- Organized source structure (`src/`, `lib/`, `packages/`)
- Monorepo tooling (if applicable)
- Build configuration

### DevOps (0-100)
- CI/CD pipeline (GitHub Actions, Travis, CircleCI, Jenkins, GitLab CI)
- Docker support (Dockerfile, Compose)
- Release automation (semantic-release, changesets)
- Issue/PR templates
- Deployment/Infrastructure config (Terraform, k8s, Vercel, Fly, etc.)

### Maintenance (0-100)
- Recent commit activity
- Bus factor (contributor distribution)
- Community engagement (stars, watchers)
- Funding/sponsorship configuration
- Issue response patterns
- Release cadence

## Grading Scale

| Score | Grade |
|------:|-------|
| 90–100 | A |
| 80–89  | B |
| 70–79  | C |
| 60–69  | D |
| 0–59   | F |

## CLI Options

```
repo-health-report <owner/repo | URL>

Options:
  --output, -o <file>   Write markdown report to file (default: health-report.md)
  --no-file             Skip writing markdown file
  --json                Output JSON instead of terminal rendering
  --explain             Show detailed scoring breakdown per dimension
  --help, -h            Show help
```

### The `--ai` Flag

The `--ai` flag generates a structured vote proposal for [nexus-agents](https://github.com/williamzujkowski/nexus-agents) MCP tools:

```bash
repo-health-report owner/repo --json --ai
```

This outputs a JSON payload with dimension scores and a `voteProposal` field that can be fed to nexus-agents `consensus_vote` for AI-powered health grading.

### Org Audit

Analyze all public repos in a GitHub organization and produce an aggregate audit report:

```bash
# Audit an entire org
npm run org-audit -- --org cloud-gov

# With parallel analysis and rate limiting
npm run org-audit -- --org cloud-gov --parallel 3 --delay 2000 --skip-docs
```

Outputs to `data/audits/{org}/{timestamp}/`:
- `summary.json` — org-level aggregate scores, grade distribution, dimension averages
- `risks.json` — org-wide risks ranked by frequency and severity
- `report.md` — human-readable markdown with executive summary, top risks, quick wins, and per-repo grades
- `repos/` — individual repo JSON reports

## Requirements

- **[GitHub CLI (`gh`)](https://cli.github.com/)** installed and authenticated (`gh auth login`)
- Node.js 22+

The tool uses `gh api` subprocess calls. It never clones repos or requires any API keys beyond your GitHub authentication.

## Related

Built to work alongside [nexus-agents](https://github.com/williamzujkowski/nexus-agents), a multi-agent orchestration system. The `--ai` flag generates structured vote proposals that nexus-agents can use for AI-assisted repository health analysis.

## License

MIT — see [LICENSE](LICENSE).
