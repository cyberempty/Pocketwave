#!/usr/bin/env bash
# One-click build for Linux and macOS. It is started by Build-Pocketwave.sh (Linux) and Build-Pocketwave.command (macOS).
#   1. downloads a portable Node.js into ./runtime (nothing is installed on the computer);
#   2. installs the dependencies and builds the program;
#   3. creates ./Pocketwave-portable, removes the temporary files and starts Pocketwave.
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
echo
echo "  POCKETWAVE"
echo "  --------------------------------------------------------"
echo "  First start: building the program. This happens only once,"
echo "  needs an Internet connection and takes a few minutes."
echo "  Nothing is installed on your computer: everything stays"
echo "  in this folder and the temporary files are removed at the end."
echo

download() {   # download URL FILE
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else echo "  curl or wget is needed to download the components."; return 1; fi
}
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

mkdir -p "$RT"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "  [  0%] Downloading Node.js (portable)"
  BASE="https://nodejs.org/dist/latest-v22.x"
  download "$BASE/SHASUMS256.txt" "$RT/SHASUMS256.txt" || fail
  LINE="$(grep -E " node-v[0-9.]+-${PLATFORM}-${ARCH}\.tar\.gz\$" "$RT/SHASUMS256.txt" | head -1)"
  [ -n "$LINE" ] || { echo "  Could not find the Node.js download for $PLATFORM $ARCH."; fail; }
  WANT="$(echo "$LINE" | awk '{print $1}')"; NAME="$(echo "$LINE" | awk '{print $2}')"
  echo "        Downloading $NAME (about 40 MB)..."
  download "$BASE/$NAME" "$RT/node.tar.gz" || fail
  [ "$(sha256_of "$RT/node.tar.gz")" = "$WANT" ] || { echo "  The downloaded file is damaged (checksum mismatch). Please try again."; fail; }
  echo "        Unpacking..."
  mkdir -p "$RT/node-unpack" && tar -xzf "$RT/node.tar.gz" -C "$RT/node-unpack" || fail
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$RT/node-unpack"/* "$NODE_DIR" || fail
  rm -rf "$RT/node-unpack" "$RT/node.tar.gz" "$RT/SHASUMS256.txt"
fi

# Everything the build needs stays inside this folder
export PATH="$NODE_DIR/bin:$PATH"
export npm_config_cache="$RT/npm-cache"
export electron_config_cache="$RT/electron-cache"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

echo
echo "  [ 30%] Installing the project dependencies"
npm ci --no-progress || fail

echo
echo "  [ 55%] Building Pocketwave (downloads the Electron runtime, about 110 MB)"
node scripts/build.js --platform="$PLATFORM" --arch="$ARCH" || fail

echo
echo "  [ 90%] Creating Pocketwave-portable"
rm -rf "$PORT"
mv "$ROOT/dist/Pocketwave-$PLATFORM-$ARCH" "$PORT" || fail
if [ "$PLATFORM" = darwin ]; then
  # Programs built on this Mac are not "downloaded", but Apple Silicon still requires at least an ad-hoc signature
  xattr -cr "$PORT" 2>/dev/null
  codesign --force --deep --sign - "$PORT/Pocketwave.app" >/dev/null 2>&1
else
  chmod +x "$PORT/Pocketwave"
  if command -v ldd >/dev/null 2>&1; then
    MISSING="$(ldd "$PORT/Pocketwave" 2>/dev/null | grep 'not found')"
    if [ -n "$MISSING" ]; then
      echo
      echo "  Some system libraries are missing. Install them with your package manager"
      echo "  (for example libgtk-3-0, libnss3 and libasound2 on Debian / Ubuntu):"
      echo "$MISSING" | sed 's/^/    /'
    fi
  fi
fi

echo "  [ 97%] Cleaning up"
rm -rf "$RT" "$ROOT/node_modules" "$ROOT/dist"

echo "  [100%] Done. Starting Pocketwave..."
echo
start_program "$@"
exit 0
