import { State } from './Store.js';

/* =========================================
   AUDIO - Better sounds
   ========================================= */

let audioContext = null;

export function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

export function playTypingSound() {
    if (!State.CONFIG.typing_sounds) return;
    try {
        var ctx = getAudioContext();

        // CRITICAL FIX: Resume AudioContext if suspended by Chrome autoplay policy
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        // Softer, more pleasant click sound
        // Mechanical keyboard style "thock"
        osc.frequency.value = 400 + Math.random() * 50;
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.04);
        osc.type = 'triangle';

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.04);
    } catch (e) {
        console.error('Audio error:', e);
    }
}

export function play8BitSound() {
    try {
        var ctx = getAudioContext();
        var now = ctx.currentTime;

        // 8-bit victory melody
        var notes = [523, 659, 784, 1047, 784, 1047];
        var durations = [0.1, 0.1, 0.1, 0.2, 0.1, 0.3];
        var t = now;

        notes.forEach(function (freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.frequency.value = freq;
            osc.type = 'square';

            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + durations[i] * 0.9);

            osc.start(t);
            osc.stop(t + durations[i]);

            t += durations[i];
        });
    } catch (e) { }
}

// V62: UI SOUND EFFECTS
export function playClickSound() {
    if (!State.CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);
        osc.type = 'sine';

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch (e) { }
}

export function playModalSound() {
    if (!State.CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.08);
        osc.type = 'triangle';

        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    } catch (e) { }
}

export function playNotificationSound() {
    if (!State.CONFIG.ui_sounds) return;
    try {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
        osc.type = 'sine';

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
}
export const Audio = {
    getContext: getAudioContext,
    playTypingSound: playTypingSound,
    play8BitSound: play8BitSound,
    playClickSound: playClickSound,
    playModalSound: playModalSound,
    playNotificationSound: playNotificationSound
};
