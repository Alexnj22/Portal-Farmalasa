// Qué se puede corregir en «Corregir lote o vencimiento», para el portal y la
// app (`CorregirLoteSala.jsx` y `apps/mobile/app/corregir-lote.js`).
//
// Dos modos:
//   · 'lote'  — producto con control de lote: se corrige el lote y su fecha.
//               Lo sin lote asignado se ofrece para ponerle uno.
//   · 'vence' — perecedero SIN control de lote (2026-11-27, NUT CLUB SUPER MIX):
//               no hay número, sólo la fecha. El sistema de la caja descuenta
//               siempre primero la fecha más próxima (medido ese día), así que
//               sólo esa se puede corregir; las demás se muestran con el motivo.
//               El servidor lo vuelve a revisar (`_shared/erp-corregir-vence.ts`).
//   · null    — ni lote ni vencimiento: no hay nada que corregir.
import { esLoteGenerico } from './unidadesInventario';

/** 'MM/AAAA', como en el empaque (el vencimiento se guarda como día 1). */
export function venceComoEmpaque(d) {
    const m = /^(\d{4})-(\d{2})/.exec(String(d ?? ''));
    return m && m[1] !== '0000' ? `${m[2]}/${m[1]}` : null;
}

export function modoDeCorreccion({ regulado, perecedero } = {}) {
    if (regulado) return 'lote';
    if (perecedero) return 'vence';
    return null;
}

const diaValido = (d) => {
    const s = String(d ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !s.startsWith('0000') ? s : '';
};

/**
 * Las filas que se ofrecen, cada una con `bloqueo` (texto) si no se puede
 * elegir. `lotes` es lo de `fetchLotesEnUnidades`.
 */
export function filasACorregir(lotes, modo) {
    const todas = lotes ?? [];
    if (modo === 'lote') return todas.map(l => ({ ...l, bloqueo: null }));
    if (modo !== 'vence') return todas.filter(l => !esLoteGenerico(l.lote)).map(l => ({ ...l, bloqueo: null }));
    const fechas = todas.map(l => diaValido(l.vence)).filter(Boolean).sort();
    const primera = fechas[0] ?? null;
    return todas.map(l => {
        const d = diaValido(l.vence);
        const bloqueo = d && primera && d > primera
            ? `Primero corrige la de ${venceComoEmpaque(primera)}. Se descuenta primero la fecha más próxima.`
            : null;
        return { ...l, bloqueo };
    });
}
