// Quitar el fondo FUERA de la página (2026-10-30).
//
// `@imgly/background-removal` arma código con `new Function` (ndarray) y baja
// su motor como `blob:`. Dejarlo correr en la página exigía `unsafe-eval` en la
// CSP de TODO el portal. En un worker, la CSP que manda es la de ESTE archivo
// —`vercel.json` le pone una propia, más abierta— y la del portal queda
// estricta. Medido en Chromium y WebKit con las dos CSP de producción: anda;
// en la página, falla en los dos.
import { preload, removeBackground } from '@imgly/background-removal';

const CONFIG = { model: 'small', device: 'cpu', output: { format: 'image/png', quality: 1 } };

self.onmessage = async ({ data }) => {
    const { id, tipo, blob } = data;
    try {
        if (tipo === 'precargar') { await preload(CONFIG); self.postMessage({ id, ok: true }); return; }
        const out = await removeBackground(blob, CONFIG);
        self.postMessage({ id, ok: true, blob: out });
    } catch (err) {
        self.postMessage({ id, ok: false, error: String(err?.message || err).slice(0, 300) });
    }
};
