// Feedback sonoro del kiosco (bloque 7B.4). Tonos generados con Web Audio API
// (sin archivos .mp3) para evitar problemas de autoplay-policy en distintos
// WebViews de Capacitor — un <audio src> requeriría un asset empaquetado y
// puede quedar bloqueado hasta el primer gesto real del usuario; un
// AudioContext creado perezosamente y reusado entre llamadas es más robusto.

let ctx = null;

function getContext() {
    if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
}

function beep(freq, startOffset, duration, gainPeak = 0.15) {
    const audioCtx = getContext();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = audioCtx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
}

function playSafely(fn) {
    try { fn(); } catch { /* el audio nunca debe romper el flujo de marcaje */ }
}

export function playSuccessTone() {
    playSafely(() => {
        beep(880, 0, 0.12);
        beep(1318.5, 0.1, 0.14);
    });
}

export function playWarningTone() {
    playSafely(() => {
        beep(440, 0, 0.15);
        beep(440, 0.2, 0.15);
    });
}

export function playErrorTone() {
    playSafely(() => {
        beep(220, 0, 0.18);
        beep(196, 0.2, 0.22);
    });
}

// color → categoría de tono, mismo mapa de colores que FeedbackOverlay.jsx
// (THEME_MAP: green/red/orange/blue/pink/purple/slate).
const COLOR_TONE = {
    green:  playSuccessTone,
    blue:   playSuccessTone,
    purple: playSuccessTone,
    orange: playWarningTone,
    pink:   playWarningTone,
    red:    playErrorTone,
};

export function playFeedbackTone(color) {
    const play = COLOR_TONE[color];
    if (play) play();
}
