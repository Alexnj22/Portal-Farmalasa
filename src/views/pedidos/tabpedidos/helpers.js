// Extracted from TabPedidos.jsx (Bloque 6.C) — shared by the main tab and
// its extracted sub-components, kept here so neither side duplicates it.

export function fmtMin(min) {
    if (min == null || isNaN(min) || min < 0) return null;
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    const from = new Date(isoFrom);
    const to   = isoTo ? new Date(isoTo) : new Date();
    if (isNaN(from) || isNaN(to)) return null;
    return Math.floor((to - from) / 60_000);
}

export function fmtEntrega(iso) {
    if (!iso) return null;
    const d   = new Date(iso);
    const hoy = new Date();
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);
    const time = d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === man.toDateString()) return `Mañana ${time}`;
    return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
}

export function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min == null) return '—';
    if (min < 1)  return 'ahora';
    if (min < 60) return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}

export function getBranchStage(row, pedidoStatus) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                             return 'erp';
    if (row.llegada_fisica_at)                           return 'contando';
    if (row.finalizado_at && pedidoStatus === 'enviado') return 'transito';
    if (row.finalizado_at)                               return 'preparado';
    // Usar pauses (historial) como fuente primaria — más confiable que los campos de PSS
    const hasActivePause = (row.pauses ?? []).some(p => !p.reanudado_at);
    if (hasActivePause || (row.pausado_at && !row.reanudado_at)) return 'pausado';
    if (row.iniciado_at)                                 return 'preparando';
    return 'sin_iniciar';
}

// solicitado = need in presentation units before dispatch rounding
export function calcSolicitado(row) {
    if (row.max_qty_snapshot == null || row.stock_packs_snapshot == null) return null;
    return Math.max(0, Math.ceil(row.max_qty_snapshot - row.stock_packs_snapshot));
}

export function currentMonthRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const fini = `${y}-${pad(m + 1)}-01`;
    const last = new Date(y, m + 1, 0);
    const ffin = `${y}-${pad(m + 1)}-${pad(last.getDate())}`;
    return `${fini}|${ffin}`;
}
