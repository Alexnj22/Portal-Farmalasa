// La configuración de las bitácoras de una sala, escrita UNA vez para el
// portal (`bitacoras/TabConfiguracion`, `EditorDeHorarios`, `PuntosDeLimpieza`)
// y la app: las horas que se ofrecen, el horario común de la sucursal, la
// vigencia propuesta de una calibración, qué áreas se pueden agregar y cuántos
// puntos de limpieza tiene un área.
import { PLANTILLA_AREA, PUNTOS_POR_AREA, TIPO_AREA, TIPOS_DE_PUNTO, contarPuntos } from '../data/bitacoras';

/** «07:30:00» → «07:30». */
export const hhmm = (t) => String(t || '').slice(0, 5);

/**
 * Las medias horas entre que la sucursal abre y cierra: una lectura a una hora
 * en que el local está cerrado nadie la puede tomar. Sin horario cargado, el
 * rango de siempre (5:00 a 22:30).
 */
export function mediasHoras(abre = '05:00', cierra = '22:30') {
    const aMin = (t) => {
        const [h, m] = String(t).split(':').map(Number);
        return (Number.isNaN(h) ? 5 : h) * 60 + (Number.isNaN(m) ? 0 : m);
    };
    const ini = Math.floor(aMin(abre) / 30) * 30;
    const fin = Math.ceil(aMin(cierra) / 30) * 30;
    const salida = [];
    for (let m = ini; m <= Math.min(fin, 23 * 60 + 30); m += 30) {
        salida.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    return salida;
}

/** Las horas que se ofrecen para una franja: las de la sala, más la que ya tenga si cae fuera. */
export const horasParaElegir = (valor, horas) => {
    const v = hhmm(valor);
    return horas.includes(v) || !v ? horas : [...horas, v].sort();
};

/**
 * Un año después de una fecha, sin que el huso la mueva: la vigencia habitual
 * de un certificado de calibración. Se PROPONE y se puede corregir.
 */
export const unAnoDespues = (fecha) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
};

/** El horario común de la sucursal: las franjas (o limpiezas) de todas sus áreas, una vez cada una. */
export function horariosUnidos(areas, campo) {
    const mapa = new Map();
    for (const a of areas || []) {
        for (const f of a[campo] || []) if (!mapa.has(f.clave)) mapa.set(f.clave, { ...f });
    }
    return [...mapa.values()];
}

/** Cambiar una fila del horario (por posición). */
export const conHorarioCambiado = (lista, i, parche) => (lista || []).map((f, j) => (j === i ? { ...f, ...parche } : f));

/** Las áreas que todavía se pueden agregar (el refrigerador tiene su propio interruptor). */
export function areasAgregables(areas) {
    const usados = new Set((areas || []).map(a => `${a.tipo}|${a.nombre}`));
    return Object.entries(PLANTILLA_AREA)
        .filter(([t, p]) => t !== 'refrigerador' && !usados.has(`${t}|${p.nombre}`))
        .map(([t]) => ({ value: t, label: TIPO_AREA[t] || t }));
}

/** Los tipos de punto de limpieza de un área, con cuántos tiene cada uno y el total. */
export function puntosDelArea(tipoDeArea, puntos) {
    const receta = PUNTOS_POR_AREA[tipoDeArea];
    if (!receta) return null;
    const tipos = TIPOS_DE_PUNTO.filter(t => receta.tipos.includes(t.tipo))
        .map(t => ({ ...t, cuenta: Math.max(contarPuntos(puntos || [], t.tipo), receta.minimo) }));
    return { minimo: receta.minimo, tipos, total: tipos.reduce((n, t) => n + t.cuenta, 0) };
}

/** ¿Cambió algo del área contra lo guardado? */
export const areaCambiada = (area, d) => d.activa !== area.activa
    || d.instrumento !== (area.instrumento || '')
    || d.calibrado !== (area.calibrado_hasta || '')
    || d.calibradoEl !== (area.calibrado_el || '')
    || JSON.stringify(d.puntos) !== JSON.stringify(area.puntos || []);
