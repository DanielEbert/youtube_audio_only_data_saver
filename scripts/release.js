#!/usr/bin/env node
"use strict";

// Release helper: bump version -> sign with AMO (unlisted) -> generate a
// signed JSON update manifest (updates.json) -> deploy artifacts.
//
// Required env (usually provided by config.mk via the Makefile):
//   UPDATE_URL           https URL of the hosted updates.json
//   DOWNLOAD_BASE_URL    https base URL where signed xpi files are hosted
// Optional:
//   DEPLOY_DIR           where to copy release artifacts (default /root/dufs/youtube-audio-only)
//   WEB_EXT_API_KEY      AMO JWT issuer
//   WEB_EXT_API_SECRET   AMO JWT secret
//
// Usage:
//   node scripts/release.js --bump patch
//   node scripts/release.js --version 1.3
//   node scripts/release.js --bump patch --dry-run   # skip signing (tooling test)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "youtube-audio-only");
const STAGE = path.join(ROOT, "build", "youtube-audio-only");
const DIST = path.join(ROOT, "dist");
const RELEASE = path.join(ROOT, "release");
const ARTIFACTS = path.join(ROOT, "web-ext-artifacts");

function fail(msg) {
  console.error("error: " + msg);
  process.exit(1);
}

function bumpVersion(version, kind) {
  const p = String(version)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  if (kind === "major") {
    p[0] += 1;
    p[1] = 0;
    p[2] = 0;
  } else if (kind === "minor") {
    p[1] += 1;
    p[2] = 0;
  } else {
    p[2] += 1;
  }
  return p.slice(0, 3).join(".");
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip web-ext/.amo-upload-uuid etc.
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function latestXpi(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".xpi"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(dir, files[0].f) : null;
}

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
let bump = "patch";
let versionArg = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bump") bump = args[++i];
  else if (args[i] === "--version") versionArg = args[++i];
  else if (args[i] === "--dry-run") dryRun = true;
  else fail("unknown argument: " + args[i]);
}

// ---- config ---------------------------------------------------------------
const updateUrl = process.env.UPDATE_URL;
const downloadBase = process.env.DOWNLOAD_BASE_URL;
if (!updateUrl) fail("UPDATE_URL is not set (see config.example.mk)");
if (!downloadBase) fail("DOWNLOAD_BASE_URL is not set (see config.example.mk)");
const deployDir = process.env.DEPLOY_DIR || "/root/dufs/youtube-audio-only";

// ---- work out the new version --------------------------------------------
const srcManifestPath = path.join(SRC, "manifest.json");
const srcManifest = JSON.parse(fs.readFileSync(srcManifestPath, "utf8"));
const addonId = srcManifest.browser_specific_settings.gecko.id;
const version = versionArg || bumpVersion(srcManifest.version, bump);
const xpiName = `youtube-audio-only-${version}.xpi`;

console.log(`releasing ${addonId}`);
console.log(`  version : ${srcManifest.version} -> ${version}`);

// ---- stage a patched copy (inject update_url) ----------------------------
copyDir(SRC, STAGE);
const stagedManifest = JSON.parse(fs.readFileSync(path.join(STAGE, "manifest.json"), "utf8"));
stagedManifest.version = version;
stagedManifest.browser_specific_settings.gecko.update_url = updateUrl;
fs.writeFileSync(
  path.join(STAGE, "manifest.json"),
  JSON.stringify(stagedManifest, null, 2) + "\n"
);

// ---- package --------------------------------------------------------------
fs.mkdirSync(DIST, { recursive: true });
const zipPath = path.join(DIST, `youtube-audio-only-${version}.zip`);
fs.rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", zipPath, "."], { cwd: STAGE, stdio: "inherit" });
console.log(`  packaged: ${path.relative(ROOT, zipPath)}`);

// ---- sign -----------------------------------------------------------------
let artifact;
if (dryRun) {
  console.log("  [dry-run] skipping web-ext sign");
  artifact = zipPath;
} else {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  execFileSync(
    "npx",
    [
      "--yes",
      "web-ext@latest",
      "sign",
      "--source-dir",
      STAGE,
      "--channel",
      "unlisted",
      "--artifacts-dir",
      ARTIFACTS,
      "--no-input"
    ],
    { stdio: "inherit" }
  );
  artifact = latestXpi(ARTIFACTS);
  if (!artifact) fail("no signed .xpi found in " + ARTIFACTS);
}

// ---- publish artifacts + update manifest ---------------------------------
fs.mkdirSync(RELEASE, { recursive: true });
const xpiDest = path.join(RELEASE, xpiName);
fs.copyFileSync(artifact, xpiDest);
const hash = sha256(xpiDest);

const updates = {
  addons: {
    [addonId]: {
      updates: [
        {
          version,
          update_link: downloadBase.replace(/\/$/, "") + "/" + xpiName,
          update_hash: "sha256:" + hash
        }
      ]
    }
  }
};
const updatesPath = path.join(RELEASE, "updates.json");
fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + "\n");

// ---- deploy ---------------------------------------------------------------
fs.mkdirSync(deployDir, { recursive: true });
fs.copyFileSync(xpiDest, path.join(deployDir, xpiName));
fs.copyFileSync(updatesPath, path.join(deployDir, "updates.json"));

// ---- commit version back to the source manifest --------------------------
if (!dryRun) {
  srcManifest.version = version;
  fs.writeFileSync(srcManifestPath, JSON.stringify(srcManifest, null, 2) + "\n");
}

console.log("\nrelease complete");
console.log(`  signed xpi      : ${path.relative(ROOT, xpiDest)}`);
console.log(`  update manifest : ${path.relative(ROOT, updatesPath)}`);
console.log(`  update_url      : ${updateUrl}`);
console.log(`  update_link     : ${downloadBase.replace(/\/$/, "")}/${xpiName}`);
console.log(`  sha256          : ${hash}`);
console.log(`  deployed to     : ${deployDir}`);
