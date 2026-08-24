const PREFIX = 'pedido_draft_';

export function saveDraft(key, data) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch { /* localStorage no disponible (privado/cuota) */ }
}

export function loadDraft(key) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        // Expire after 24 hours
        if (Date.now() - ts > 86_400_000) { clearDraft(key); return null; }
        return data;
    } catch { return null; }
}

/**
 * Cuándo se guardó el borrador, en milisegundos, o `null` si no hay.
 *
 * `loadDraft` se come el `ts` a propósito —quien repuebla no lo necesita— pero
 * un formulario que OFRECE recuperar en vez de reponer solo sí: lo que decide a
 * una persona no es «hay un borrador», es «hay uno de hace diez minutos». Sin la
 * hora, aceptar es una apuesta.
 *
 * Comparte la caducidad de 24 h: si ya venció, contesta `null` como `loadDraft`.
 */
export function loadDraftTime(key) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const { ts } = JSON.parse(raw);
        if (!ts || Date.now() - ts > 86_400_000) return null;
        return ts;
    } catch { return null; }
}

export function clearDraft(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* localStorage no disponible (privado/cuota) */ }
}
