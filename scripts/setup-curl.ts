#!/usr/bin/env tsx
/**
 * Download curl-impersonate (lexiforest fork) prebuilt binary.
 *
 * Usage:  npm run setup        # or auto-runs via postinstall
 *         tsx scripts/setup-curl.ts
 *         tsx scripts/setup-curl.ts --force
 *         tsx scripts/setup-curl.ts --check
 *
 * Installs to bin/curl-impersonate (+ companion .dylib/.so files).
 * Supports macOS (arm64/x86_64), Linux (amd64/arm64), Windows (DLL for FFI).
 */

import { execSync } from "child_process";
import {
  existsSync, mkdirSync, chmodSync, readdirSync,
  copyFileSync, rmSync,
} from "fs";
import { resolve, join } from "path";

const REPO = "lexiforest/curl-impersonate";
const FALLBACK_VERSION = "v1.4.4";
const BIN_DIR = resolve(import.meta.dirname ?? process.cwd(), "..", "bin");

interface PlatformInfo {
  assetPattern: RegExp;
  binaryName: string;
  destName: string;
}

function getPlatformInfo(version: string): PlatformInfo {
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

async function getLatestVersion(): Promise<string> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  console.log("[setup] Checking latest release...");
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const release = (await resp.json()) as { tag_name: string };
    return release.tag_name;
  } catch {
    console.warn(`[setup] Could not fetch latest release, using fallback ${FALLBACK_VERSION}`);
    return FALLBACK_VERSION;
  }
}

async function getDownloadUrl(info: PlatformInfo, version: string): Promise<string> {
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${version}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);

  const release = (await resp.json()) as { assets: { name: string; browser_download_url: string }[] };
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

function downloadAndExtract(url: string, info: PlatformInfo): void {
  mkdirSync(BIN_DIR, { recursive: true });

  const tmpDir = resolve(BIN_DIR, ".tmp-extract");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const archive = resolve(tmpDir, "archive.tar.gz");

  console.log(`[setup] Downloading...`);
  execSync(`curl -fsSL -o "${archive}" "${url}"`, { stdio: "inherit" });

  console.log("[setup] Extracting...");
  if (process.platform === "win32") {
    const a = archive.replaceAll("\\", "/");
    const d = tmpDir.replaceAll("\\", "/");
    execSync(`tar xzf "${a}" --force-local -C "${d}"`, { stdio: "inherit" });
  } else {
    execSync(`tar xzf "${archive}" -C "${tmpDir}"`, { stdio: "inherit" });
  }

  // Find binary in extracted tree
  const binary = findFile(tmpDir, info.binaryName);
  if (!binary) {
    const files = listFiles(tmpDir);
    throw new Error(`Could not find ${info.binaryName}.\nFiles:\n  ${files.join("\n  ")}`);
  }

  const dest = resolve(BIN_DIR, info.destName);
  copyFileSync(binary, dest);

  // Copy companion shared libraries (.so/.dylib/.dll)
  const libDir = resolve(binary, "..");
  if (existsSync(libDir)) {
    const libs = readdirSync(libDir).filter(
      (f) =>
        f.endsWith(".so") || f.includes(".so.") ||
        f.endsWith(".dylib") ||
        (f.endsWith(".dll") && f !== info.destName),
    );
    for (const lib of libs) {
      copyFileSync(resolve(libDir, lib), resolve(BIN_DIR, lib));
      console.log(`[setup] Copied companion library: ${lib}`);
    }
  }

  chmodSync(dest, 0o755);
  rmSync(tmpDir, { recursive: true });
  console.log(`[setup] Installed ${info.destName} to ${dest}`);
}

function findFile(dir: string, name: string): string | null {
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

function listFiles(dir: string): string[] {
  const results: string[] = [];
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
        } catch {
          console.log("[setup] Binary exists but version check failed");
        }
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

  if (force && existsSync(dest)) {
    rmSync(dest);
  }

  const url = await getDownloadUrl(info, version);
  downloadAndExtract(url, info);

  // Verify
  if (!isWindowsDll) {
    try {
      const ver = execSync(`"${dest}" --version`, { encoding: "utf-8" }).trim().split("\n")[0];
      console.log(`[setup] Verified: ${ver}`);
    } catch {
      console.warn("[setup] Warning: could not verify binary. It may need companion libraries.");
    }
  }

  console.log("[setup] Done!");
}

main().catch((err) => {
  console.error(`[setup] Error: ${err.message}`);
  process.exit(1);
});
