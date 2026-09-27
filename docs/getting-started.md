# Getting started

[Home](../README.md) · [Agents](agents.md) · [Data and credentials](data-and-credentials.md)

## Choose the credentials you need

| Commands                             | Credential                                          | Where to get it                                                   |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------- |
| `keywords*`, `locations`             | `NAPS_CLI_API_KEY`                                  | [naps.sh/cli](https://naps.sh/cli). Sign in and create a key.     |
| `reddit-*`                           | `NAPS_CLI_API_KEY`                                  | Hosted Reddit is available only when enabled for your account.    |
| `twitter-search` (default provider)  | `NAPS_CLI_TWITTERAPI_TOKEN` or `TWITTERAPI_API_KEY` | Your TwitterAPI.io account.                                       |
| `twitter-search --provider official` | `NAPS_CLI_X_BEARER_TOKEN` or `X_BEARER_TOKEN`       | Your X developer account.                                         |
| `search-console *`                   | Google OAuth connection                             | Run `naps-cli search-console connect` locally.                    |

Set keys as environment variables in your shell or agent runner. Keep them out of command arguments, source control, and shared logs. If you replace a Naps key at [naps.sh/cli](https://naps.sh/cli), the old key stops working immediately.

## SEO

```sh
export NAPS_CLI_API_KEY='your-key'
naps-cli keywords 'invoicing software' --location 'United States'
naps-cli keywords-serp 'invoicing software'
naps-cli keywords-website 'https://example.com'
naps-cli keywords-bulk 'invoicing software' 'freelance invoices'
naps-cli locations
```

Naps-hosted requests have separate daily allowances, shown at [naps.sh/cli](https://naps.sh/cli). New accounts receive five SEO units per day. Each keyword or SERP call uses one SEO unit, `keywords-bulk` uses one per nonempty keyword, and `locations` uses none. Allowances reset at 00:00 UTC. Failed upstream requests can still use an allowance because it is reserved before the provider call.

## Reddit, when enabled

Hosted Reddit access is disabled for new accounts until its commercial use is approved. If your account has a Reddit allowance, each call uses one Reddit request:

```sh
naps-cli reddit-search 'customer complaints about invoicing' --limit 10
naps-cli reddit-post 'https://www.reddit.com/r/example/comments/...'
naps-cli reddit-subreddits 'freelancers'
```

Search output is a sample, not a complete dataset. `reddit-search --full` and `reddit-post --full` return more text and comments, but Reddit may still omit more-comments placeholders. Use `--limit` to keep agent context and provider usage predictable.

## Twitter/X

```sh
export NAPS_CLI_TWITTERAPI_TOKEN='your-provider-key'
naps-cli twitter-search 'invoicing software' --limit 20
```

For the official X API, set `NAPS_CLI_X_BEARER_TOKEN` and use `--provider official`. The two providers have their own prices, limits, and data access rules. The CLI caps a search at 100 results and five pages; it can return fewer when the provider runs out of results or applies a limit.

## Google Search Console

```sh
naps-cli search-console connect
naps-cli search-console status
naps-cli search-console sites
naps-cli search-console analytics sc-domain:example.com
naps-cli search-console disconnect
```

`connect` opens Google in your browser and requests read-only Search Console access. The CLI stores the Google refresh token in a local user config file. For headless use, provide `NAPS_GSC_REFRESH_TOKEN` and a matching desktop OAuth client ID and secret through your secret manager; see [Data and credentials](data-and-credentials.md).

## Help and errors

Run `naps-cli --help` or `naps-cli <command> --help`. Successful command data goes to stdout as JSON. Errors go to stderr as one JSON object per line, with an `error.code`, `error.message`, and often an `error.hint`; commands exit with status 1. This includes invalid arguments and authentication failures.
