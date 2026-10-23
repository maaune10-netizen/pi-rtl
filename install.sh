#!/bin/sh
# pi-rtl bootstrap: fetch the latest main and run the installer.
#   curl -fsSL https://raw.githubusercontent.com/maaune10-netizen/pi-rtl/main/install.sh | sh
set -eu

REPO="${PI_RTL_REPO:-https://github.com/maaune10-netizen/pi-rtl}"
REF="${PI_RTL_REF:-main}"

command -v node >/dev/null 2>&1 || { echo "pi-rtl: node is required (pi already needs it)" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "pi-rtl: curl is required" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "pi-rtl: fetching $REPO@$REF"
curl -fsSL "$REPO/archive/refs/heads/$REF.tar.gz" | tar xz -C "$tmp" || {
    echo "pi-rtl: download failed" >&2
    exit 1
}

cd "$tmp"/pi-rtl-*
node bin/pi-rtl.mjs "$@"
