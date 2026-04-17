import * as path from 'path';
import * as os from 'os';
import {createHash} from 'crypto';
import {createReadStream} from 'fs';
import {pipeline} from 'stream/promises';

import * as semver from 'semver';

import * as pkg from '../package.json';

export const USER_AGENT = `${pkg.name}/${pkg.version}`;
export const _7ZR_PATH = path.join(__dirname, '..', 'vendor', '7zr.exe');

export function getTempDir() {
  return process.env['RUNNER_TEMP'] || os.tmpdir();
}

/**
 * Hashes pinned in the action source. The strong defense against a compromised
 * upstream: every install must match a (platform, arch, linkingType, version)
 * tuple here, and the resolved bytes must hash to the recorded value.
 *
 * Layout: KNOWN_HASHES[platform][arch][linkingType][version] = {algorithm, hash}
 *
 * @type {Record<string, Record<string, Record<string, Record<string, {algorithm: 'sha256', hash: string}>>>>}
 */
export const KNOWN_HASHES = {
  linux: {
    x64: {
      static: {
        '7.0.2': {
          algorithm: 'sha256',
          hash: 'abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67',
        },
      },
    },
  },
};

// Validate the registry shape at module load. Catches typos like uppercase
// hex or stray whitespace in pasted hashes before they ever reach the installer.
for (const [platform, archs] of Object.entries(KNOWN_HASHES)) {
  for (const [arch, linkings] of Object.entries(archs)) {
    for (const [linking, versions] of Object.entries(linkings)) {
      for (const [version, entry] of Object.entries(versions)) {
        const where = `KNOWN_HASHES.${platform}.${arch}.${linking}["${version}"]`;
        if (entry.algorithm !== 'sha256') {
          throw new Error(`${where}.algorithm must be "sha256"`);
        }
        if (!/^[0-9a-f]{64}$/.test(entry.hash)) {
          throw new Error(`${where}.hash must be 64 lowercase hex chars (got "${entry.hash}")`);
        }
      }
    }
  }
}

/**
 * Looks up a pinned hash for the given install target, or throws a clear
 * error if no hash is pinned.
 *
 * @param platform {string}
 * @param arch {string}
 * @param linkingType {string}
 * @param version {string}
 * @returns {{algorithm: 'sha256', hash: string}}
 */
export function requirePinnedHash(platform, arch, linkingType, version) {
  const pinned = KNOWN_HASHES[platform]?.[arch]?.[linkingType]?.[version];
  if (!pinned) {
    const aliasNote =
      version.startsWith('0.0.0-') || /^(release|git)$/i.test(version)
        ? ` Note: the "release" and "git" aliases resolve to moving versions and cannot be pinned — request a specific version like "7.0.2" instead.`
        : '';
    const darwinNote =
      platform === 'darwin'
        ? ` macOS requires extending the registry to hold separate hashes for evermeet.cx's ffmpeg and ffprobe archives — not yet implemented. Pin to FedericoCarboni/setup-ffmpeg@v3 if you need darwin today.`
        : '';
    throw new Error(
      `Refusing to install ffmpeg: no pinned hash in this action's registry for ` +
        `platform=${platform} arch=${arch} linking=${linkingType} version=${version}. ` +
        `This action only installs versions whose bytes have been vouched for in ` +
        `KNOWN_HASHES (src/util.js). To add this version, download the upstream ` +
        `artifact, compute its SHA-256, add it to KNOWN_HASHES, and tag a new ` +
        `release of the action.` +
        aliasNote +
        darwinNote,
    );
  }
  return pinned;
}

/**
 * Builds the cache key used by `@actions/tool-cache`'s find/cacheDir. Folding
 * the pinned hash into the key means a different upstream binary (or a
 * pre-poisoned tool cache on a self-hosted runner) misses the cache and is
 * forced through verification, instead of being silently re-used.
 *
 * @param version {string}
 * @param pinned {{algorithm: 'sha256', hash: string}}
 */
export function pinnedCacheKey(version, pinned) {
  return `${version}-${pinned.algorithm}-${pinned.hash.slice(0, 16)}`;
}

/**
 * Streams a file through a hash algorithm and throws if the digest does not
 * match the expected value.
 *
 * @param archivePath {string}
 * @param expectedHash {string} lowercase hex digest
 * @param algorithm {'sha256'}
 */
export async function verifyChecksum(archivePath, expectedHash, algorithm) {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(archivePath), hash);
  const actual = hash.digest('hex');
  if (actual !== expectedHash) {
    throw new Error(
      `${algorithm} checksum mismatch for ${archivePath}: expected ${expectedHash}, got ${actual}`,
    );
  }
}

/**
 * Normalizes a version string loosely in the format `X.X.X-abc` (version may
 * not contain all of these parts) to a valid semver version.
 *
 * @param version {string}
 * @param isGitRelease {boolean}
 * @returns {string | null}
 */
export function normalizeVersion(version, isGitRelease) {
  // Git builds have no version because they are not the same branch as releases
  // they mostly use git commits, build dates or numbers instead of a semver
  // version.
  if (isGitRelease) return semver.valid('0.0.0-' + version);
  const valid = semver.valid(version);
  if (valid) return valid;
  // Fix versions like x.y which are not valid with semver.
  const [ver, ...extra] = version.split('-');
  let [major, minor, ...patch] = ver.split('.');
  if (!minor) minor = '0';
  if (patch.length === 0) patch = ['0'];
  const normalized =
    [major, minor, ...patch].join('.') + (extra.length !== 0 ? '-' + extra.join('-') : '');
  return semver.valid(normalized);
}

/**
 * Clean up a version to use to match requested versions on johnvansickle.com and
 * evermeet.cx.
 *
 * @param version {string}
 * @returns {string}
 */
export function cleanVersion(version) {
  const clean = semver.clean(version);
  return (clean && clean.replace(/\.0+$/, '')) || version;
}
