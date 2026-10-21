# Using naps-cli with agents

[Home](../README.md) · [Setup](getting-started.md) · [Credentials](data-and-credentials.md)

Use `naps-cli` for research. This file is the detailed agent guide.
Run `naps-cli agent-guide` for offline instructions.

```sh
naps-cli --help
naps-cli agent-guide
naps-cli <command> --help
```

## Credentials and output

- Set `NAPS_CLI_API_KEY` in the agent's environment for SEO, YouTube, and enabled Reddit access.
- Keep credentials out of prompts, command arguments, source files, and output.
- If you add a key after the agent starts, restart the agent.
- When the exit status is zero, read stdout as JSON.
- When a command fails, read stderr JSON. Use `error.code` and `error.hint`.
- If the [Infisical launcher](maintainer.md#installed-infisical-launcher) cannot load credentials, repair its configuration first. Its diagnostics are not CLI JSON.

Twitter/X uses a separate provider key. Search Console uses Google OAuth and connects directly to Google.
See [Setup](getting-started.md) for these credentials.

## Request limits

| Command              | Limit                                                 |
| -------------------- | ----------------------------------------------------- |
| `keywords-bulk`      | 1–50 keywords                                         |
| `reddit-search`      | 1–100 results                                         |
| `reddit-subreddits`  | 1–25 results                                          |
| `twitter-search`     | 1–100 results; up to five provider requests           |
| `youtube-search`     | 20 result blocks; a block can contain several items   |
| `youtube-comments`   | Up to 20 top comments, with full text                 |
| `youtube-transcript` | Available captions, with full text and timed segments |

Use small result limits. Use Reddit `--full` only when you need more text.
Bulk results keep the input order and repeated keywords. The service charges once for each different keyword in a batch.
Read `error` in each bulk result, including when the command succeeds.

## SEO spend and freshness controls

Keyword and YouTube commands accept these flags. They require the updated SEO service and gateway.

| Flag                   | Action                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `--refresh`            | Get new results instead of a saved result                                    |
| `--budget <USD>`       | Set a finite, nonnegative cost estimate limit. Zero prevents new paid tasks. |
| `--metadata`           | Write cost, cache age, and job data to stderr                                |
| `--request-id <value>` | Resume a saved bulk run. Only `keywords-bulk` accepts this flag.             |

A cache is a saved result that the service can use again. A budget uses estimated costs.
Actual charges can be higher than the estimate.

```sh
naps-cli keywords 'invoice software' --metadata >results.json 2>metadata.json
naps-cli keywords-bulk 'invoice software' 'bookkeeping' --budget 0.05 --request-id research-1 --metadata
```

`--metadata` keeps stdout unchanged. It returns `seo.requestId`, `seo.providerCostUsd`, and `seo.metadata` on success.
On failure, read these fields in `error.details.seo`.
Costs for saved results are zero. Unknown costs are null. Do not add old costs to new charges.

To resume a bulk run, use the same request ID, inputs, location, and language.
Increase `--budget` if necessary. Different inputs with the same ID cause `SEO_REQUEST_ID_CONFLICT`.
`--refresh` with the same ID still resumes that run.
To start a new run, use `--refresh` with a new request ID.

For `SEO_AMBIGUOUS_PROVIDER_OUTCOME` or a bulk `AMBIGUOUS_PROVIDER_OUTCOME`, stop.
Request operator reconciliation. Do not retry with refresh or a new request ID.

## YouTube

```sh
naps-cli youtube-search 'invoice software' --metadata
naps-cli youtube-comments Y8Wu4rSNJms --budget 0.002
naps-cli youtube-transcript Y8Wu4rSNJms --subtitles-language en --translate-language fr --budget 0.006 --metadata
```

Keep each search result's `type`. Missing measurements are null, not zero.
Use transcript text only when `available` is true.
See [YouTube commands](getting-started.md#youtube) for costs, language options, and output fields.
