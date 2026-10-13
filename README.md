# naps-cli

Research Reddit, search demand, Twitter/X, and your Google Search Console data from a terminal or agent. Commands return JSON to stdout and structured errors to stderr.

## Install

macOS and Linux:

```sh
curl -fsSL https://naps.sh/cli/install.sh | sh
```

Windows PowerShell:

```powershell
iwr -useb https://naps.sh/cli/install.ps1 | iex
```

Installers verify Ed25519 signatures on release metadata and SHA-256 checksums. They require OpenSSH `ssh-keygen`. Run `naps-cli --help` for the command list and `naps-cli <command> --help` for options. Existing installations can run `naps-cli update`.

## Quick start

SEO commands need a Naps API key. [Sign in at naps.sh/cli](https://naps.sh/cli) to receive five free SEO units per day, create a key, and set it in your environment:

```sh
export NAPS_CLI_API_KEY='your-key'
naps-cli keywords 'small business bookkeeping'
```

Hosted Reddit access is disabled for new accounts until its commercial use is approved. Twitter/X commands use your own provider key. Search Console connects directly to Google on your machine. See [Getting started](docs/getting-started.md) for each setup path.

## Documentation

- [Getting started and credentials](docs/getting-started.md)
- [Agent and script usage](docs/agents.md)
- [Data and credential handling](docs/data-and-credentials.md)
- [Maintainer and release notes](docs/maintainer.md)
- [Environment variables with Infisical (KB)](https://github.com/JustinyAhin/kb/blob/main/operations/environment-variables-with-infisical.md)

## Development

This repository contains the CLI and generated API clients. The Naps-hosted SEO and Reddit services and account page live in the `napsdotsh` repository.

```sh
bun install
bun run check
bun test
bun run build:host
```

Development, build, and release commands load Infisical secrets through Varlock. Sign in with `infisical login` before these commands.
Run from source with `bun run dev --help`.
See the [maintainer setup](docs/maintainer.md#infisical-build-and-release) for project paths and credentials.
Source development combines the [shared runtime and Google Desktop scopes](docs/maintainer.md#infisical-source-development).
Type checks and tests do not need credentials. Regenerate API clients from the live OpenAPI endpoints with `bun run --cwd packages/api-clients gen`.

MIT licensed; see [LICENSE](LICENSE).
