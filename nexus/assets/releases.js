/*
 * NEXUS download helpers, shared by nexus/index.html and nexus/releases/.
 * The list of releases is nexus/releases/releases.json, written by the
 * "Build installers" workflow of the Nexus repository when it publishes a
 * version; the installers themselves are assets of this repository's GitHub
 * Release nexus-v<version>.
 */
(function () {
  var PLATFORMS = {
    windows: { name: 'Windows', icon: 'bi-windows' },
    macos: { name: 'macOS', icon: 'bi-apple' },
    linux: { name: 'Linux', icon: 'bi-ubuntu' }
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load(url) {
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (m) { return { latest: m && m.latest || null, releases: (m && Array.isArray(m.releases)) ? m.releases : [] }; });
  }

  /** 'windows' | 'macos' | 'linux' | null for the visitor's system. */
  function detectOS() {
    var p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '') + ' ' + navigator.userAgent;
    if (/android|iphone|ipad/i.test(p)) return null;
    if (/win/i.test(p)) return 'windows';
    if (/mac/i.test(p)) return 'macos';
    if (/linux|x11/i.test(p)) return 'linux';
    return null;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    return bytes >= 1e6 ? Math.round(bytes / 1e6) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** The release's main download for a platform: the .exe, the Apple Silicon .dmg, the AppImage. */
  function primaryAsset(release, platform) {
    var list = (release && release.assets || []).filter(function (a) { return a.platform === platform; });
    var pick = function (re) { return list.filter(function (a) { return re.test(a.name); })[0]; };
    if (platform === 'macos') return pick(/arm64/i) || list[0] || null;
    if (platform === 'linux') return pick(/\.AppImage$/i) || list[0] || null;
    return list[0] || null;
  }

  window.NexusReleases = {
    PLATFORMS: PLATFORMS,
    load: load,
    detectOS: detectOS,
    formatSize: formatSize,
    formatDate: formatDate,
    primaryAsset: primaryAsset,
    escapeHtml: escapeHtml
  };
})();
