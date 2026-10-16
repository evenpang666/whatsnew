#!/usr/bin/env sh
set -eu
WHATSNEW_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$WHATSNEW_ROOT"
. "$WHATSNEW_ROOT/scripts/bootstrap-node.sh"
whatsnew_prepare_node
exec "$WHATSNEW_NODE" "$WHATSNEW_ROOT/scripts/environment.mjs" "$@"
