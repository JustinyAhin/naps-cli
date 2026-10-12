# Using naps-cli with agents

[Home](../README.md) · [Getting started](getting-started.md) · [Data and credentials](data-and-credentials.md)

Agents can run `naps-cli` as an ordinary command. Give the agent the commands it may use and inject credentials through its environment or secret manager. The agent does not need an interactive browser session to use Reddit, SEO, or Twitter/X.

For a copyable agent setup prompt and public setup instructions, see [naps.sh/cli](https://naps.sh/cli) and its [agent guide](https://naps.sh/cli/agent.md). Keep the key out of the prompt. An agent can only read environment variables supplied to its process; restart it after adding a key if needed.

```sh
naps-cli --help
naps-cli keywords 'invoice software for freelancers'
```

Parse stdout as JSON only when the exit status is zero. On failure, parse stderr as JSON and use `error.code` and `error.hint`. Keep the API key and provider tokens out of prompts, command arguments, and tool output.

Start with small result limits and focused queries. `twitter-search` accepts 1–100 results and makes at most five provider page requests. A `keywords-bulk` call accepts up to 50 keywords. The updated SEO service reuses identical trimmed seeds within a batch and preserves result order and cardinality. Reused entries have `cost: 0`; they do not represent additional provider charges. If Reddit is enabled for the account, `reddit-search` accepts 1–100 results and `reddit-subreddits` 1–25. Use `--full` for Reddit only when the longer text is needed.

## SEO spend and freshness controls

These controls require the updated SEO service and gateway. Deploy those components before using budgets or resumable runs. An older service can ignore the control headers.

The four keyword commands accept `--refresh`, `--budget`, and `--metadata`. Only `keywords-bulk` accepts `--request-id`.

```sh
naps-cli keywords 'invoice software' --metadata >results.json 2>metadata.json
naps-cli keywords-bulk 'invoice software' 'bookkeeping' --budget 0.05 --request-id research-1 --metadata
```

- `--refresh` bypasses successful cached results. It does not change ranking, result counts, or query text.
- `--budget <USD>` sets a nonnegative, finite run budget. Before each new paid task, the service compares its estimate with the remaining budget. Actual provider charges remain authoritative; an estimate is not a guaranteed invoice cap. Zero prevents new paid tasks but permits reusable results.
- `--request-id <value>` identifies a resumable bulk run. To resume, use the same ID, inputs, location, and language. You can increase the budget on resume. Changed research inputs with the same ID produce `SEO_REQUEST_ID_CONFLICT`.
- `--metadata` writes one JSON document to stderr on success. Stdout keeps its existing JSON shape. The document contains `seo.requestId`, `seo.providerCostUsd`, and `seo.metadata` from the service. Missing cost information stays `null`, not zero. On HTTP failure, metadata appears in `error.details.seo` within the existing error document.

Inspect `seo.metadata` for estimated cost, actual cost, unknown costs, task provenance, cache age, and job status. Do not sum historical task costs to infer new charges. For bulk responses, inspect every entry's `error`, even when the command exits successfully. Budget stops and ambiguous provider outcomes retain explicit error entries instead of silently omitting results.

To resume a budget-stopped batch, repeat its inputs and request ID with a sufficient budget. For `SEO_AMBIGUOUS_PROVIDER_OUTCOME` or an `AMBIGUOUS_PROVIDER_OUTCOME` bulk entry, stop and contact the service operator for reconciliation. Do not retry ambiguous billable work, including with `--refresh` or a new request ID. The service keeps that work held until reconciliation. `--refresh` with the same request ID still resumes that run. For an intentional fresh rerun without an ambiguous outcome, use `--refresh` and a new request ID.

Search Console needs one local `connect` step on an interactive machine. For a headless agent, pass a refresh token and matching OAuth client credentials from a secret manager. Search Console requests go directly from the CLI to Google.

The generated API clients in `packages/api-clients` are build inputs, not something an agent needs to manage. Agents should call the CLI and follow its JSON output and help text.
