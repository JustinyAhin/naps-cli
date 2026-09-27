# naps-cli

Command-line research tools for Reddit, Twitter/X, SEO keywords, and Google Search Console.

## Development

This repository contains the CLI and its generated API clients. The SEO and Reddit services remain in the `napsdotsh` repository.

```bash
bun install
bun run check
bun test
bun run build:host
```

Run the source directly with `bun run index.ts --help`. Regenerate the clients from the live OpenAPI endpoints with `bun run --cwd packages/api-clients gen`.

See [maintainer notes](docs/maintainer.md) for the release workflow.

## Install

macOS and Linux:

```bash
curl -fsSL https://dl.naps.sh/install.sh | sh
```

Windows PowerShell:

```powershell
iwr -useb https://dl.naps.sh/install.ps1 | iex
```

Run `naps-cli --help` to see all commands and `naps-cli <command> --help` for command-specific
arguments. Existing installations can update themselves with:

```bash
naps-cli update
```

Command runtime failures are written to stderr as JSON and exit with status 1:

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "What failed.",
    "hint": "How to recover."
  }
}
```

`hint` and sanitized `details` are included when useful. Command syntax and argument-scanning
errors remain human-readable terminal text. `search-console status` exits successfully when no
connection exists, but exits with status 1 when saved credentials exist and cannot be validated.

Installers verify SHA-256 checksums before replacing the executable. Set `NAPS_CLI_VERSION` to pin
a release or `NAPS_CLI_INSTALL_DIR` to choose the installation directory.

## Reddit research output

`reddit-search` keeps its JSON array output and honors `--limit` (including values above 15). Posts include `id`, `author`, `created_utc` (Unix seconds), `num_comments`, and `permalink`. Default search text is capped at 600 characters, with `selftext_truncated` indicating shortening. Add `--full` for unshortened text.

`reddit-post` includes the same provenance fields alongside `title`, `selftext`, and `comments`. Default post text is capped at 3,000 characters, comment text at 500, and top-level comments at 15. `selftext_truncated`, `body_truncated`, `comments_truncated`, and `replies_omitted` expose CLI omissions. Comment metadata includes ID, author, timestamp, parent ID, depth, and submitter status.

Use `reddit-post <url> --full` to preserve all text, top-level comments, and nested replies returned by the API. This does not expand Reddit's more-comments placeholders: `comments_complete` remains false and `comments_scope` explains the upstream limit. Do not interpret `--full` as a complete Reddit discussion or search results as exhaustive. Search phrases separated by commas are ORed by the API; each phrase is quoted.
