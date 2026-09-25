/* En qué punto está cada diferencia de caja y cada día que la tuvo.
 *
 * Nació el 2026-09-25 con la pestaña «Diferencias» de /caja: «necesito ver qué
 * días hay diferencias y cómo puedo abonarlas» (usuario). La pantalla que había
 * mostraba el TRAMO de cada corte, así que el día de Salud 2 que cerró con
 * −$20.25 terminaba en una tarjeta que decía $0.00, y lo que faltaba hacer no
 * estaba escrito en ninguna parte.
 *
 * ── LA REGLA (usuario, 2026-09-25) ─────────────────────────────────────────
 * «El positivo no se resuelve, se acumula (luego al hacer inventario ocuparé
 * ese valor). Las diferencias negativas al no encontrar causa se pagan, así
 * que no se deben mezclar. Si en el corte AM sobró $5, en el corte PM lo
 * esperado debe tener sumados esos $5.»
 *
 *   · Cada corte se mide contra el último CONFIRMADO del día con su diferencia
 *     adentro —eso es `corte_tramo`—, así que un sobrante confirmado sube el
 *     esperado del siguiente, y si esa plata desaparece, el siguiente es un
 *     FALTANTE de verdad. Nunca se compensan entre sí.
 *   · Un SOBRANTE se acumula por sala. Si tiene causa, se explica con
 *     comprobante y sale del acumulado; el registro queda.
 *   · Un FALTANTE se paga (responsables y abonos) o se explica con causa y
 *     comprobante. Al centavo: no hay tolerancia.
 *
 * Estados, en orden de URGENCIA — el del día es el peor de sus cortes:
 *
 *   sin_resolver   faltante confirmado sin causa ni responsables
 *   por_confirmar  el corte todavía no se confirmó
 *   con_saldo      faltante con responsables que todavía deben algo
 *   por_registrar  dinero que ya se movió (abono o un retiro viejo) sin su
 *                  ingreso o vale en el sistema
 *   acumulado      sobrante sin causa: queda en el acumulado de la sala
 *   resuelto       nada pendiente (faltante saldado o explicado, sobrante
 *                  explicado)
 *
 * Es lógica pura, sin navegador: la prueban `tests/unit/diferenciasDeCaja.test.js`.
 */

export const ESTADOS_DIFERENCIA = ['sin_resolver', 'por_confirmar', 'con_saldo', 'por_registrar', 'acumulado', 'resuelto'];

const rango = (e) => {
    const i = ESTADOS_DIFERENCIA.indexOf(e);
    return i < 0 ? ESTADOS_DIFERENCIA.length : i;
};

const centavos = (n) => Math.round(Number(n || 0) * 100);

/** Lo que falta cobrar de una resolución con responsables, en dólares. */
export function saldoDeDiferencia(dif) {
    if (!dif || dif.via !== 'REPONE') return 0;
    return Math.max(0, centavos(dif.asignado) - centavos(dif.abonado)) / 100;
}

/**
 * El estado de un corte con diferencia.
 * @param {object} corte `{ estado, tramo, diferencia }` como lo da `get_dias_con_diferencia`
 */
export function estadoDeCorte(corte) {
    const dif = corte?.diferencia;
    if (!dif) {
        if (corte?.estado === 'PENDIENTE') return 'por_confirmar';
        return centavos(corte?.tramo) > 0 ? 'acumulado' : 'sin_resolver';
    }
    if (dif.via === 'REPONE') {
        if (saldoDeDiferencia(dif) > 0) return 'con_saldo';
        return Number(dif.abonos_sin_asentar) > 0 ? 'por_registrar' : 'resuelto';
    }
    if (dif.via === 'RETIRA' && !dif.asentado_at) return 'por_registrar';
    return 'resuelto';
}

/** El peor estado entre varios. Sin ninguno, `resuelto`. */
export function peorEstado(estados) {
    return (estados || []).reduce(
        (peor, e) => (rango(e) < rango(peor) ? e : peor),
        'resuelto',
    );
}

/**
 * Los días con su estado y sus totales. Cada corte sale con `estadoDif` y cada
 * día con `estadoDif`, `faltante` (≤ 0), `sobrante` (≥ 0) y `saldo` (lo que
 * falta cobrar a responsables).
 *
 * `faltante` y `sobrante` suman los tramos de los cortes con diferencia; `neto`
 * es otra cosa —cómo QUEDÓ el día— y lo calcula la base sobre los confirmados.
 */
export function conEstados(dias) {
    return (dias || []).map((d) => {
        const cortes = (d.cortes || []).map((c) => ({ ...c, estadoDif: estadoDeCorte(c) }));
        let faltante = 0;
        let sobrante = 0;
        let saldo = 0;
        for (const c of cortes) {
            const t = centavos(c.tramo);
            if (t < 0) faltante += t; else sobrante += t;
            saldo += centavos(saldoDeDiferencia(c.diferencia));
        }
        return {
            ...d,
            cortes,
            estadoDif: peorEstado(cortes.map((c) => c.estadoDif)),
            faltante: faltante / 100,
            sobrante: sobrante / 100,
            saldo: saldo / 100,
        };
    });
}

/** Cuántos días hay en cada estado, cuánto falta cobrar y cuánto sobrante hay acumulado. */
export function resumenDeDias(dias) {
    const r = {
        sin_resolver: 0, por_confirmar: 0, con_saldo: 0, por_registrar: 0, acumulado: 0, resuelto: 0,
        saldo: 0, montoAcumulado: 0,
    };
    for (const d of dias || []) {
        r[d.estadoDif] = (r[d.estadoDif] || 0) + 1;
        r.saldo += centavos(d.saldo);
        // Lo acumulado es la suma de los sobrantes CONFIRMADOS sin causa. Uno
        // por confirmar todavía puede descartarse; uno explicado ya salió.
        for (const c of d.cortes || []) {
            if (c.estadoDif === 'acumulado') r.montoAcumulado += centavos(c.tramo);
        }
    }
    r.saldo /= 100;
    r.montoAcumulado /= 100;
    return r;
}

/**
 * ¿El día entra en el filtro? `PENDIENTES` = lo que alguien tiene que hacer.
 * Un sobrante acumulado no es trabajo pendiente: se ve con `TODOS` o con
 * `acumulado`.
 */
export function diaEnFiltro(dia, filtro) {
    if (!filtro || filtro === 'TODOS') return true;
    if (filtro === 'PENDIENTES') return dia.estadoDif !== 'resuelto' && dia.estadoDif !== 'acumulado';
    return dia.estadoDif === filtro;
}

/**
 * Le pega a cada corte su resolución COMPLETA —personas con saldo, abonos,
 * comprobante— encima del resumen que trae el día. El resumen alcanza para la
 * lista; la ficha del día necesita la fila entera para abonar y anular.
 *
 * Se une por `id` de la resolución y no por corte: el resumen ya trae la viva,
 * así que una anulada vieja del mismo corte no se cuela.
 */
export function unirResoluciones(dias, resoluciones) {
    const porId = new Map((resoluciones || []).map((r) => [String(r.id), r]));
    return (dias || []).map((d) => ({
        ...d,
        cortes: (d.cortes || []).map((c) => {
            if (!c.diferencia) return c;
            const completa = porId.get(String(c.diferencia.id));
            return completa ? { ...c, diferencia: { ...c.diferencia, ...completa } } : c;
        }),
    }));
}

/**
 * Lo que falta anotar en el sistema, fila por fila, para «Registrar».
 *
 * Dos clases de filas desde el 2026-09-25:
 *   · el retiro de un sobrante (`RETIRA`) sin asentar — SALE de la caja;
 *   · cada ABONO vivo sin asentar — ENTRA a la caja. Un faltante con
 *     responsables ya no se anota entero: el dinero entra abono por abono, y
 *     cada uno el día que se hizo.
 *
 * Los abonos salen con el monto NEGATIVO a propósito: `AsentarDiferencias`
 * agrupa por signo (entra/sale), igual que agrupaba los faltantes de antes.
 */
export function pendientesDeRegistrar(resoluciones, { sala = '' } = {}) {
    const filas = [];
    for (const d of resoluciones || []) {
        if (d.anulada_at) continue;
        if (sala && String(d.branch_id) !== String(sala)) continue;
        if (d.via === 'RETIRA' && !d.asentado_at) filas.push({ ...d, kind: 'diferencia' });
        if (d.via === 'REPONE') {
            for (const a of d.abonos || []) {
                if (a.anulada_at || a.asentado_at) continue;
                filas.push({
                    kind: 'abono',
                    id: a.id,
                    corte_id: d.corte_id,
                    branch_id: d.branch_id,
                    fecha: d.fecha,
                    hora: d.hora,
                    monto: -Math.abs(Number(a.monto)),
                    causa: `Abono de ${a.nombre || 'un responsable'}`,
                });
            }
        }
    }
    return filas;
}

/**
 * Los días recortados a UN signo: `falta` deja sólo los cortes con faltante y
 * `sobra` sólo los de sobrante, y el estado y los totales del día se recalculan
 * sobre los que quedan. No hay «todos»: faltantes y sobrantes no se mezclan
 * (ver LA REGLA arriba).
 *
 * Reemplaza a una versión del mismo día que clasificaba el día por su neto y
 * daba por «compensado» un +$0.20 seguido de un −$0.20. Con la regla del
 * usuario eso es un sobrante de $0.20 que se acumula y un faltante de $0.20
 * que se paga: el segundo corte debía tener los $0.20 y no los tenía.
 */
export function porSigno(dias, signo = 'falta') {
    const quiere = signo === 'sobra' ? 1 : -1;
    const quedan = (dias || [])
        .map((d) => ({
            ...d,
            cortes: (d.cortes || []).filter((c) => Math.sign(centavos(c.tramo)) === quiere),
        }))
        .filter((d) => d.cortes.length);
    return conEstados(quedan);
}

const ORDEN_URGENCIA = ['sin_resolver', 'por_confirmar', 'con_saldo', 'por_registrar', 'acumulado', 'resuelto'];

/**
 * El orden de la lista: lo más urgente arriba, después lo más reciente. Vive
 * acá y no en el componente porque la lista se PAGINA: ordenar dentro de cada
 * página dejaría un «sin resolver» de agosto en la página 3.
 */
export function ordenarDias(dias) {
    return [...(dias || [])].sort((a, b) => (
        ORDEN_URGENCIA.indexOf(a.estadoDif) - ORDEN_URGENCIA.indexOf(b.estadoDif)
        || String(b.fecha).localeCompare(String(a.fecha))
        || Number(a.branch_id) - Number(b.branch_id)
    ));
}

/**
 * ¿El día entra en el mes elegido? `mes` es `YYYY-MM` o `TODOS`.
 *
 * Un FALTANTE SIN RESOLVER entra siempre, sea del mes que sea (usuario,
 * 2026-09-25: «las diferencias negativas sin resolver siempre se muestran
 * todas»). Es dinero que falta y nadie explicó: esconderlo por la fecha es cómo
 * se olvida.
 */
export function diaEnMes(dia, mes) {
    if (!mes || mes === 'TODOS') return true;
    if (String(dia.fecha).startsWith(mes)) return true;
    return (dia.cortes || []).some((c) => Number(c.tramo) < 0 && c.estadoDif === 'sin_resolver');
}

/** Los meses que tienen algún día, del más reciente al más viejo (`YYYY-MM`). */
export function mesesDeLosDias(dias) {
    return [...new Set((dias || []).map((d) => String(d.fecha).slice(0, 7)))].sort().reverse();
}

/**
 * En qué quedó el dinero de un día, por tramos, para la barra de la tarjeta.
 * Pidió el usuario el 2026-09-25 «que se vea cuánto se ha abonado» sin abrir
 * la ficha.
 *
 * Faltante (`falta`): lo que ya volvió —`abonado`, y `explicado` cuando se
 * encontró la causa— contra lo que no: `porCobrar` (responsables con saldo),
 * `sinResolver` y `porConfirmar`. Sobrante (`sobra`): `explicado` (con causa o
 * retirado), `acumulado` y `porConfirmar`.
 *
 * Suma exacto al total al centavo: los tramos salen de los mismos cortes que
 * `conEstados` y nada se reparte dos veces. `pct` es lo cubierto sobre el
 * total, redondeado hacia abajo — un 99.6% no se pinta como 100.
 */
export function desgloseDelDia(dia, signo = 'falta') {
    const t = { abonado: 0, explicado: 0, porCobrar: 0, sinResolver: 0, porConfirmar: 0, acumulado: 0 };
    for (const c of dia?.cortes || []) {
        const m = Math.abs(centavos(c.tramo));
        const dif = c.diferencia;
        if (!dif) {
            if (c.estado === 'PENDIENTE') t.porConfirmar += m;
            else if (signo === 'sobra') t.acumulado += m;
            else t.sinResolver += m;
        } else if (dif.via === 'REPONE') {
            const saldo = Math.min(m, centavos(saldoDeDiferencia(dif)));
            t.porCobrar += saldo;
            t.abonado += m - saldo;
        } else {
            t.explicado += m;
        }
    }
    const total = Object.values(t).reduce((a, b) => a + b, 0);
    const cubierto = t.abonado + t.explicado;
    const out = { total: total / 100, cubierto: cubierto / 100, pct: total > 0 ? Math.floor((cubierto * 100) / total) : 0 };
    for (const k of Object.keys(t)) out[k] = t[k] / 100;
    return out;
}

/**
 * Quiénes responden por los faltantes del día, una vez cada uno aunque estén en
 * varios cortes, con lo que les tocó, lo que abonaron y lo que deben.
 */
export function responsablesDelDia(dia) {
    const porId = new Map();
    for (const c of dia?.cortes || []) {
        if (c.diferencia?.via !== 'REPONE') continue;
        for (const p of c.diferencia.personas || []) {
            const k = String(p.persona_id);
            const prev = porId.get(k) || { persona_id: p.persona_id, nombre: p.nombre, monto: 0, abonado: 0, saldo: 0 };
            prev.monto += centavos(p.monto);
            prev.abonado += centavos(p.abonado);
            prev.saldo += centavos(p.saldo);
            porId.set(k, prev);
        }
    }
    return [...porId.values()]
        .map((p) => ({ ...p, monto: p.monto / 100, abonado: p.abonado / 100, saldo: p.saldo / 100 }))
        .sort((a, b) => b.saldo - a.saldo || String(a.nombre).localeCompare(String(b.nombre)));
}
