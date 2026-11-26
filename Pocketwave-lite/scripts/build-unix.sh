#!/usr/bin/env bash
# One-click build for Linux and macOS. It is started by Build-Pocketwave.sh (Linux) and Build-Pocketwave.command (macOS).
#   1. uses the portable Node.js from ../components when present (offline build), otherwise downloads one into ./runtime (nothing is installed on the computer);
#   2. runs the Pocketwave Build System (scripts/build-system.js): dependencies, build, ./Pocketwave-portable, cleanup;
#   3. starts Pocketwave.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

OS="$(uname -s)"
case "$OS" in
  Linux)  PLATFORM=linux ;;
  Darwin) PLATFORM=darwin ;;
  *) echo "  This system ($OS) is not supported. Use Build-Pocketwave.bat on Windows."; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "  This processor ($(uname -m)) is not supported."; exit 1 ;;
esac

PORT="$ROOT/Pocketwave-portable"
RT="$ROOT/runtime"
NODE_DIR="$RT/node"

# Offline mode: when the components folder (next to this edition) holds Node.js for this system, nothing is downloaded
COMP="$(cd "$ROOT/../components" 2>/dev/null && pwd)"
if [ -n "$COMP" ] && [ -x "$COMP/node-$PLATFORM-$ARCH/bin/node" ] && [ -f "$COMP/electron-checksums.json" ] && [ -d "$COMP/npm-cache/_cacache" ]; then
  NODE_DIR="$COMP/node-$PLATFORM-$ARCH"
fi

fail() {
  echo
  echo "  --------------------------------------------------------"
  echo "  The build could not be completed. Please copy the message"
  echo "  above and report it."
  echo "  --------------------------------------------------------"
  if [ -t 0 ]; then read -r -p "  Press Enter to close..." _; fi
  exit 1
}

is_built() {
  if [ "$PLATFORM" = darwin ]; then [ -d "$PORT/Pocketwave.app" ]; else [ -x "$PORT/Pocketwave" ]; fi
}

start_program() {
  if [ "$PLATFORM" = darwin ]; then
    open "$PORT/Pocketwave.app"
  else
    # On some systems (for example Ubuntu 24.04) Chromium's sandbox is not allowed for programs that are not installed
    # system-wide. In that case Pocketwave is started without Chromium's extra sandbox layer; it never opens remote content.
    FLAGS=""
    if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] \
      || [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] \
      || [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ]; then FLAGS="--no-sandbox"; fi
    nohup "$PORT/Pocketwave" $FLAGS "$@" >/dev/null 2>&1 &
  fi
}

if is_built; then start_program "$@"; exit 0; fi

# ---------- First start: build ----------
download() {   # download URL FILE
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else echo "  curl or wget is needed to download the components."; return 1; fi
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo
  echo "  POCKETWAVE BUILD SYSTEM"
  echo "  Downloading a portable Node.js (the components folder was not found)..."
  mkdir -p "$RT"
  BASE="https://nodejs.org/dist/latest-v22.x"
  download "$BASE/SHASUMS256.txt" "$RT/SHASUMS256.txt" || fail
  LINE="$(grep -E " node-v[0-9.]+-${PLATFORM}-${ARCH}\.tar\.gz\$" "$RT/SHASUMS256.txt" | head -1)"
  [ -n "$LINE" ] || { echo "  Could not find the Node.js download for $PLATFORM $ARCH."; fail; }
  WANT="$(echo "$LINE" | awk '{print $1}')"; NAME="$(echo "$LINE" | awk '{print $2}')"
  echo "  Downloading $NAME (about 40 MB)..."
  download "$BASE/$NAME" "$RT/node.tar.gz" || fail
  [ "$(sha256_of "$RT/node.tar.gz")" = "$WANT" ] || { echo "  The downloaded file is damaged (checksum mismatch). Please try again."; fail; }
  mkdir -p "$RT/node-unpack" && tar -xzf "$RT/node.tar.gz" -C "$RT/node-unpack" || fail
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$RT/node-unpack"/* "$NODE_DIR" || fail
  rm -rf "$RT/node-unpack" "$RT/node.tar.gz" "$RT/SHASUMS256.txt"
fi

"$NODE_DIR/bin/node" "$ROOT/scripts/build-system.js" || fail
rm -rf "$RT"
start_program "$@"
exit 0
