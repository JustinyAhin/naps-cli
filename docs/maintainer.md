# naps-cli

Distributable CLI (`naps-cli`) wrapping the Reddit API, Twitter/X search providers, the internal SEO API (keyword research), and Google Search Console.

## Tech Stack

- **Runtime/Package Manager**: Bun (not npm/pnpm)
- **CLI framework**: [Stricli](https://bloomberg.github.io/stricli/)
- **API clients**: workspace package `api-clients` (generated from OpenAPI via `@hey-api/openapi-ts`)

## Architecture

```
index.ts                 → minimal Stricli runner
src/cli/app.ts           → route tree, typed parameters, help/version/completion integrations
src/cli/context.ts       → command I/O, fetch injection, and shell-completion context
src/cli/errors.ts        → consistent command error formatting
src/cli/parsers.ts       → reusable strict argument parsers
src/api.ts               → cached SDK clients for seo-api + reddit-api, plus shared token helpers
src/update.ts            → release discovery, download verification, and POSIX replacement
src/commands/            → command implementations, lazy-loaded by the route tree
  reddit-search.ts
  reddit-post.ts
  reddit-subreddits.ts
  twitter-search.ts
  keywords.ts
  keywords-bulk.ts
  keywords-serp.ts
  keywords-website.ts
  locations.ts
  search-console.ts
  update.ts
```

`src/cli/app.ts` owns command routes and typed parameters. Command files call the relevant SDK function from `api-clients/*/sdk.gen` or a direct provider HTTP endpoint, shape the response, and write through `CliContext`. Command failures return `CliError`; the runner normalizes every non-zero Stricli exit code to shell exit code 1.

## Environment Variables

This CLI is meant to be distributed to end users. Do **not** read keys from local `.env` files or hard-coded paths.

The SEO API requires bearer auth. Reddit API admin auth is optional and only used to bypass its rate limits:

- `NAPS_CLI_SEO_API_TOKEN` or `SEO_API_TOKEN` — SEO API token required for `keywords*` and `locations`
- `NAPS_CLI_REDDIT_API_TOKEN` — Reddit API token (optional)
- `NAPS_CLI_TWITTERAPI_TOKEN` or `TWITTERAPI_API_KEY` — TwitterAPI.io key required for `twitter-search --provider twitterapi`
- `NAPS_CLI_X_BEARER_TOKEN` or `X_BEARER_TOKEN` — X API bearer token required for `twitter-search --provider official`
- `NAPS_GSC_REFRESH_TOKEN` — Google Search Console refresh token for CI/headless use (optional; takes precedence over local credentials)
- `NAPS_GSC_CLIENT_ID` — Google Desktop OAuth client ID override for development builds
- `NAPS_GSC_CLIENT_SECRET` — Google Desktop OAuth client secret override for development and required build-time input for releases
- `NAPS_CLI_BASE` — download origin override for installers and `naps-cli update`

`getSeoApiClient()` throws a clear CLI error if both SEO token env vars are missing. `getRedditApiClient()` attaches `Authorization: Bearer ...` only when the optional key is set.

## Google Search Console

Search Console uses direct Google Desktop OAuth; it does not authenticate through `naps.sh` or send Search Console credentials/data to a Naps server.

```bash
naps-cli search-console connect
naps-cli search-console status
naps-cli search-console sites
naps-cli search-console analytics sc-domain:example.com
naps-cli search-console disconnect
```

`connect` opens Google in the system browser and handles the callback on a temporary `127.0.0.1` port. Credentials are stored in the user config at `${XDG_CONFIG_HOME:-~/.config}/naps/config.json` on macOS/Linux or `%APPDATA%\\naps\\config.json` on Windows. The config and its directory use user-only permissions where the platform supports Unix modes.

Public release builds use `BUILT_IN_GOOGLE_CLIENT_ID` in `src/search-console/oauth.ts` and must receive `NAPS_GSC_CLIENT_SECRET` at build time. `scripts/build.ts` embeds that Desktop credential in the standalone binaries without committing it to Git. Desktop OAuth clients are public clients, so the embedded value must not be reused as a confidential server credential. Set both variables at runtime to override the bundled credentials during development.

## Adding a Subcommand

1. Create `src/commands/<name>.ts` exporting a Stricli command function as default.
2. Register its lazy loader, typed parameters, and docs in `src/cli/app.ts`.
3. Reuse the cached client via `getSeoApiClient()` / `getRedditApiClient()`.
4. If the response needs trimming, use the shared `truncate({ value, max })` helper.

## Code Conventions

- Use `type` instead of `interface`
- All exports at the end of the file, not inline
- Use arrow functions instead of function declarations
- Functions with more than one parameter should use object arguments
- Output is JSON to stdout; return a structured `CliError` for command runtime failures

## Bash Completion

Completion is opt-in and only modifies `~/.bashrc` after an explicit command:

```bash
naps-cli completion install
naps-cli completion uninstall
```

The hidden `--complete` integration generates static route, flag, and enum suggestions. Do not add completion setup to `install.sh` or `install.ps1` automatically. Stricli's autocomplete package currently supports Bash only.

## Commands

```bash
bun dev -- <subcommand> [...args]   # Run locally (e.g. bun dev -- reddit-search "food cost")
bun run check                       # Type check (tsc --noEmit)
bun run lint <files...>             # Lint files (oxlint)
bun run format <files...>           # Format files (oxfmt)
bun run lint:check                  # Lint whole project
bun run format:check                # Verify formatting whole project
bun run build:host                  # Compile single binary for current host (dist/naps-cli)
bun run build                       # Compile binaries for all 5 targets in parallel
```

## Distributable binaries

`bun run build` produces standalone executables in `dist/` for:

| File                       | Target              |
| -------------------------- | ------------------- |
| `naps-cli-darwin-arm64`    | macOS Apple Silicon |
| `naps-cli-darwin-x64`      | macOS Intel         |
| `naps-cli-linux-x64`       | Linux x64 (glibc)   |
| `naps-cli-linux-arm64`     | Linux arm64 (glibc) |
| `naps-cli-windows-x64.exe` | Windows x64         |

Each binary embeds the Bun runtime — no Bun/Node install needed on the user's machine. Build flags (set in `scripts/build.ts`):

- `--minify` — smaller binary
- `--sourcemap=inline` — embeds a zstd-compressed sourcemap so stack traces map back to TS source (Bun also writes a stray `dist/*.js.map` next to the binary that the build script deletes after)

`--bytecode` is **not** enabled — Bun docs only show it for single-platform compilation, not combined with cross-compile `--target`. Revisit if/when verified safe.

To add or remove a target, edit the `targets` array in `scripts/build.ts`. Full list of supported targets: <https://bun.com/docs/bundler/executables#supported-targets>.

## Distribution (R2 + dl.naps.sh)

Binaries are hosted on a private R2 bucket fronted by the `dl.naps.sh` custom domain. End users install with:

```bash
# macOS / Linux
curl -fsSL https://dl.naps.sh/install.sh | sh

# Windows (PowerShell)
iwr -useb https://dl.naps.sh/install.ps1 | iex
```

Both install scripts respect:

- `NAPS_CLI_VERSION` — pin to a specific version (default: `latest`)
- `NAPS_CLI_INSTALL_DIR` — override install location
- `NAPS_CLI_BASE` — override the download origin (default: `https://dl.naps.sh`)

Installers resolve `latest` through `versions.json`, prefer gzip-compressed artifacts, verify
the decompressed binary's SHA-256, and fall back to raw artifacts for older pinned releases.
Installed macOS/Linux binaries can update in place:

```bash
naps-cli update
```

On Windows, `update` reports the available version and prints the PowerShell installer command;
the running executable is not replaced in place.

### Cutting a release

**Versioning** — semver, scoped to user-visible CLI behavior:

- `MAJOR` (`v1.0.0` → `v2.0.0`) — breaking changes to subcommand names, args, or output shape that scripts may parse. Bump when you'd surprise someone running `naps-cli` in a pipeline.
- `MINOR` (`v0.1.0` → `v0.2.0`) — new subcommand or flag, fully additive.
- `PATCH` (`v0.1.0` → `v0.1.1`) — bug fix, dependency bump, copy/help text changes.

While on `0.x`, breaking changes may ride a `MINOR` bump (semver allows this). After `v1.0.0`, hold the line.

**Pre-flight** before running the release command:

1. Clean working tree (`git status` shows nothing).
2. On `main` and up to date with `origin/main`.
3. Bump `package.json`; it is the sole release and runtime version source.
4. Export `NAPS_GSC_CLIENT_SECRET` for the bundled Google Desktop OAuth client. Keep a working local Search Console connection, or set `NAPS_GSC_REFRESH_TOKEN` for that client in CI. If setting `NAPS_GSC_CLIENT_ID`, it must match `BUILT_IN_GOOGLE_CLIENT_ID`.

Both release and `--dry-run` first validate these credentials with a live Google token refresh (15-second timeout), before repository checks, tests, builds, or uploads. Cached access tokens cannot bypass validation. Validation does not save tokens or embed the refresh token. Invalid credentials, an expired/revoked refresh token, or a network failure stop the release. For `invalid_client`, correct the client secret; for an expired/revoked refresh token, run `naps-cli search-console connect` with the correct secret or replace the CI refresh token. Never paste credentials into logs or commit them.

**Tagging** — after the release script succeeds:

```bash
git tag -a v0.X.Y -m "<short release notes>"
git push origin v0.X.Y
```

The tag is the canonical anchor for "what's in this release." The artifacts live in R2; the tag points at the source.

**Release notes** — for v0, no formal `CHANGELOG.md`. Use the annotated tag message above. Promote to a real changelog if the cadence picks up.

**Rollback** — older versions stay pinned at `cli/v0.X.Y/`, so users with
`NAPS_CLI_VERSION=v0.X.Y` are unaffected by a bad release. Set `versions.json.latest` to the
previous good version. New installers and `naps-cli update` follow that field; versioned objects
remain immutable. The legacy `cli/latest/` mirror is frozen after the v0.4.0 bridge release.

### Release flow (mechanics)

```bash
bun run release

# Build, test, compress, and checksum without changing R2:
bun run release --dry-run
```

`scripts/release.ts` does the following:

1. Verifies a clean, synchronized `main`, `cf >=0.6.0` auth/context, typecheck, and tests
2. Cross-compiles all 5 targets
3. Writes each raw binary, `<binary>.gz`, and a SHA-256 of the raw binary
4. Creates one-hour credentials scoped to this release's R2 paths
5. Streams three files concurrently with four 8 MiB multipart uploads per file and three retries
6. Uploads immutable gzip/checksum artifacts and install scripts
7. Publishes `versions.json` last so incomplete releases never become current

v0.4.0 is the compatibility bridge: it also uploads immutable raw binaries and refreshes only the
raw/checksum `cli/latest/` objects. v0.4.1 and later upload only immutable gzip/checksum pairs,
reducing release bytes substantially while retaining raw fallback for historical releases.

`--dry-run` performs the checks/build/package steps and prints every planned object and exact byte
count. It skips Git/`cf` preflight, temporary credentials, and all uploads.

**Auth**: install `cf >=0.6.0`, then establish its account context once:

```bash
cf auth login
cf context use
cf auth whoami
```

Create a long-lived **Object Read & Write** R2 API token scoped to `naps-cli-releases` under
**R2 → Overview → Manage API Tokens**, then export only its Access Key ID:

```bash
export CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID=<access-key-id>
```

The parent secret is not needed by the release process. The script reads the selected account from
`cf context show`, asks Cloudflare for path-scoped temporary S3 credentials, and keeps those
credentials in memory without logging them. No `CLOUDFLARE_ACCOUNT_ID` is needed.

### R2 object layout

```
naps-cli-releases/
├── install.sh
├── install.ps1
├── versions.json                              { latest, versions[] }
├── cli/v0.4.1/naps-cli-darwin-arm64.gz
├── cli/v0.4.1/naps-cli-darwin-arm64.sha256
├── cli/v0.4.1/...                             (5 gzip + checksum sets)
└── cli/latest/...                             (legacy mirror frozen after v0.4.0)
```

### One-time bucket setup

```bash
cf r2 buckets create --name naps-cli-releases
cf r2 buckets local-uploads update naps-cli-releases --enabled
cf r2 buckets local-uploads get naps-cli-releases
```

Local Uploads writes to a nearby R2 location and asynchronously replicates the object while keeping
it immediately available. Then in the Cloudflare dashboard: **R2 → naps-cli-releases → Settings →
Public access → Connect Domain → `dl.naps.sh`**.

### Running the CLI directly

```bash
export NAPS_CLI_SEO_API_TOKEN=...          # or SEO_API_TOKEN; required for keyword/location commands
export NAPS_CLI_REDDIT_API_TOKEN=...       # optional, only to bypass Reddit API limits
bun run index.ts <subcommand> [...args]
```

When published, the `bin` entry exposes it as `naps-cli`.
