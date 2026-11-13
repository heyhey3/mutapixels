#!/usr/bin/env bash
# Source this if macOS Xcode license has not been accepted and you want to use
# CommandLineTools instead. Harmless on other machines.
if [[ "$(uname -s)" == "Darwin" && -d /Library/Developer/CommandLineTools ]]; then
  export CC="${CC:-/Library/Developer/CommandLineTools/usr/bin/clang}"
  export CXX="${CXX:-/Library/Developer/CommandLineTools/usr/bin/clang++}"
  export SDKROOT="${SDKROOT:-/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk}"
  export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
  export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
fi
