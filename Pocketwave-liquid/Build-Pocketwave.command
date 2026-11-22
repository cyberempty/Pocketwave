#!/usr/bin/env bash
# Pocketwave launcher for macOS (double-click it): builds the portable program the first time, then just starts it.
cd "$(dirname "$0")" || exit 1
exec bash scripts/build-unix.sh "$@"
