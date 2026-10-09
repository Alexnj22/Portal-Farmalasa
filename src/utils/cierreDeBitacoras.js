// El cierre de mes de las bitácoras, escrito UNA vez para el portal
// (`bitacoras/TabCierre`) y la app: cómo se nombra el mes, el cumplimiento y su
// tono, y el largo mínimo del motivo cuando el libro queda con renglones sin
// receta (la base exige lo mismo).
import { fechaTexto } from './fecha';

/** «2026-07» → «Julio de 2026» (sólo la primera letra en mayúscula). */
export const nombreDelPeriodo = (p) => {
    const txt = fechaTexto(`${String(p).slice(0, 7)}-01`, { month: 'long', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};

/** Cumplimiento en %, o null si no había nada esperado (un mes que no aplica no es un 100%). */
export const cumplimiento = (hechas, esperadas) => (esperadas > 0 ? Math.round((hechas / esperadas) * 100) : null);
export const rotularCumplimiento = (p) => (p === null ? '—' : `${p}%`);
/** 'success' en 100, 'warning' por debajo, nada si no aplica. */
export const tonoDelCumplimiento = (p) => (p === null ? undefined : p === 100 ? 'success' : 'warning');

/** Con renglones del libro sin receta, el motivo del cierre es obligatorio y de al menos esto. */
export const MINIMO_MOTIVO_CON_LIBRO_PENDIENTE = 15;
export const puedeFirmarElCierre = (libroPendientes, observaciones) =>
    !(libroPendientes > 0 && String(observaciones || '').trim().length < MINIMO_MOTIVO_CON_LIBRO_PENDIENTE);
