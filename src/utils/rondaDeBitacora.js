// La bitácora del día y la ronda — la lógica que vivía dentro de las pantallas
// (TabHoy, PasarLaRonda, BitacorasView) y que la app del teléfono necesita
// idéntica. Si cada una la escribiera por su cuenta, un día la web mandaría una
// lectura que la app no manda, y ninguna de las dos daría error.
//
// Nada de acá conoce una pantalla: recibe el `dia` de `fetchBitacoraDia` y
// devuelve datos.
import { TIPOS_DE_PUNTO, fueraDeRango } from '../data/bitacoras';
import { fechaTexto, hoySV, sumarDias } from './fecha';

/**
 * Los momentos del día: la unión de las franjas de todas las áreas, por horario.
 * Desde que el reloj es de la sucursal son los mismos para todas, pero se unen
 * igual — la bodega central tiene los suyos y una sucursal puede quedar a medio
 * configurar. `ahora` = alguna franja de ese momento está abierta.
 */
export function momentosDelDia(areasActivas) {
    const mapa = new Map();
    for (const a of areasActivas || []) {
        for (const f of a.franjas || []) {
            if (!mapa.has(f.clave)) {
                mapa.set(f.clave, {
                    clave: f.clave, label: f.label, desde: f.desde, hasta: f.hasta,
                    ahora: f.estado === 'abierta',
                });
            } else if (f.estado === 'abierta') {
                mapa.get(f.clave).ahora = true;
            }
        }
    }
    return [...mapa.values()].sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
}

/**
 * Qué toca en un momento: cada lectura de esa franja y cada limpieza que
 * empieza a esa hora, con la cuenta de hechos, vencidos y abiertos.
 * `tono` es la señal del momento: completo → success, algo abierto → warning,
 * algo vencido → danger.
 */
export function resumenDelMomento(momento, areasActivas) {
    const bloques = [];
    for (const a of areasActivas || []) {
        const f = (a.franjas || []).find(x => x.clave === momento.clave);
        if (f) bloques.push({ area: a, bloque: f, tipo: 'lectura' });
        for (const t of a.limpiezas || []) {
            if (t.desde === momento.desde) bloques.push({ area: a, bloque: t, tipo: 'limpieza' });
        }
    }
    const listo = (b) => Boolean(b.bloque.lectura || b.bloque.registro);
    const hechos = bloques.filter(listo).length;
    const vencidos = bloques.filter(b => b.bloque.estado === 'vencida' && !listo(b)).length;
    const abiertos = bloques.filter(b => b.bloque.estado === 'abierta' && !listo(b)).length;
    const completo = bloques.length > 0 && hechos === bloques.length;
    const tono = completo ? 'success' : (abiertos ? 'warning' : (vencidos ? 'danger' : null));
    return { bloques, hechos, vencidos, abiertos, completo, tono };
}

/**
 * Lo pendiente de la ronda, agrupado por MOMENTO. La clave es el horario, no el
 * rótulo: dos áreas pueden llamar «Mañana» a ventanas distintas y juntarlas
 * diría una hora que no es la de nadie. Si algo del momento venció, el momento
 * entero está vencido.
 */
export function agruparRondaPorMomento(pendientes) {
    const mapa = new Map();
    for (const it of pendientes || []) {
        const clave = `${it.bloque.desde}|${it.bloque.hasta}`;
        const g = mapa.get(clave) || {
            clave, label: it.bloque.label, desde: it.bloque.desde, hasta: it.bloque.hasta,
            estado: it.bloque.estado, lecturas: [], limpiezas: [],
        };
        (it.tipo === 'lectura' ? g.lecturas : g.limpiezas).push(it);
        if (it.bloque.estado === 'vencida') g.estado = 'vencida';
        mapa.set(clave, g);
    }
    return [...mapa.values()].sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
}

const texto = (v) => String(v ?? '').trim();

/**
 * Lo que se manda a `registrarRonda`. Un renglón vacío NO viaja: la ronda es la
 * lista de lo que se puede anotar ahora, no un formulario que haya que
 * completar — exigir todo enseñaría a inventar el que falta.
 *
 * `valores[clave]` = { temp, hum, accion } para una lectura y
 * { marcada, puntos: Set<clave>, obs } para una limpieza.
 */
export function armarEnvioDeRonda(pendientes, valores, fecha) {
    const salida = [];
    for (const it of pendientes || []) {
        const v = valores?.[it.clave] || {};
        if (it.tipo === 'lectura') {
            const temp = texto(v.temp);
            if (!temp) continue;
            salida.push({
                clave: it.clave, tipo: 'lectura', area_id: it.area.id, fecha,
                franja: it.bloque.clave,
                temperatura: Number(temp),
                humedad: it.area.mide_humedad && texto(v.hum) !== '' ? Number(v.hum) : null,
                accion: texto(v.accion) || null,
            });
        } else if (v.marcada) {
            const marcadas = v.puntos || new Set();
            salida.push({
                clave: it.clave, tipo: 'limpieza', area_id: it.area.id, fecha,
                turno: it.bloque.clave,
                observaciones: texto(v.obs) || null,
                puntos: (it.area.puntos || []).map(p => ({ clave: p.clave, hecho: marcadas.has(p.clave) })),
            });
        }
    }
    return salida;
}

/**
 * Las lecturas escritas fuera de rango que todavía no dicen qué se hizo. La
 * base las rechaza igual; frenarlas antes evita mandar una vuelta entera para
 * que vuelva con un renglón caído.
 */
export function lecturasSinAccion(pendientes, valores) {
    return (pendientes || []).filter(it => {
        if (it.tipo !== 'lectura') return false;
        const v = valores?.[it.clave] || {};
        if (!texto(v.temp)) return false;
        return fueraDeRango(it.area, v.temp) && !texto(v.accion);
    });
}

/** Marcar el turno de limpieza marca TODOS sus muebles; desmarcarlo, ninguno. */
export function marcarTurnoDeLimpieza(area, marcada) {
    return { marcada, puntos: marcada ? new Set((area?.puntos || []).map(p => p.clave)) : new Set() };
}

/** Cuántos muebles de la limpieza quedaron sin marcar. */
export function mueblesQueFaltan(area, marcadas) {
    const puntos = area?.puntos || [];
    const s = marcadas || new Set();
    return puntos.length - [...s].filter(c => puntos.some(p => p.clave === c)).length;
}

/** «Hoy», «Ayer» o «Lunes 3 de septiembre». */
export function rotularDia(fecha) {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === sumarDias(hoy, -1)) return 'Ayer';
    const txt = fechaTexto(fecha, { weekday: 'long', day: 'numeric', month: 'long' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/**
 * Las salas que llevan esta bitácora. El libro bajo receta es de las salas de
 * venta; la de ambiente, también de las bodegas.
 */
export function salasDeBitacora(branches, { libro = false } = {}) {
    const tipos = libro ? ['FARMACIA'] : ['FARMACIA', 'BODEGA'];
    return (branches || [])
        .filter(b => tipos.includes(b.type || 'FARMACIA'))
        .map(b => ({ value: String(b.id), label: b.name }));
}

/**
 * Los muebles de una limpieza, agrupados por tipo (vitrinas, estantes…):
 * veintiséis casillas seguidas son un muro donde no se sabe de qué nombre es
 * cada visto. Lo que no tiene tipo conocido va a «Otros». Con menos de dos
 * muebles no hay nada que elegir: marcar el turno ya lo dice todo.
 */
export function gruposDePuntos(puntos) {
    const lista = puntos || [];
    if (lista.length < 2) return [];
    const grupos = TIPOS_DE_PUNTO
        .map(t => ({ ...t, items: lista.filter(p => p.tipo === t.tipo) }))
        .filter(g => g.items.length > 0);
    const otros = lista.filter(p => !TIPOS_DE_PUNTO.some(t => t.tipo === p.tipo));
    if (otros.length) grupos.push({ tipo: 'otro', label: 'Otros', singular: '', items: otros });
    return grupos;
}

/** Marca o desmarca un mueble. Devuelve un Set nuevo. */
export function alternarPunto(marcadas, clave) {
    const s = new Set(marcadas);
    if (s.has(clave)) s.delete(clave); else s.add(clave);
    return s;
}

/** «Todas» / «Ninguna» de un grupo: si estaban todas, las quita; si no, las pone. */
export function alternarGrupoDePuntos(marcadas, items) {
    const todas = items.every(p => marcadas.has(p.clave));
    const s = new Set(marcadas);
    items.forEach(p => (todas ? s.delete(p.clave) : s.add(p.clave)));
    return s;
}

/** Dentro de su grupo alcanza con el número: «Vitrina 3» → «3». */
export function rotuloCortoDePunto(punto, singular) {
    const n = String(punto?.label || '').replace(singular, '').trim();
    return singular && n ? n : (punto?.label || '·');
}
