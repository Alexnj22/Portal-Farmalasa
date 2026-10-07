// Las cuentas del Inicio de la distribuidora (el tablero de `dist_tablero`),
// escritas UNA vez para el portal y para la app: la variación contra el período
// anterior, los días y las horas completos de las gráficas, y el reparto por
// forma de pago. Vivían dentro de `TabTablero.jsx` y `GraficasTablero.jsx`.
import { FORMA_PAGO } from './distribucionComun';

const num = (v) => Number(v) || 0;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS_SEMANA = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Variación (%) contra el período anterior, o null si antes no hubo nada con qué comparar. */
export const variacionPct = (actual, antes) => (num(antes) > 0 ? ((num(actual) - num(antes)) / num(antes)) * 100 : null);

/** «2026-09-25» → «25 sep», sin pasar por `new Date` en UTC (retrocede un día). */
export const diaCorto = (iso) => {
    const [, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
};

/** La serie diaria con sus números ya numéricos y su rótulo («25 sep»). */
export const serieDiaria = (serie) => (serie ?? []).map(d => ({
    ...d, etiqueta: diaCorto(d.fecha), ventas: num(d.ventas), anterior: num(d.anterior), documentos: num(d.documentos),
}));

/** Lunes a domingo; los días sin ventas van en cero. `mejor` marca el día que más se vende. */
export function semanaCompleta(datos) {
    const por = new Map((datos ?? []).map(d => [Number(d.dia), d]));
    const filas = [1, 2, 3, 4, 5, 6, 7].map(n => ({ dia: n, etiqueta: DIAS_SEMANA[n], ventas: num(por.get(n)?.ventas), documentos: num(por.get(n)?.documentos) }));
    const max = Math.max(...filas.map(f => f.ventas));
    return filas.map(f => ({ ...f, mejor: max > 0 && f.ventas === max }));
}

/** Documentos por hora, de 6 a 20 («6a» … «8p»); las horas sin ventas van en cero. */
export function horasDelDia(datos) {
    const por = new Map((datos ?? []).map(d => [Number(d.hora), d]));
    const filas = [];
    for (let h = 6; h <= 20; h += 1) {
        filas.push({ hora: h, etiqueta: `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}`, documentos: num(por.get(h)?.documentos), ventas: num(por.get(h)?.ventas) });
    }
    return filas;
}

/** El nombre de una forma de pago del tablero (`13` es a crédito). */
export const rotuloFormaDelTablero = (forma) => (forma === '13' ? 'A crédito' : (FORMA_PAGO.find(x => x.value === forma)?.label ?? forma));

/** Las formas de pago con su proporción (0–1) y su porcentaje redondeado. */
export function repartoDeFormas(formas) {
    const total = (formas ?? []).reduce((s, f) => s + num(f.monto), 0) || 1;
    return (formas ?? []).map(f => ({
        forma: f.forma, rotulo: rotuloFormaDelTablero(f.forma), monto: num(f.monto),
        proporcion: num(f.monto) / total, pct: Math.round((num(f.monto) / total) * 100),
    }));
}

/** El máximo de una lista por una clave (mínimo 1, para dividir sin miedo). */
export const maximoDe = (lista, clave = 'ventas') => Math.max(1, ...(lista ?? []).map(x => num(x[clave])));
