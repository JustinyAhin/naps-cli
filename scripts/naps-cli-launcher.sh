#!/bin/sh
# Optional installed-CLI launcher. See docs/maintainer.md#installed-infisical-launcher.

# This stage runs inside Infisical. Keep Varlock redaction around the real CLI.
if [ "${1-}" = --launcher-loaded ]; then
  scratch=$2
  varlock=$3
  profile=$4
  binary=$5
  shift 5
  "$varlock" run --path "$profile" --inject vars --redact-stdout -- \
    sh -c '
      started=$1
      shift
      unset INFISICAL_TOKEN INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN
      unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET
      unset INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET
      unset OP_TOKEN OP_SERVICE_ACCOUNT_TOKEN OP_ENVIRONMENT_ID
      printf "started\n" > "$started" || exit 1
      exec "$@"
    ' naps-cli "$scratch/started" "$binary" "$@" \
    > "$scratch/stdout" 2> "$scratch/stderr"
  status=$?
  printf '%s\n' "$status" > "$scratch/status" || exit 1
  # Infisical must not turn a CLI failure into a second, plain-text error.
  exit 0
fi

binary=${NAPS_CLI_BINARY:-$HOME/.local/lib/naps-cli/naps-cli}
if [ ! -x "$binary" ]; then
  printf 'naps-cli launcher: executable unavailable: %s\n' "$binary" >&2
  exit 126
fi

# These commands need no credential bootstrap.
case "${1-}" in
  ''|--help|-h|--version|-v|agent-guide|update|completion) exec "$binary" "$@" ;;
esac
for arg do
  case "$arg" in
    --) break ;;
    --help|-h) exec "$binary" "$@" ;;
  esac
done

umask 077
scratch=$(mktemp -d "${TMPDIR:-/tmp}/naps-cli-launcher.XXXXXXXX") || exit 1
trap 'rm -rf "$scratch"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
self=$(CDPATH= cd "$(dirname "$0")" && pwd)/$(basename "$0")

"${NAPS_CLI_INFISICAL_BIN:-infisical}" run \
  --projectId="${NAPS_CLI_INFISICAL_PROJECT_ID:-1dc4d864-c7a3-41fe-804f-d60495474d5b}" \
  --env=dev --path=/cli --secret-overriding=false \
  --silent --log-level=warn --log-destination=stderr \
  --domain="${NAPS_CLI_INFISICAL_DOMAIN:-https://app.infisical.com/api}" -- \
  sh "$self" --launcher-loaded "$scratch" "${NAPS_CLI_VARLOCK_BIN:-varlock}" \
  "${NAPS_CLI_VARLOCK_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/varlock/shared-cli}" \
  "$binary" "$@" > "$scratch/loader.stdout" 2> "$scratch/loader.stderr"
loader_status=$?
if [ "$loader_status" -ne 0 ]; then
  printf 'naps-cli launcher: Infisical credential bootstrap failed.\n' >&2
  cat "$scratch/loader.stderr" "$scratch/loader.stdout" >&2
  exit "$loader_status"
fi
if [ ! -s "$scratch/status" ]; then
  printf 'naps-cli launcher: credential loader did not start the command.\n' >&2
  cat "$scratch/loader.stderr" "$scratch/loader.stdout" >&2
  exit 1
fi
status=$(cat "$scratch/status")
if [ ! -f "$scratch/started" ]; then
  printf 'naps-cli launcher: Varlock credential validation failed.\n' >&2
  cat "$scratch/stderr" "$scratch/stdout" >&2
  exit "$status"
fi

cat "$scratch/stdout"
cat "$scratch/stderr" >&2
exit "$status"
