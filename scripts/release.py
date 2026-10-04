#!/usr/bin/env python3
"""Release helper: bump version -> sign with AMO (unlisted) -> generate a
signed JSON update manifest (updates.json) -> deploy artifacts.

Required env (usually provided by config.mk via the Makefile):
  UPDATE_URL           https URL of the hosted updates.json
  DOWNLOAD_BASE_URL    https base URL where signed xpi files are hosted
Optional:
  DEPLOY_DIR           where to copy release artifacts
                       (default /root/dufs/youtube-audio-only)
  WEB_EXT_API_KEY      AMO JWT issuer
  WEB_EXT_API_SECRET   AMO JWT secret

Usage:
  python3 scripts/release.py --bump patch
  python3 scripts/release.py --version 1.3
  python3 scripts/release.py --bump patch --dry-run   # skip signing

If a release is aborted (e.g. signing fails), the source manifest is already
at the bumped version, so re-running `make release` advances to the next
version rather than retrying the same one against AMO.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "youtube-audio-only"
STAGE = ROOT / "build" / "youtube-audio-only"
DIST = ROOT / "dist"
RELEASE = ROOT / "release"
ARTIFACTS = ROOT / "web-ext-artifacts"


def fail(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(1)


def bump_version(version, kind):
    p = [int(n) if n else 0 for n in str(version).split(".")]
    while len(p) < 3:
        p.append(0)
    if kind == "major":
        p[0] += 1
        p[1] = p[2] = 0
    elif kind == "minor":
        p[1] += 1
        p[2] = 0
    else:
        p[2] += 1
    return ".".join(map(str, p[:3]))


def version_key(version):
    parts = [int(n) for n in str(version).split(".") if n.isdigit()]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def highest_version(manifest):
    """Highest version seen in the source or a staged build.

    A `make release` that was aborted before it could update the source manifest
    (e.g. the pre-fix behaviour, or an interrupted sign) leaves a staged build
    at the bumped version. Folding it in makes the next run advance past the
    interrupted version instead of trying to sign/upload the same one again.
    """
    versions = [manifest.get("version")]

    staged_manifest = STAGE / "manifest.json"
    if staged_manifest.exists():
        try:
            versions.append(json.loads(staged_manifest.read_text()).get("version"))
        except (ValueError, OSError):
            pass

    versions = [v for v in versions if v]
    return max(versions, key=version_key) if versions else "0.0.0"


def copy_dir(src, dest):
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for entry in src.iterdir():
        if entry.name.startswith("."):  # skip web-ext/.amo-upload-uuid etc.
            continue
        if entry.is_dir():
            copy_dir(entry, dest / entry.name)
        else:
            shutil.copy2(entry, dest / entry.name)


def sha256(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def latest_xpi(d):
    xpis = [p for p in d.iterdir() if p.suffix == ".xpi"]
    return max(xpis, key=lambda p: p.stat().st_mtime) if xpis else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bump", default="patch", choices=["major", "minor", "patch"])
    ap.add_argument("--version")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # ---- config -----------------------------------------------------------
    update_url = os.environ.get("UPDATE_URL")
    download_base = os.environ.get("DOWNLOAD_BASE_URL")
    if not update_url:
        fail("UPDATE_URL is not set (see config.example.mk)")
    if not download_base:
        fail("DOWNLOAD_BASE_URL is not set (see config.example.mk)")
    deploy_dir = Path(os.environ.get("DEPLOY_DIR", "/root/dufs/youtube-audio-only"))

    # ---- work out the new version ----------------------------------------
    src_manifest_path = SRC / "manifest.json"
    src_manifest = json.loads(src_manifest_path.read_text())
    addon_id = src_manifest["browser_specific_settings"]["gecko"]["id"]
    base_version = highest_version(src_manifest)
    version = args.version or bump_version(base_version, args.bump)
    xpi_name = f"youtube-audio-only-{version}.xpi"

    print(f"releasing {addon_id}")
    print(f"  version : {base_version} -> {version}")

    # ---- stage a patched copy (inject update_url) ------------------------
    # --dry-run stages in a temp dir so a smoke test can never leave an
    # in-flight build that the next real release mistakes for an aborted one.
    if args.dry_run:
        stage_dir = Path(tempfile.mkdtemp(prefix="release-dry-"))
    else:
        stage_dir = STAGE
    copy_dir(SRC, stage_dir)
    staged_manifest = json.loads((stage_dir / "manifest.json").read_text())
    staged_manifest["version"] = version
    staged_manifest["browser_specific_settings"]["gecko"]["update_url"] = update_url
    (stage_dir / "manifest.json").write_text(json.dumps(staged_manifest, indent=2) + "\n")

    # ---- package ----------------------------------------------------------
    DIST.mkdir(parents=True, exist_ok=True)
    zip_path = DIST / f"youtube-audio-only-{version}.zip"
    zip_path.unlink(missing_ok=True)
    subprocess.run(["zip", "-r", "-X", str(zip_path), "."], cwd=stage_dir, check=True)
    print(f"  packaged: {zip_path.relative_to(ROOT)}")

    # ---- persist the bump before the risky signing step -------------------
    # If signing is aborted, the source manifest already points at this
    # version, so the next `make release` bumps to the following version
    # instead of trying to sign/upload the same one again.
    if not args.dry_run:
        src_manifest["version"] = version
        src_manifest_path.write_text(json.dumps(src_manifest, indent=2) + "\n")

    # ---- sign -------------------------------------------------------------
    if args.dry_run:
        print("  [dry-run] skipping web-ext sign")
        artifact = zip_path
        shutil.rmtree(stage_dir, ignore_errors=True)
    else:
        if ARTIFACTS.exists():
            shutil.rmtree(ARTIFACTS)
        ARTIFACTS.mkdir(parents=True)
        subprocess.run(
            [
                "npx", "--yes", "web-ext@latest", "sign",
                "--source-dir", str(stage_dir),
                "--channel", "unlisted",
                "--artifacts-dir", str(ARTIFACTS),
                "--no-input",
            ],
            check=True,
        )
        artifact = latest_xpi(ARTIFACTS)
        if not artifact:
            fail("no signed .xpi found in " + str(ARTIFACTS))

    # ---- publish artifacts + update manifest -----------------------------
    RELEASE.mkdir(parents=True, exist_ok=True)
    xpi_dest = RELEASE / xpi_name
    shutil.copyfile(artifact, xpi_dest)
    digest = sha256(xpi_dest)

    updates = {
        "addons": {
            addon_id: {
                "updates": [
                    {
                        "version": version,
                        "update_link": download_base.rstrip("/") + "/" + xpi_name,
                        "update_hash": "sha256:" + digest,
                    }
                ]
            }
        }
    }
    updates_path = RELEASE / "updates.json"
    updates_path.write_text(json.dumps(updates, indent=2) + "\n")

    # ---- deploy -----------------------------------------------------------
    deploy_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(xpi_dest, deploy_dir / xpi_name)
    shutil.copyfile(updates_path, deploy_dir / "updates.json")

    print("\nrelease complete")
    print(f"  signed xpi      : {xpi_dest.relative_to(ROOT)}")
    print(f"  update manifest : {updates_path.relative_to(ROOT)}")
    print(f"  update_url      : {update_url}")
    print(f"  update_link     : {download_base.rstrip('/')}/{xpi_name}")
    print(f"  sha256          : {digest}")
    print(f"  deployed to     : {deploy_dir}")


if __name__ == "__main__":
    main()
