# Data and credentials

[Home](../README.md) · [Getting started](getting-started.md) · [Agents](agents.md)

| Feature        | Request path                                                     | Credential handling                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reddit and SEO | CLI → naps.sh gateway → Naps-hosted services and their providers | The CLI sends your Naps key to naps.sh over HTTPS. The gateway stores only a SHA-256 hash and a short key prefix, and tracks daily usage by account. Naps keeps its provider tokens on the server.                   |
| Twitter/X      | CLI → selected Twitter/X provider                                | Your provider token stays in your environment and is sent directly to that provider. Naps does not proxy these requests.                                                                                             |
| Search Console | CLI → Google                                                     | Google OAuth opens in your browser. The refresh token is stored locally in the user config, with user-only file permissions where supported. Naps does not receive the token or Search Console data through the CLI. |

Reddit and SEO queries pass through Naps to the relevant provider. The SEO service records request and research events for operations, including queried keywords or domains and provider costs. Do not send private or sensitive text as a search query unless you are comfortable with that path. Naps-hosted request and account handling are described further at [naps.sh/cli/privacy](https://naps.sh/cli/privacy).

On macOS and Linux, the Search Console config is `${XDG_CONFIG_HOME:-~/.config}/naps/config.json`; on Windows, it is `%APPDATA%\naps\config.json`. `naps-cli search-console disconnect` attempts to revoke the Google token and removes the local connection. `NAPS_GSC_REFRESH_TOKEN` can override the local token for headless runs. `NAPS_GSC_CLIENT_ID` and `NAPS_GSC_CLIENT_SECRET` override the bundled desktop OAuth client for development or custom clients.

Do not add `.env` files, API keys, refresh tokens, or client secrets to this repository. Replacing or revoking a Naps key at [naps.sh/cli](https://naps.sh/cli) invalidates it immediately. For a leaked Twitter/X or Google credential, revoke it with that provider.
