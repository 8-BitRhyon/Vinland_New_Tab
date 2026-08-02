/* =========================================
   UTILITIES
   ========================================= */

let audioContext = null;

export function safeText(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Full HTML-entity escape (including quotes) for interpolating RAW strings
// into HTML text or attribute positions. Escaping quotes closes the
// attribute-injection XSS vector (e.g. href="..." onmouseover="...").
export function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Quote-only escape for strings that were ALREADY & < >-escaped upstream
// (avoids double-escaping entities). Use before interpolating into an
// attribute value, e.g. data-note-title="...".
export function escapeAttr(str) {
    return String(str == null ? '' : str)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Scheme whitelist for user-authored markdown link URLs. Returns the URL
// when safe, otherwise null. Rejects javascript:, data:, vbscript:, file:
// and any other non-http(s)/mailto scheme. Scheme-less relative/anchor
// targets (/, #, ./, ../) are allowed — they carry no scheme, so they
// cannot execute scripts, and they keep PKM internal links working.
export function sanitizeLinkUrl(url) {
    if (!url) return null;
    url = String(url).trim();
    if (/^(https?:|mailto:)/i.test(url)) return url;
    if (/^(\/|#|\.{1,2}\/)/.test(url)) return url;
    return null;
}

export function validateURL(url) {
    if (!url) return null;
    url = url.trim();
    if (url.startsWith('sys:')) return url;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome://')) return url;
    return 'https://' + url;
}

export function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}
