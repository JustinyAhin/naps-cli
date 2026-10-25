# naps-cli

Distributable CLI (`naps-cli`) wrapping the Reddit API, Twitter/X search providers, the internal SEO API (keyword research), and Google Search Console.

For user setup, see [Getting started](getting-started.md), [Agents](agents.md), and [Data and credentials](data-and-credentials.md).

## Contents

- [Architecture](#architecture)
- [Environment variables](#environment-variables)
- [Google Search Console](#google-search-console)
- [Commands and conventions](#adding-a-subcommand)
- [Distribution and releases](#distribution-r2--dlnapssh)

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
  youtube-search.ts
  youtube-comments.ts
  youtube-transcript.ts
  search-console.ts
  update.ts
```

`src/cli/app.ts` owns command routes and typed parameters. Command files call the relevant SDK function from `api-clients/*/sdk.gen` or a direct provider HTTP endpoint, shape the response, and write through `CliContext`. Command failures return `CliError`; the runner normalizes every non-zero Stricli exit code to shell exit code 1.

`src/youtube/local-transcript.ts` uses the pinned Transcript Plus package for `youtube-transcript --provider local`.
It decodes caption entities and keeps the DataForSEO output fields. Requests have a 20-second timeout and no automatic retries.
The provider requires no API key. It does not use the gateway or switch to paid retrieval.

## Environment Variables

This CLI is meant to be distributed to end users. Do **not** read keys from local `.env` files or hard-coded paths.

Development, build, and release commands load secrets from Infisical. Varlock validates
and filters these inputs before Bun starts. Commands receive normal environment variables.
Runtime code needs no new environment accessor. Installed CLI launchers remain independent
of these repository profiles.

Bun automatic dotenv loading is disabled. These commands do not load the repository's
old `.env`. Tests, lint, and type checks need no secret-store authentication.
Profiles strip declared unused credentials and loader tokens. Varlock does not isolate
unrelated inherited environment variables.

### Installed Infisical launcher

Use [scripts/naps-cli-launcher.sh](../scripts/naps-cli-launcher.sh) for an optional POSIX launcher.
It applies only to naps-cli. It does not change `shared-env` or other installed tools.

Keep the binary at `~/.local/lib/naps-cli/naps-cli` and the launcher at `~/.local/bin/naps-cli`.
The normal path is Infisical `shared-creds dev:/cli` → Varlock → the installed binary.
Use the existing Infisical login or runner token-agent wrapper from the [KB runbook](https://github.com/JustinyAhin/kb/blob/main/operations/environment-variables-with-infisical.md).
Do not put credentials in this launcher or its command arguments.

Install Infisical and Varlock before setup. Use a trusted, private Varlock schema for runtime credentials.
The default schema directory is `${XDG_CONFIG_HOME:-~/.config}/varlock/shared-cli`.
For a new schema, copy `env/dev/.env.schema` there with mode `600`.
Do not overwrite an existing private schema without review.
The schema filters bootstrap and release credentials. It does not fetch maintainer secrets.

The launcher uses these optional, non-secret settings:

| Variable                        | Default                                    | Purpose                                           |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `NAPS_CLI_BINARY`               | `$HOME/.local/lib/naps-cli/naps-cli`       | Real binary, not the launcher                     |
| `NAPS_CLI_INFISICAL_BIN`        | `infisical` on `PATH`                      | Existing authenticated CLI or token-agent wrapper |
| `NAPS_CLI_INFISICAL_PROJECT_ID` | Shared-tools project ID from `bun run dev` | Project with runtime inputs in `dev:/cli`         |
| `NAPS_CLI_INFISICAL_DOMAIN`     | `https://app.infisical.com/api`            | Explicit trusted instance URL                     |
| `NAPS_CLI_VARLOCK_BIN`          | `varlock` on `PATH`                        | Installed validation CLI                          |
| `NAPS_CLI_VARLOCK_PATH`         | User's `varlock/shared-cli` directory      | Private runtime schema                            |

Set overrides in the agent runner environment when necessary. Review the instance URL before sending credentials.
The explicit domain prevents a repository configuration file from selecting another instance.
No command changes Infisical entries, login settings, or stored credentials.

#### Installation and migration

For a new installation, run the signed installer with `NAPS_CLI_INSTALL_DIR="$HOME/.local/lib/naps-cli"`.
Do not install a release binary over the launcher path.
For an existing installation, retain the verified binary and private runtime schema.
The existing `shared-env` helper can remain for other tools.

Before replacement, run the tracked launcher from this checkout:

```sh
sh scripts/naps-cli-launcher.sh --version
sh scripts/naps-cli-launcher.sh agent-guide
sh scripts/naps-cli-launcher.sh locations --country US
sh scripts/naps-cli-launcher.sh keywords test --budget NaN
```

Expect clean stdout on success. The guide needs no credential loading.
The invalid budget must return exit `1`, empty stdout, and one JSON error on stderr.
`locations` checks the loaded credentials without paid research.

After these checks pass, replace only the naps-cli launcher:

```sh
mkdir -p "$HOME/.local/bin"
test ! -e "$HOME/.local/bin/naps-cli" || cp -p "$HOME/.local/bin/naps-cli" "$HOME/.local/bin/naps-cli.before-infisical-fix"
install -m 700 scripts/naps-cli-launcher.sh "$HOME/.local/bin/naps-cli.new"
mv "$HOME/.local/bin/naps-cli.new" "$HOME/.local/bin/naps-cli"
command -v naps-cli
naps-cli agent-guide
naps-cli keywords test --budget NaN
```

Keep the backup until the normal agent `PATH` passes these checks.
To recover, restore the backup to `~/.local/bin/naps-cli`. Do not replace the real binary or credentials.
`naps-cli update` runs the real binary directly and updates its separate binary path.
Run interactive `search-console connect` through the real binary, not this buffered agent launcher.

#### Output and failure handling

Infisical uses `--silent`, `--log-level=warn`, and an explicit domain.
Those flags alone cannot remove its plain-text child-exit message.
The loader child records the Varlock/CLI exit status, then returns success to Infisical.
The outer launcher returns the recorded status and CLI streams. CLI failures remain failures.
Varlock redacts output before the launcher buffers it. Bootstrap tokens are also removed before binary startup.
Buffers have private permissions and are removed on normal exit or handled signals.
The launcher does not export credentials to files. `SIGKILL` can leave private output buffers in the temporary directory.

Successful commands keep their stdout shape. CLI errors and optional SEO metadata remain JSON on stderr.
If Infisical or Varlock fails before binary startup, stdout remains empty.
Stderr then contains the loader stage and its original diagnostics, not CLI JSON.
The launcher preserves the loader's nonzero exit status. Repair the login, token agent, access, or schema before retrying.

### Infisical build and release

Use the [Infisical KB runbook](https://github.com/JustinyAhin/kb/blob/main/operations/environment-variables-with-infisical.md)
for project access, server authentication, credential storage, and automatic loading.
The folder and variable mappings below apply to Naps maintainer commands.

Install the [Infisical CLI](https://infisical.com/docs/cli/overview) and run `bun install`.
On the Mac, run `infisical login` with an account that can read `naps-cli-maintainer`.
The committed `.infisical.json` contains project metadata only. It selects US Cloud.

| Command                                 | Infisical environment and folder | Varlock schema            | Loaded inputs                                        |
| --------------------------------------- | -------------------------------- | ------------------------- | ---------------------------------------------------- |
| `bun run build` or `bun run build:host` | `prod:/build`                    | `env/build/.env.schema`   | Google Desktop client secret                         |
| `bun run release [--dry-run]`           | `prod:/release`                  | `env/release/.env.schema` | Google OAuth, signing, and Cloudflare release inputs |

Set these entries in the Infisical project:

| Folder     | Variable                             | Value                                                |
| ---------- | ------------------------------------ | ---------------------------------------------------- |
| `/build`   | `NAPS_GSC_CLIENT_SECRET`             | Existing Google Desktop client secret                |
| `/release` | `NAPS_GSC_CLIENT_SECRET`             | Reference to the `/build` entry                      |
| `/release` | `NAPS_GSC_REFRESH_TOKEN`             | Existing refresh token for the pinned Desktop client |
| `/release` | `NAPS_CLI_SIGNING_KEY_CONTENT`       | Complete existing OpenSSH private key                |
| `/release` | `CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID` | Access Key ID from the publishing R2 token           |
| `/release` | `CLOUDFLARE_ACCOUNT_ID`              | Account that owns the release bucket                 |

Releases require a saved `cf` OAuth login for the user running the command.
The account ID can be omitted only when `cf auth whoami` returns exactly one account.
The R2 parent Access Key ID bounds delegated S3 permissions; it does not authenticate
the REST caller. Neither its API-token value nor its S3 secret is used.
The release Google refresh token must match the pinned Desktop OAuth client.

Package scripts pass the project ID explicitly and select each folder. Machine identity
commands require the explicit ID. Infisical resolves secret references before Varlock starts.
The scripts disable personal secret overrides. Shared Infisical values supply these commands
without per-variable command arguments. Repository schemas do not import private 1Password
profiles or use its plugin.

The release command keeps Infisical → Varlock → Bun. After Varlock, it sets
`CLOUDFLARE_API_TOKEN` and legacy `CF_API_TOKEN` to empty strings for the final consumer.
This selects saved OAuth even if a token is inherited or still loaded from Infisical.
Empty values also prevent `cf` dotenv loading from restoring a token; unsetting is not enough.
Use `bun run release`, not a direct `bun scripts/release.ts` invocation.
No stored credentials or persistent login settings are changed by this selection.

**Manual Infisical cleanup:** remove `CLOUDFLARE_API_TOKEN` from maintainer `prod:/release`.
Remove `CF_API_TOKEN` from that folder too, if present. These entries are no longer release
inputs. Keep `CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID` and the underlying bucket-scoped R2 parent
token active; deleting a stored value is not permission to revoke that parent.
Keep `CLOUDFLARE_ACCOUNT_ID` for correct account selection, plus the Google and signing entries.
Do not remove unrelated service credentials. No other Cloudflare variable is required by
this workflow.

For headless use, the machine identity must read this maintainer project, including its release secrets.
Varlock removes declared Infisical and legacy 1Password bootstrap credentials before Bun starts.
This does not prevent the same user from reading its credential files.

Use **one** signing input. `NAPS_CLI_SIGNING_KEY_CONTENT` holds the complete existing
OpenSSH private key. `NAPS_CLI_SIGNING_KEY` is an absolute path to a private key already
on this machine. A path does not transfer the file. Do not generate a replacement key.
The key must match the pinned installer and updater public key.

The signing helper writes content to a temporary `700` directory and `600` file.
It removes them on completion or error. Abrupt termination can leave `naps-release-signing-*`
in the system temporary directory. Raw key content is removed before child commands.
Builds receive no signing, refresh-token, or publishing credentials. Only the Desktop
client secret is embedded.

### Infisical source development

`bun run dev <command>` loads two scopes before `env/dev/.env.schema` filters the inputs:

| Project               | Environment and folder | Inputs                                                   |
| --------------------- | ---------------------- | -------------------------------------------------------- |
| `shared-creds`        | `dev:/cli`             | Shared runtime keys and the Search Console refresh token |
| `naps-cli-maintainer` | `prod:/build`          | Existing Google Desktop client secret                    |

The package script combines the scopes with two native Infisical commands.
It does not duplicate the Google secret or need cross-project secret references.
The authenticated user or machine identity must read both projects.
Source development receives no signing or publishing inputs from Infisical.
Varlock also removes declared inherited release and bootstrap credentials.

Keep shared runtime credentials separate from the maintainer release folder.
Use `NAPS_CLI_API_KEY` for a public Naps key when applicable. Legacy direct-service
tokens remain available for private workflows. `NAPS_CLI_X_BEARER_TOKEN` is optional
for the official X provider. Source Search Console needs the Desktop client secret.
Installed releases already embed it.

Old private `~/.config/varlock/naps-cli/.env.dev` and `.env.release` files are no longer
used by repository commands. These changes do not modify an installed CLI launcher
or deployed Worker secrets. Use the [installed launcher setup](#installed-infisical-launcher) for optional runtime loading.

Public users authenticate SEO calls through the naps.sh gateway with one account key. The gateway, self-serve key issuance, and per-user daily quotas live in the `napsdotsh` web app. Hosted Reddit has a default quota of zero until commercial use is approved; the admin can enable it per account later. Release the web app migration and gateway before distributing a CLI build that expects `NAPS_CLI_API_KEY`.

- `NAPS_CLI_API_KEY` — public beta key for SEO and, when enabled, Reddit; created at `https://naps.sh/cli`; preferred over the internal token variables below
- `NAPS_CLI_SEO_API_TOKEN` or `SEO_API_TOKEN` — legacy direct SEO service token for private workflows only
- `NAPS_CLI_REDDIT_API_TOKEN` — legacy direct Reddit service token for private workflows only

- `NAPS_CLI_TWITTERAPI_TOKEN` or `TWITTERAPI_API_KEY` — TwitterAPI.io key required for `twitter-search --provider twitterapi`
- `NAPS_CLI_X_BEARER_TOKEN` or `X_BEARER_TOKEN` — X API bearer token required for `twitter-search --provider official`
- `NAPS_CLI_TREG_TOKEN` or `TREG_TOKEN` — your Treg token for LinkedIn, company, contact, and YouTube channel research
- `NAPS_CLI_TREG_ORG` or `TREG_ORG` — optional Treg team slug for personal tokens
- `NAPS_GSC_REFRESH_TOKEN` — Google Search Console refresh token for CI/headless use (optional; takes precedence over local credentials)
- `NAPS_GSC_CLIENT_ID` — Google Desktop OAuth client ID override for development builds
- `NAPS_GSC_CLIENT_SECRET` — Google Desktop OAuth client secret override for development and required build-time input for releases
- `NAPS_CLI_BASE` — download origin override for installers and `naps-cli update`

`getSeoApiClient()` and `getRedditApiClient()` require either the public Naps key or the corresponding private service token. Do not give shared internal service tokens to public CLI users. When `NAPS_CLI_API_KEY` is set, both clients use the naps.sh gateway; otherwise they use their direct service endpoint for the existing private workflow.

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

### Treg research adapters

`src/cli/treg.ts` owns the Treg command routes.
`src/commands/treg-research.ts` shapes the research results.
`src/treg/client.ts` sends credentials only to the fixed Treg HTTPS origin.
It sets the request ID and budget headers, reads costs, and returns structured errors.
It makes no automatic retries and rejects redirects.
See [the agent contract](agents.md#treg-research) for output and billing limits.

The adapters use [Treg's public endpoint schemas](https://treg.to/catalog) and their captured response examples.
Provider-specific request fields stay in the adapters. Do not forward arbitrary tool IDs or credentials from arguments.

### Command conventions

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
curl -fsSL https://naps.sh/cli/install.sh | sh

# Windows (PowerShell)
iwr -useb https://naps.sh/cli/install.ps1 | iex
```

Both install scripts respect:

- `NAPS_CLI_VERSION` — pin to a specific version (default: `latest`)
- `NAPS_CLI_INSTALL_DIR` — override install location
- `NAPS_CLI_BASE` — override the download origin (default: `https://dl.naps.sh`)

Installers resolve `latest` through a signed `versions.json`, verify each signed checksum with
OpenSSH `ssh-keygen`, prefer gzip-compressed artifacts, and verify the decompressed binary's
SHA-256. They fall back to raw artifacts when available. Releases published before signatures
were introduced need signatures backfilled before the new installers can install them.
The installer scripts are served by the naps.sh web app, separate from the R2 artifact host.
Keep the web app's static installer copies in sync with this repository before each release.
Existing `dl.naps.sh/install.*` links remain for compatibility but should not be recommended.
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
4. Set the Google client secret and matching refresh token in Infisical `prod:/release`.
   If you set `NAPS_GSC_CLIENT_ID`, it must match `BUILT_IN_GOOGLE_CLIENT_ID`.
5. Supply `NAPS_CLI_SIGNING_KEY` as the path to the existing Ed25519 private key, or use
   `NAPS_CLI_SIGNING_KEY_CONTENT` from the Infisical release folder. Set only one.
   The public key must match `src/release-signing.ts` and both installers. Keep the key
   outside the repository and R2, back it up securely, and restrict access to release workflows.

The normal `bun run release` command loads Infisical inputs through Varlock.
See [Infisical build and release](#infisical-build-and-release) for the folder mappings.
A machine identity needs access to this maintainer project, including its signing and
publishing credentials.

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
previous good version and sign the changed manifest with `NAPS_CLI_SIGNING_KEY` before uploading
both `versions.json.sig` and `versions.json`. New installers and `naps-cli update` follow that field; versioned objects
remain immutable. The legacy `cli/latest/` mirror is frozen after the v0.4.0 bridge release.

### Release flow (mechanics)

```bash
bun run release

# Build, test, compress, and checksum without changing R2:
bun run release --dry-run
```

`scripts/release.ts` does the following:

1. Verifies a clean, synchronized `main`, `cf >=0.6.0` authentication/account selection, typecheck, and tests
2. Cross-compiles all 5 targets
3. Writes each raw binary, `<binary>.gz`, a SHA-256 of the raw binary, and an Ed25519 signature of each checksum
4. Creates one-hour credentials scoped to this release's R2 paths
5. Streams three files concurrently with four 8 MiB multipart uploads per file and three retries
6. Uploads immutable gzip/checksum artifacts and install scripts
7. Publishes a signature for `versions.json`, then `versions.json` last so incomplete releases never become current

v0.4.0 is the compatibility bridge: it also uploads immutable raw binaries and refreshes only the
raw/checksum `cli/latest/` objects. v0.4.1 and later upload only immutable gzip/checksum pairs,
reducing release bytes substantially while retaining raw fallback for historical releases.

`--dry-run` performs the checks/build/package steps and prints every planned object and exact byte
count. It skips Git/`cf` preflight, temporary credentials, and all uploads.

**Auth**: install `cf >=0.6.0` (tested with `1.0.0-beta.14`). On the release machine,
authenticate as the same user that runs the release. Run the preflight from the repository
directory so `cf` selects the same saved profile:

```bash
# One-time interactive login, only when needed:
env CLOUDFLARE_API_TOKEN= CF_API_TOKEN= cf auth login

# Non-writing preflight; do not print or save OAuth credentials:
env CLOUDFLARE_API_TOKEN= CF_API_TOKEN= cf auth whoami --quiet
```

The release script always checks the JSON `cf auth whoami` response for valid OAuth.
It uses `CLOUDFLARE_ACCOUNT_ID` when set. Otherwise, exactly one returned account is required.
Use a valid 32-character hexadecimal account ID for the bucket owner. The selected account
also sets the R2 upload endpoint. The OAuth caller must be authorized to create temporary
credentials in that account. No API-token authentication fallback is supported.
The command does not change profile bindings or account settings. Normal `cf` OAuth refresh
can renew saved credentials. Current `cf` has no `context` command.

Create a long-lived **Object Read & Write** R2 API token scoped to `naps-cli-releases` under
**R2 → Overview → Manage API Tokens**.
Store only its Access Key ID as `CLOUDFLARE_R2_PARENT_ACCESS_KEY_ID` in `prod:/release`.
R2 [Object Read & Write permissions](https://developers.cloudflare.com/r2/api/tokens/#permissions)
are S3-only; an active parent is not evidence of REST authority. During v0.8.0 verification,
the active configured token matched the parent ID, but its REST policy read returned
HTTP 403/error 9109 and temporary-credential mint returned HTTP 403/error 10000.
Saved OAuth read the same parent policy and minted credentials successfully. The exact
missing REST permission group was not established; this workflow does not try to repair it.

OAuth authenticates the REST request. The parent bounds the temporary S3 rights to the release
bucket. The script further limits credentials to one hour, the version prefix, and the four
root installer/manifest objects. The parent secret is not needed. Temporary credential values
stay in memory and are not logged. Headless publishing still needs a valid saved OAuth login,
in addition to Infisical access; Infisical machine authentication alone is not Cloudflare login.

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
