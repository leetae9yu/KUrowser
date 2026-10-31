#!/usr/bin/env bash
# Build the macOS dmg and sign the app with one fixed identity.
#
# An ad-hoc signature changes with every build, so macOS treats each update as a new app and asks
# again for the "KUrowser Safe Storage" keychain item. A fixed certificate keeps the app's designated
# requirement (bundle id + certificate) the same across builds. The certificate is self-signed until
# the project has an Apple developer account, so Gatekeeper still asks on first open.
#
# KUROWSER_SIGN_IDENTITY             certificate name (default "KUrowser Dev")
# KUROWSER_SIGN_KEYCHAIN             keychain holding the certificate (default: search list)
# KUROWSER_SIGN_KEYCHAIN_PASS_FILE   file with that keychain's password, to unlock it over ssh
set -euo pipefail

identity="${KUROWSER_SIGN_IDENTITY:-KUrowser Dev}"
app="release/mac-arm64/KUrowser.app"
keychain=()
if [ -n "${KUROWSER_SIGN_KEYCHAIN:-}" ]; then
  if [ -n "${KUROWSER_SIGN_KEYCHAIN_PASS_FILE:-}" ]; then
    security unlock-keychain -p "$(cat "$KUROWSER_SIGN_KEYCHAIN_PASS_FILE")" "$KUROWSER_SIGN_KEYCHAIN"
  fi
  keychain=(--keychain "$KUROWSER_SIGN_KEYCHAIN")
fi

bun run build
# Pack first: electron-builder flips the fuses here and leaves an ad-hoc signature.
electron-builder --mac dir
codesign --force --deep --sign "$identity" ${keychain[@]+"${keychain[@]}"} "$app"
codesign --verify --deep --strict "$app"
codesign --display --requirements - "$app" 2>&1 | grep designated
electron-builder --mac dmg --prepackaged "$app"
