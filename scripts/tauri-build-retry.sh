#!/usr/bin/env bash
set -euo pipefail

# Les autres plateformes gardent l'exécution directe et son code de sortie.
if [[ "${RUNNER_OS:-$(uname -s)}" != "macOS" && "${RUNNER_OS:-$(uname -s)}" != "Darwin" ]]; then
  exec "$@"
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
hdiutil_cmd="${HDIUTIL_CMD:-hdiutil}"
dmg_dir="${TAURI_DMG_DIR:-$PWD/src-tauri/target/release/bundle/dmg}"

for attempt in 1 2 3; do
  if "$@" 2>&1 | tee "$work_dir/build.log"; then
    exit 0
  else
    status=${PIPESTATUS[0]}
  fi

  if (( attempt == 3 )) || ! grep -Fq 'bundle_dmg.sh' "$work_dir/build.log"; then
    exit "$status"
  fi

  echo "::warning::Échec de bundle_dmg.sh ; nettoyage des images DMG et nouvelle tentative ($((attempt + 1))/3)."
  # Le plist associe chaque périphérique à son fichier image : ne détacher que
  # les images du dossier de bundle de ce projet, jamais les autres volumes.
  if "$hdiutil_cmd" info -plist > "$work_dir/images.plist" 2>/dev/null; then
    python3 - "$work_dir/images.plist" "$dmg_dir" > "$work_dir/devices" <<'PY'
import os
import plistlib
import sys

try:
    with open(sys.argv[1], "rb") as source:
        info = plistlib.load(source)
    directory = os.path.realpath(sys.argv[2])
    for image in info.get("images", []):
        path = image.get("image-path", "")
        if not path or os.path.dirname(os.path.realpath(path)) != directory:
            continue
        for entity in image.get("system-entities", []):
            device = entity.get("dev-entry")
            if device:
                print(device)
except (OSError, ValueError, TypeError):
    pass
PY
    while IFS= read -r device; do
      "$hdiutil_cmd" detach -force "$device" || true
    done < "$work_dir/devices"
  fi
  sleep "${TAURI_RETRY_DELAY:-3}"
done
