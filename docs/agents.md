# Using naps-cli with agents

[Home](../README.md) · [Getting started](getting-started.md) · [Data and credentials](data-and-credentials.md)

Agents can run `naps-cli` as an ordinary command. Give the agent the commands it may use and inject credentials through its environment or secret manager. The agent does not need an interactive browser session to use Reddit, SEO, or Twitter/X.

For a copyable agent setup prompt and public setup instructions, see [naps.sh/cli](https://naps.sh/cli) and its [agent guide](https://naps.sh/cli/agent.md). Keep the key out of the prompt. An agent can only read environment variables supplied to its process; restart it after adding a key if needed.

```sh
naps-cli --help
naps-cli keywords 'invoice software for freelancers'
```

Parse stdout as JSON only when the exit status is zero. On failure, parse stderr as JSON and use `error.code` and `error.hint`. Keep the API key and provider tokens out of prompts, command arguments, and tool output.

Start with small result limits and focused queries. `twitter-search` accepts 1–100 results and makes at most five provider page requests. A `keywords-bulk` call accepts up to 50 keywords and uses one SEO quota unit per keyword. If Reddit is enabled for the account, `reddit-search` accepts 1–100 results and `reddit-subreddits` 1–25. Use `--full` for Reddit only when the longer text is needed.

Search Console needs one local `connect` step on an interactive machine. For a headless agent, pass a refresh token and matching OAuth client credentials from a secret manager. Search Console requests go directly from the CLI to Google.

The generated API clients in `packages/api-clients` are build inputs, not something an agent needs to manage. Agents should call the CLI and follow its JSON output and help text.
