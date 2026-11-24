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
    for (const f of filas ?? []) m.set(Number(f.hora), Number(f.parte ?? f.total) || 0);
    return m;
};

/**
 * `hoy`: `[{ hora, total }]` lo vendido hoy por hora. `tipica`: `[{ hora, total }]`
 * el promedio por hora del mismo día de la semana. `metaDia`: la meta del día
 * (la del mes entre sus días) o null. `reloj`: `{ hora, minuto }` de ahora.
 * @returns null si no hay con qué comparar; si no, la serie de la gráfica
 *   (acumulados por hora) y los tres números: vendido, esperado ahora, base.
 */
export function armarDia({ hoy, tipica, metaDia, reloj, pasada = null }) {
    const real = porHora(hoy);
    const sem = pasada ? porHora(pasada) : null;
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
    let accSem = 0;
    let esperadoAhora = 0;
    for (let h = desde; h <= hasta; h += 1) {
        const t = tip.get(h) ?? 0;
        if (h === reloj.hora) esperadoAhora = base * (accTip + t * Math.min(reloj.minuto, 60) / 60) / totalTipico;
        accTip += t;
        accReal += real.get(h) ?? 0;
        accSem += sem?.get(h) ?? 0;
        serie.push({
            hora: h,
            esperado: Math.round(base * accTip / totalTipico * 100000) / 100000,
            // Lo que todavía no pasó no se dibuja: la línea de hoy termina en la hora actual.
            real: h <= reloj.hora ? Math.round(accReal * 100000) / 100000 : null,
            ...(sem ? { pasada: Math.round(accSem * 100000) / 100000 } : {}),
        });
    }
    if (reloj.hora < desde) esperadoAhora = 0;
    if (reloj.hora > hasta) esperadoAhora = base;

    return { serie, vendido, esperadoAhora, base, conMeta: Number(metaDia) > 0 };
}

/** 'arriba' | 'ritmo' | 'bajo' | null (todavía no hay qué medir). */
export function ritmoDelDia({ vendido, esperadoAhora }) {
    if (!(esperadoAhora > 0)) return null;
    const r = vendido / esperadoAhora;
    if (r >= 1.05) return 'arriba';
    if (r >= 0.95) return 'ritmo';
    return 'bajo';
}

/**
 * Los datos de apoyo, todos como proporción (sirven igual con o sin montos):
 * ventas y ticket contra lo normal a esta hora, la semana pasada a esta hora y
 * la hora fuerte que viene.
 * @param dia la respuesta de `como_va_la_sala_hoy` (con `parte` por hora)
 */
export function datosDeApoyo(dia, reloj) {
    const hasta = (filas, campo) => (filas ?? []).reduce((acc, f) => {
        const h = Number(f.hora);
        if (h < reloj.hora) return acc + (Number(f[campo]) || 0);
        // Lo de hoy en la hora en curso ya pasó entero; lo de otros días se toma
        // en proporción a los minutos que van de la hora.
        if (h === reloj.hora) return acc + (Number(f[campo]) || 0) * (filas === dia.hoy ? 1 : Math.min(reloj.minuto, 60) / 60);
        return acc;
    }, 0);
    const parteHoy = hasta(dia.hoy, 'parte');
    const ventasHoy = hasta(dia.hoy, 'ventas');
    const parteTip = hasta(dia.tipica, 'parte');
    const ventasTip = hasta(dia.tipica, 'ventas');
    const parteSem = hasta(dia.semana_pasada, 'parte');
    const vs = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : null);
    const ticketHoy = ventasHoy > 0 ? parteHoy / ventasHoy : null;
    const ticketTip = ventasTip > 0 ? parteTip / ventasTip : null;

    // La hora fuerte que viene: la de más venta típica entre ahora y el cierre.
    const futuras = (dia.tipica ?? []).filter((f) => Number(f.hora) > reloj.hora);
    const fuerte = futuras.reduce((m, f) => (!m || Number(f.parte) > Number(m.parte) ? f : m), null);

    return {
        ventasHoy: Math.round(ventasHoy),
        ventasVsNormal: vs(ventasHoy, ventasTip),
        ticketHoy,
        ticketVsNormal: ticketHoy != null && ticketTip ? vs(ticketHoy, ticketTip) : null,
        vsSemanaPasada: vs(parteHoy, parteSem),
        horaFuerte: fuerte ? Number(fuerte.hora) : null,
    };
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

// Las frases del ritmo. Cambian cada 10 minutos para que no se vuelvan ruido.
// El bono sólo se nombra si está encendido ese mes (`metas_bono_activo`): con
// el bono apagado, prometerlo en el kiosco es un problema con el personal.
const TITULOS = {
    arriba: 'Hoy va muy bien',
    ritmo: 'Van al ritmo',
    bajo: 'Hoy va más lento',
};
const ANIMO = {
    arriba: ['Sigue así hasta el cierre.', 'Buen trabajo. Mantén el paso.', 'Cada cliente bien atendido se nota.'],
    ritmo: ['Vas donde toca a esta hora.', 'Un producto más por venta y vas arriba.', 'Mantén el paso hasta el cierre.'],
    bajo: ['Todavía hay tiempo de recuperarlo.', 'Cada venta cuenta. Ofrece algo más.', 'Una buena hora lo cambia todo.'],
};

/** Título y frase de ánimo del ritmo; `falta` ya viene dicho («$40» o «8 %»). */
export function fraseDelRitmo({ ritmo, ahoraMs, falta = null }) {
    if (!TITULOS[ritmo]) return null;
    const lista = ANIMO[ritmo];
    const animo = lista[Math.floor(ahoraMs / 600_000) % lista.length];
    const detalle = ritmo === 'bajo' && falta ? `Faltan ${falta} para ir al ritmo de esta hora. ${animo}` : animo;
    return { titulo: TITULOS[ritmo], detalle };
}

/** La tarjeta de cuando va bien. Nombra el bono sólo si está encendido. */
export function fraseDeVaBien({ esMeta, bonoActivo }) {
    if (esMeta && bonoActivo) return 'Hoy va mejor que un día normal. Cada venta de más te acerca al bono del mes.';
    if (esMeta) return 'Hoy va mejor que un día normal. Cada venta de más suma a la meta del mes.';
    return 'Hoy va mejor que un día normal. Cada venta de más suma.';
}
