/**
 * «Cómo va hoy» del kiosco de caja — la cuenta PURA (2026-11-17).
 *
 * Pedido del usuario: «una gráfica que me diga cómo va la venta, top
 * vendedores, y motivación de subir la venta porque va bajo de lo esperado».
 *
 * «Lo esperado a esta hora» NO es la meta del día entera: es la meta por la
 * parte del día que normalmente ya pasó a esta hora, medida con el mismo día de
 * la semana de las 4 semanas anteriores (`tipica`, de `como_va_la_sala_hoy`).
 * A las 9 de la mañana se espera lo que la sala suele llevar a las 9, no la
 * mitad: así el «vas bajo» no sale todas las mañanas (la misma razón por la que
 * `MetaDelDia` no pinta la barra de alarma).
 *
 * Sin meta del mes, la base es el día típico: «vas como un martes normal».
 */
import { ahoraSV } from './fecha';

/** La hora y el minuto de El Salvador de un instante. */
export function relojDelDia(ahoraMs) {
    const { h, min } = ahoraSV(ahoraMs);
    return { hora: h, minuto: min };
}

const porHora = (filas) => {
    const m = new Map();
    for (const f of filas ?? []) m.set(Number(f.hora), Number(f.total) || 0);
    return m;
};

/**
 * @param hoy      [{ hora, total }] lo vendido hoy por hora
 * @param tipica   [{ hora, total }] el promedio por hora del mismo día de la semana
 * @param metaDia  la meta del día (la del mes entre sus días) o null
 * @param reloj    { hora, minuto } de ahora
 * @returns null si no hay con qué comparar; si no, la serie de la gráfica
 *   (acumulados por hora) y los tres números: vendido, esperado ahora, base.
 */
export function armarDia({ hoy, tipica, metaDia, reloj }) {
    const real = porHora(hoy);
    const tip = porHora(tipica);
    const totalTipico = [...tip.values()].reduce((a, b) => a + b, 0);
    const vendido = [...real.values()].reduce((a, b) => a + b, 0);
    const base = Number(metaDia) > 0 ? Number(metaDia) : totalTipico;
    if (!(totalTipico > 0) || !(base > 0)) return null;

    const horas = [...new Set([...tip.keys(), ...real.keys()])].sort((a, b) => a - b);
    const desde = horas[0];
    const hasta = horas[horas.length - 1];
    const serie = [];
    let accTip = 0;
    let accReal = 0;
    let esperadoAhora = 0;
    for (let h = desde; h <= hasta; h += 1) {
        const t = tip.get(h) ?? 0;
        if (h === reloj.hora) esperadoAhora = base * (accTip + t * Math.min(reloj.minuto, 60) / 60) / totalTipico;
        accTip += t;
        accReal += real.get(h) ?? 0;
        serie.push({
            hora: h,
            esperado: Math.round(base * accTip / totalTipico * 100) / 100,
            // Lo que todavía no pasó no se dibuja: la línea de hoy termina en la hora actual.
            real: h <= reloj.hora ? Math.round(accReal * 100) / 100 : null,
        });
    }
    if (reloj.hora < desde) esperadoAhora = 0;
    if (reloj.hora > hasta) esperadoAhora = base;

    return { serie, vendido: Math.round(vendido * 100) / 100, esperadoAhora: Math.round(esperadoAhora * 100) / 100, base, conMeta: Number(metaDia) > 0 };
}

/** 'arriba' | 'ritmo' | 'bajo' | null (todavía no hay qué medir). */
export function ritmoDelDia({ vendido, esperadoAhora }) {
    if (!(esperadoAhora > 0)) return null;
    const r = vendido / esperadoAhora;
    if (r >= 1.05) return 'arriba';
    if (r >= 0.95) return 'ritmo';
    return 'bajo';
}

// Ideas para subir la venta: cosas que se hacen en el mostrador, ya.
const IDEAS = [
    'Ofrece el complemento: con el antigripal, la vitamina C; con el antibiótico, el probiótico.',
    'Pregunta si lleva la receta completa. Muchos compran sólo una parte.',
    'Recomienda la presentación grande cuando sale más barata por unidad.',
    'Invita a acumular puntos. Con puntos el cliente vuelve.',
    'Muestra la oferta del día a cada cliente que llega.',
    'Pregunta si necesita algo más para la casa: alcohol, curitas, suero oral.',
];

/** Una idea distinta cada 10 minutos, la misma para todos en ese rato. */
export function ideaDelMomento(ahoraMs) {
    return IDEAS[Math.floor(ahoraMs / 600_000) % IDEAS.length];
}
