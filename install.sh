#!/bin/sh
# naps-cli installer
#
# Usage:
#   curl -fsSL https://dl.naps.sh/install.sh | sh
#
# Environment overrides:
#   NAPS_CLI_VERSION       version to install (default: latest)
#   NAPS_CLI_INSTALL_DIR   target dir (default: $HOME/.local/bin)
#   NAPS_CLI_BASE          download base URL (default: https://dl.naps.sh)

set -e

BASE="${NAPS_CLI_BASE:-https://dl.naps.sh}"
VERSION="${NAPS_CLI_VERSION:-latest}"
INSTALL_DIR="${NAPS_CLI_INSTALL_DIR:-$HOME/.local/bin}"

if [ "$VERSION" = "latest" ]; then
  VERSION=$(curl -fsSL "$BASE/versions.json" | sed -n 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -z "$VERSION" ]; then
    echo "naps-cli: could not resolve the latest version" >&2
    exit 1
  fi
fi

if ! echo "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "naps-cli: invalid version: $VERSION" >&2
  exit 1
fi

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  darwin) os="darwin" ;;
  linux)  os="linux" ;;
  *) echo "naps-cli: unsupported OS: $os" >&2; exit 1 ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64|amd64)   arch="x64" ;;
  arm64|aarch64)  arch="arm64" ;;
  *) echo "naps-cli: unsupported arch: $arch" >&2; exit 1 ;;
esac

target="${os}-${arch}"
binary="naps-cli-${target}"
bin_url="${BASE}/cli/${VERSION}/${binary}"
sha_url="${bin_url}.sha256"

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t naps-cli)
trap 'rm -rf "$tmp"' EXIT

echo "naps-cli: downloading ${target} (${VERSION})..."
curl -fsSL "$sha_url" -o "$tmp/naps-cli.sha256"

if command -v gzip >/dev/null 2>&1 && curl -fSL --progress-bar "${bin_url}.gz" -o "$tmp/naps-cli.gz"; then
  if ! gzip -dc "$tmp/naps-cli.gz" > "$tmp/naps-cli"; then
    echo "naps-cli: compressed artifact is invalid, falling back to the raw binary" >&2
    curl -fSL --progress-bar "$bin_url" -o "$tmp/naps-cli"
  fi
else
  echo "naps-cli: compressed artifact unavailable, falling back to the raw binary" >&2
  curl -fSL --progress-bar "$bin_url" -o "$tmp/naps-cli"
fi

echo "naps-cli: verifying checksum..."
expected=$(awk '{print $1}' "$tmp/naps-cli.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/naps-cli" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/naps-cli" | awk '{print $1}')
else
  echo "naps-cli: no sha256sum or shasum available; cannot verify the download" >&2
  exit 1
fi
if [ "$expected" != "$actual" ]; then
  echo "naps-cli: checksum mismatch" >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $actual" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
mv "$tmp/naps-cli" "$INSTALL_DIR/naps-cli"
chmod +x "$INSTALL_DIR/naps-cli"

echo ""
echo "naps-cli: installed to $INSTALL_DIR/naps-cli"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "naps-cli: $INSTALL_DIR is not in your PATH."
    echo "          add to your shell profile:"
    echo "            export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

echo ""
"$INSTALL_DIR/naps-cli" --version 2>/dev/null || true
