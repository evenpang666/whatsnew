#!/usr/bin/env sh
# Sourced by start.sh; keep the runtime and PATH local to this launch.
whatsnew_node_ok() {
  "$1" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' >/dev/null 2>&1
}

whatsnew_download() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --connect-timeout 10 --max-time 120 --retry 1 --output "$2" "$1" ||
      curl --noproxy '*' --fail --location --connect-timeout 10 --max-time 120 --output "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --timeout=30 --tries=2 -O "$2" "$1" ||
      HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= wget --no-proxy --timeout=30 --tries=1 -O "$2" "$1"
  else
    printf '%s\n' 'Automatic Node.js setup needs curl or wget. Install one and start again.' >&2
    return 1
  fi
}

whatsnew_install_node() (
  set -eu
  case "$(uname -s)" in Linux) whatsnew_os=linux ;; Darwin) whatsnew_os=darwin ;; *) printf '%s\n' 'Unsupported system. Use start.bat on Windows.' >&2; exit 1 ;; esac
  case "$(uname -m)" in x86_64|amd64) whatsnew_arch=x64 ;; aarch64|arm64) whatsnew_arch=arm64 ;; *) printf '%s\n' 'Automatic Node.js setup supports x64 and arm64.' >&2; exit 1 ;; esac
  command -v tar >/dev/null 2>&1 || { printf '%s\n' 'Automatic Node.js setup needs tar.' >&2; exit 1; }
  mkdir -p "$WHATSNEW_ROOT/.runtime/node" || exit 1
  whatsnew_stage=$(mktemp -d "$WHATSNEW_ROOT/.runtime/node/.install-XXXXXX") || exit 1
  trap 'rm -rf "$whatsnew_stage"' EXIT
  trap 'exit 130' INT TERM
  whatsnew_release=$(sed -n 's/.*"node": "\([0-9.]*\)".*/\1/p' "$WHATSNEW_ROOT/scripts/runtime-versions.json")
  [ -n "$whatsnew_release" ] || exit 1
  printf '%s\n' "[环境] 补齐项目内 Node.js $whatsnew_release 和 npm…"
  whatsnew_download "https://nodejs.org/dist/v$whatsnew_release/SHASUMS256.txt" "$whatsnew_stage/SHASUMS256.txt" || exit 1
  whatsnew_archive="node-v$whatsnew_release-$whatsnew_os-$whatsnew_arch.tar.gz"
  [ -n "$whatsnew_archive" ] || { printf '%s\n' 'The official Node.js archive was not found for this platform.' >&2; exit 1; }
  whatsnew_release=${whatsnew_archive#node-}; whatsnew_release=${whatsnew_release%%-*}
  whatsnew_download "https://nodejs.org/dist/$whatsnew_release/$whatsnew_archive" "$whatsnew_stage/$whatsnew_archive" || exit 1
  whatsnew_expected=$(awk -v name="$whatsnew_archive" '$2==name {print $1}' "$whatsnew_stage/SHASUMS256.txt")
  [ -n "$whatsnew_expected" ] || { printf '%s\n' 'Official archive checksum not found.' >&2; exit 1; }
  if command -v sha256sum >/dev/null 2>&1; then whatsnew_actual=$(sha256sum "$whatsnew_stage/$whatsnew_archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then whatsnew_actual=$(shasum -a 256 "$whatsnew_stage/$whatsnew_archive" | awk '{print $1}')
  elif command -v openssl >/dev/null 2>&1; then whatsnew_actual=$(openssl dgst -sha256 "$whatsnew_stage/$whatsnew_archive" | awk '{print $NF}')
  else printf '%s\n' 'No SHA-256 verification tool is available.' >&2; exit 1; fi
  [ "$whatsnew_actual" = "$whatsnew_expected" ] || { printf '%s\n' 'Node.js download checksum mismatch. Start again to retry.' >&2; exit 1; }
  tar -xzf "$whatsnew_stage/$whatsnew_archive" -C "$whatsnew_stage" || exit 1
  whatsnew_unpacked="$whatsnew_stage/${whatsnew_archive%.tar.gz}"
  whatsnew_node_ok "$whatsnew_unpacked/bin/node" || { printf '%s\n' 'Downloaded Node.js cannot run on this system.' >&2; exit 1; }
  "$whatsnew_unpacked/bin/node" "$whatsnew_unpacked/lib/node_modules/npm/bin/npm-cli.js" --version >/dev/null || exit 1
  if [ -e "$WHATSNEW_ROOT/.runtime/node/current" ]; then mv "$WHATSNEW_ROOT/.runtime/node/current" "$whatsnew_stage/previous"; fi
  if ! mv "$whatsnew_unpacked" "$WHATSNEW_ROOT/.runtime/node/current"; then
    if [ -e "$whatsnew_stage/previous" ]; then mv "$whatsnew_stage/previous" "$WHATSNEW_ROOT/.runtime/node/current"; fi
    exit 1
  fi
)

whatsnew_prepare_node() {
  WHATSNEW_NODE=$(command -v node || true)
  if [ -n "$WHATSNEW_NODE" ] && whatsnew_node_ok "$WHATSNEW_NODE" && command -v npm >/dev/null 2>&1 && npm --version >/dev/null 2>&1; then
    PATH="$(dirname -- "$WHATSNEW_NODE"):$PATH"
  else
    WHATSNEW_NODE="$WHATSNEW_ROOT/.runtime/node/current/bin/node"
    if ! whatsnew_node_ok "$WHATSNEW_NODE" || ! "$WHATSNEW_NODE" "$WHATSNEW_ROOT/.runtime/node/current/lib/node_modules/npm/bin/npm-cli.js" --version >/dev/null 2>&1; then
      whatsnew_install_node || return 1
    fi
    PATH="$WHATSNEW_ROOT/.runtime/node/current/bin:$PATH"
    npm_execpath="$WHATSNEW_ROOT/.runtime/node/current/lib/node_modules/npm/bin/npm-cli.js"
    export npm_execpath
  fi
  WHATSNEW_BOOTSTRAPPED=1
  export WHATSNEW_NODE PATH WHATSNEW_BOOTSTRAPPED
}
