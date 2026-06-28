const PREFIX = 'pedido_draft_';

export function saveDraft(key, data) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
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

export function clearDraft(key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
}
