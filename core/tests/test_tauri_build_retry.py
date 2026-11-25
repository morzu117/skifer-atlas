"""Test du lanceur de build sans Tauri ni images disque macOS."""

import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "tauri-build-retry.sh"
pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("bash") is None,
    reason="Le test utilise des commandes factices POSIX",
)


@pytest.mark.parametrize(
    ("failures", "message", "expected_attempts", "expected_status"),
    [
        (0, "", 1, 0),
        (1, "bundle_dmg.sh: Resource busy", 2, 0),
        (3, "bundle_dmg.sh: Resource busy", 3, 17),
        (3, "autre erreur", 1, 17),
    ],
)
def test_retry(tmp_path, failures, message, expected_attempts, expected_status):
    counter = tmp_path / "counter"
    calls = tmp_path / "detach"
    dmg_dir = tmp_path / "bundle" / "dmg"
    plist = tmp_path / "images.plist"
    plist.write_bytes(plistlib.dumps({"images": [
        {"image-path": str(dmg_dir / "rw.test.dmg"),
         "system-entities": [{"dev-entry": "/dev/disk2"}]},
        {"image-path": str(tmp_path / "other.dmg"),
         "system-entities": [{"dev-entry": "/dev/disk3"}]},
    ]}))
    build = tmp_path / "build"
    build.write_text("""#!/usr/bin/env bash
set -eu
count=0
[ ! -f "$COUNTER" ] || count=$(cat "$COUNTER")
count=$((count + 1))
printf '%s' "$count" > "$COUNTER"
if [ "$count" -le "$FAILURES" ]; then
  echo "$FAILURE_MESSAGE" >&2
  exit 17
fi
printf 'build ok: %s\\n' "$*"
""")
    build.chmod(0o755)
    hdiutil = tmp_path / "hdiutil"
    hdiutil.write_text("""#!/usr/bin/env bash
if [ "$1" = info ]; then
  cat "$PLIST"
else
  printf '%s\\n' "$*" >> "$CALLS"
fi
""")
    hdiutil.chmod(0o755)
    env = os.environ | {
        "RUNNER_OS": "macOS", "HDIUTIL_CMD": str(hdiutil),
        "TAURI_DMG_DIR": str(dmg_dir), "TAURI_RETRY_DELAY": "0",
        "COUNTER": str(counter), "CALLS": str(calls), "PLIST": str(plist),
        "FAILURES": str(failures), "FAILURE_MESSAGE": message,
    }
    result = subprocess.run(
        ["bash", str(SCRIPT), str(build), "argument avec espaces"],
        env=env, capture_output=True, text=True, check=False,
    )
    assert result.returncode == expected_status
    assert int(counter.read_text()) == expected_attempts
    assert result.stdout.count("::warning::") == expected_attempts - 1
    detached = calls.read_text().splitlines() if calls.exists() else []
    assert detached == ["detach -force /dev/disk2"] * (expected_attempts - 1)
    if expected_status == 0:
        assert "build ok: argument avec espaces" in result.stdout


def test_other_platform_does_not_retry(tmp_path):
    counter = tmp_path / "counter"
    command = tmp_path / "fail"
    command.write_text('#!/usr/bin/env bash\necho x >> "$COUNTER"\necho bundle_dmg.sh >&2\nexit 23\n')
    command.chmod(0o755)
    result = subprocess.run(
        ["bash", str(SCRIPT), str(command)],
        env=os.environ | {"RUNNER_OS": "Linux", "COUNTER": str(counter)},
        capture_output=True, text=True, check=False,
    )
    assert result.returncode == 23
    assert counter.read_text().splitlines() == ["x"]
    assert "::warning::" not in result.stdout
