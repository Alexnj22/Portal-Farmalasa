/* En qué punto está cada diferencia de caja y cada día que la tuvo.
 *
 * Nació el 2026-09-25 con la pestaña «Diferencias» de /caja: «necesito ver qué
 * días hay diferencias y cómo puedo abonarlas» (usuario). La pantalla que había
 * mostraba el TRAMO de cada corte, así que el día de Salud 2 que cerró con
 * −$20.25 terminaba en una tarjeta que decía $0.00, y lo que faltaba hacer no
 * estaba escrito en ninguna parte.
 *
 * Un solo sitio decide los estados, y en orden de URGENCIA — el del día es el
 * peor de sus cortes:
 *
 *   sin_resolver   el corte está confirmado con diferencia y nadie dijo nada
 *   por_confirmar  el corte con diferencia todavía no se confirmó
 *   con_saldo      hay responsables y todavía deben algo
 *   por_registrar  el dinero ya se movió (retiro o abonos) y falta anotarlo
 *                  en el sistema
 *   resuelto       nada pendiente
 *
 * Es lógica pura, sin navegador: la prueban `tests/unit/diferenciasDeCaja.test.js`.
 */

export const ESTADOS_DIFERENCIA = ['sin_resolver', 'por_confirmar', 'con_saldo', 'por_registrar', 'resuelto'];

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
    if (!dif) return corte?.estado === 'PENDIENTE' ? 'por_confirmar' : 'sin_resolver';
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

/** Cuántos días hay en cada estado y cuánto falta cobrar en total. */
export function resumenDeDias(dias) {
    const r = { sin_resolver: 0, por_confirmar: 0, con_saldo: 0, por_registrar: 0, resuelto: 0, saldo: 0 };
    for (const d of dias || []) {
        const e = d.estadoDif === 'compensado' ? 'resuelto' : d.estadoDif;
        r[e] = (r[e] || 0) + 1;
        r.saldo += centavos(d.saldo);
    }
    r.saldo /= 100;
    return r;
}

/** ¿El día entra en el filtro? `PENDIENTES` = lo que no está resuelto ni compensado. */
export function diaEnFiltro(dia, filtro) {
    if (!filtro || filtro === 'TODOS') return true;
    const cerrado = dia.estadoDif === 'resuelto' || dia.estadoDif === 'compensado';
    if (filtro === 'PENDIENTES') return !cerrado;
    if (filtro === 'resuelto') return cerrado;
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
 * Los días clasificados por cómo CERRARON, no por sus cortes sueltos.
 *
 * Pedido del usuario (2026-09-25): «separar las negativas y las positivas, por
 * defecto las negativas». La primera versión recortaba por corte, y mostró el
 * error de fondo — La Popular del 24-sep: «Faltó $0.20 · Sobró $0.20», y el
 * usuario preguntó «¿esos que sobran y faltan lo mismo?». No faltó nada: el
 * sobrante de mediodía ya no estaba en el conteo de la noche, así que ese
 * corte midió −$0.20 contra el anterior y el día cerró EXACTO. Contar ese
 * tramo como faltante pendiente le pedía a alguien reponer dinero que nunca
 * faltó.
 *
 * Por eso:
 *   · un día con `neto` en cero (y sin cortes por confirmar) está
 *     `compensado`: no es trabajo pendiente;
 *   · un día con neto negativo es de FALTANTE, y su estado sale sólo de los
 *     cortes con faltante; con neto positivo, al revés. Los cortes del otro
 *     signo se compensaron dentro del día y se marcan así;
 *   · un corte todavía sin confirmar cuenta siempre: puede mover el neto.
 *
 * `faltanteDia` y `sobranteDia` son los dos lados del día entero, para la
 * tarjeta.
 */
export function porSigno(dias, signo = 'todos') {
    return (dias || []).map((d) => {
        const neto = centavos(d.neto);
        const lado = Math.sign(neto);
        const porConfirmar = (d.cortes || []).some((c) => c.estado === 'PENDIENTE');
        const compensado = neto === 0 && !porConfirmar;
        const cortes = (d.cortes || []).map((c) => {
            const cuenta = c.estado === 'PENDIENTE' || (lado !== 0 && Math.sign(centavos(c.tramo)) === lado);
            // Una resolución ya dada se respeta aunque el corte se haya
            // compensado: alguien decidió algo y eso no se borra de la vista.
            return cuenta || c.diferencia ? c : { ...c, estadoDif: 'compensado' };
        });
        const cuentan = cortes.filter((c) => c.estadoDif !== 'compensado');
        return {
            ...d,
            cortes,
            compensado,
            estadoDif: compensado ? 'compensado' : peorEstado(cuentan.map((c) => c.estadoDif)),
            faltanteDia: d.faltanteDia ?? d.faltante,
            sobranteDia: d.sobranteDia ?? d.sobrante,
        };
    }).filter((d) => {
        if (signo !== 'falta' && signo !== 'sobra') return true;
        const quiere = signo === 'falta' ? -1 : 1;
        return Math.sign(centavos(d.neto)) === quiere
            || d.cortes.some((c) => c.estado === 'PENDIENTE' && Math.sign(centavos(c.tramo)) === quiere);
    });
}
