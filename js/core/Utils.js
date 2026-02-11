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
