#!/usr/bin/env node
/**
 * Download curl-impersonate (lexiforest fork) prebuilt binary.
 *
 * Usage:  npm run setup       (or auto-runs via postinstall)
 *         node scripts/setup-curl.mjs --force
 *         node scripts/setup-curl.mjs --check
 */

import { execSync } from "node:child_process";
import {
  existsSync, mkdirSync, chmodSync, readdirSync,
  copyFileSync, rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = "lexiforest/curl-impersonate";
const FALLBACK_VERSION = "v1.4.4";
const BIN_DIR = resolve(__dirname, "..", "bin");

function getPlatformInfo(version) {
  const plat = process.platform;
  const arch = process.arch;
  const ver = version.replaceAll(".", "\\.");

  if (plat === "linux") {
    const archStr = arch === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
    return {
      assetPattern: new RegExp(`^curl-impersonate-${ver}\\.${archStr}\\.tar\\.gz$`),
      binaryName: "curl-impersonate",
      destName: "curl-impersonate",
    };
  }

  if (plat === "darwin") {
    const archStr = arch === "arm64" ? "arm64-macos" : "x86_64-macos";
    return {
      assetPattern: new RegExp(`^curl-impersonate-${ver}\\.${archStr}\\.tar\\.gz$`),
      binaryName: "curl-impersonate",
      destName: "curl-impersonate",
    };
  }

  if (plat === "win32") {
    return {
      assetPattern: /libcurl-impersonate-.*\.x86_64-win32\.tar\.gz/,
      binaryName: "libcurl.dll",
      destName: "libcurl.dll",
    };
  }

  throw new Error(`Unsupported platform: ${plat}-${arch}`);
}

async function getLatestVersion() {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  console.log("[setup] Checking latest release...");
  try {
    const resp = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const release = await resp.json();
    return release.tag_name;
  } catch {
    console.warn(`[setup] Could not fetch latest release, using fallback ${FALLBACK_VERSION}`);
    return FALLBACK_VERSION;
  }
}

async function getDownloadUrl(info, version) {
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${version}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);

  const release = await resp.json();
  const asset = release.assets.find((a) => info.assetPattern.test(a.name));

  if (!asset) {
    const names = release.assets
      .filter((a) => a.name.startsWith("curl-impersonate-") || a.name.startsWith("libcurl-impersonate-"))
      .map((a) => a.name)
      .join("\n  ");
    throw new Error(`No matching asset for ${info.assetPattern}.\nAvailable:\n  ${names}`);
  }

  console.log(`[setup] Found asset: ${asset.name}`);
  return asset.browser_download_url;
}

function downloadAndExtract(url, info) {
  mkdirSync(BIN_DIR, { recursive: true });

  const tmpDir = resolve(BIN_DIR, ".tmp-extract");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const archive = resolve(tmpDir, "archive.tar.gz");

  console.log("[setup] Downloading...");
  execSync(`curl -fsSL -o "${archive}" "${url}"`, { stdio: "inherit" });

  console.log("[setup] Extracting...");
  if (process.platform === "win32") {
    execSync(`tar xzf "${archive.replaceAll("\\", "/")}" --force-local -C "${tmpDir.replaceAll("\\", "/")}"`, { stdio: "inherit" });
  } else {
    execSync(`tar xzf "${archive}" -C "${tmpDir}"`, { stdio: "inherit" });
  }

  const binary = findFile(tmpDir, info.binaryName);
  if (!binary) {
    const files = listFiles(tmpDir);
    throw new Error(`Could not find ${info.binaryName}.\nFiles:\n  ${files.join("\n  ")}`);
  }

  const dest = resolve(BIN_DIR, info.destName);
  copyFileSync(binary, dest);

  // Copy companion shared libraries
  const libDir = resolve(binary, "..");
  if (existsSync(libDir)) {
    for (const f of readdirSync(libDir)) {
      if (f.endsWith(".so") || f.includes(".so.") || f.endsWith(".dylib") || (f.endsWith(".dll") && f !== info.destName)) {
        copyFileSync(resolve(libDir, f), resolve(BIN_DIR, f));
        console.log(`[setup] Copied companion library: ${f}`);
      }
    }
  }

  chmodSync(dest, 0o755);
  rmSync(tmpDir, { recursive: true });
  console.log(`[setup] Installed ${info.destName} to ${dest}`);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function listFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else results.push(full);
  }
  return results;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const force = process.argv.includes("--force");

  const version = await getLatestVersion();
  console.log(`[setup] curl-impersonate ${version} (${process.platform}-${process.arch})`);

  const info = getPlatformInfo(version);
  const isWindowsDll = process.platform === "win32";
  const dest = resolve(BIN_DIR, info.destName);

  if (checkOnly) {
    if (existsSync(dest)) {
      if (!isWindowsDll) {
        try {
          const ver = execSync(`"${dest}" --version`, { encoding: "utf-8" }).trim().split("\n")[0];
          console.log(`[setup] Current: ${ver}`);
        } catch { console.log("[setup] Binary exists but version check failed"); }
      }
      console.log(`[setup] Latest: ${version}`);
    } else {
      console.log(`[setup] Not installed. Latest: ${version}`);
    }
    return;
  }

  if (existsSync(dest) && !force) {
    console.log(`[setup] ${dest} already exists. Use --force to re-download.`);
    return;
  }

  if (force && existsSync(dest)) rmSync(dest);

  const url = await getDownloadUrl(info, version);
  downloadAndExtract(url, info);

  if (!isWindowsDll) {
    try {
      const ver = execSync(`"${dest}" --version`, { encoding: "utf-8" }).trim().split("\n")[0];
      console.log(`[setup] Verified: ${ver}`);
    } catch { console.warn("[setup] Warning: could not verify binary."); }
  }

  console.log("[setup] Done!");
}

main().catch((err) => {
  console.error(`[setup] Error: ${err.message}`);
  process.exit(1);
});
