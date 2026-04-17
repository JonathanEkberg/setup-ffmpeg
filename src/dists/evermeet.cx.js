import * as assert from 'assert';

import {fetch} from 'undici';

import {USER_AGENT, cleanVersion} from '../util';

export class EvermeetCxInstaller {
  /**
   * @param options {import('./installer').InstallerOptions}
   */
  constructor({version, arch, toolCacheDir, linkingType}) {
    assert.strictEqual(arch, 'x64', 'Unsupported architecture (only x64 is supported)');
    assert.strictEqual(linkingType, 'static', 'Only static linking is supported');
    this.version = version;
    this.toolCacheDir = toolCacheDir;
  }
  /**
   * @param url {string}
   * @private
   */
  async getVersionAndUrls(url) {
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const data = /** @type {*} */ (await res.json());
    return {
      version: data.version,
      downloadUrl: data.download.zip.url,
    };
  }
  /**
   * @param version {string}
   * @param isGitRelease {boolean}
   * @returns {Promise<import('./installer').ReleaseInfo>}
   * @private
   */
  async getRelease(version, isGitRelease) {
    const ffmpeg = await this.getVersionAndUrls(
      'https://evermeet.cx/ffmpeg/info/ffmpeg/' + version,
    );
    assert.ok(ffmpeg, 'Requested version not found');
    const ffprobe = await this.getVersionAndUrls(
      'https://evermeet.cx/ffmpeg/info/ffprobe/' + version,
    );
    assert.ok(ffprobe, 'Requested version not found');
    assert.strictEqual(ffmpeg.version, ffprobe.version);
    return {
      version: ffmpeg.version,
      isGitRelease,
      downloadUrl: [ffmpeg.downloadUrl, ffprobe.downloadUrl],
    };
  }
  /**
   * @returns {Promise<import('./installer').ReleaseInfo>}
   */
  async getLatestRelease() {
    const isGitRelease = this.version.toLowerCase() === 'git';
    const releaseType = isGitRelease ? 'snapshot' : 'release';
    const release = await this.getRelease(releaseType, isGitRelease);
    return {...release, isGitRelease};
  }
  /**
   * @returns {Promise<import('./installer').ReleaseInfo[]>}
   */
  async getAvailableReleases() {
    const releases = [await this.getLatestRelease()];
    if (this.version.toLowerCase() !== 'git' && this.version.toLowerCase() !== 'release') {
      const release = await this.getRelease(cleanVersion(this.version), false);
      if (release && releases[0].version !== release.version) {
        releases.push(release);
      }
    }
    return releases;
  }
  /**
   * Backstop: in normal flow `requirePinnedHash` in installer.js refuses any
   * darwin install before this method is reached. This throw fires only if
   * someone adds a darwin entry to KNOWN_HASHES without also extending the
   * registry shape and this method to handle evermeet's two archives
   * (ffmpeg + ffprobe ship as separate downloads, each needing its own hash).
   *
   * @param {import('./installer').ReleaseInfo} release
   * @returns {Promise<import('./installer').InstalledTool>}
   */
  async downloadTool(release) {
    throw new Error(
      `macOS install of ffmpeg ${release.version} reached the evermeet ` +
        `installer, but its dual-archive (ffmpeg + ffprobe) verification path ` +
        `is not implemented. Extend KNOWN_HASHES in src/util.js to hold separate ` +
        `hashes per archive and update EvermeetCxInstaller.downloadTool, or pin ` +
        `to FedericoCarboni/setup-ffmpeg@v3 if you need darwin today.`,
    );
  }
}
