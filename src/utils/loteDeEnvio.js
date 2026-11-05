/**
 * Qué lote sale de un renglón de traslado cuando el que pidió la solicitud no
 * está (2026-11-05). Pedido del usuario: «si me solicitan un producto con un
 * lote/vence y no lo tengo en la sucursal, agrega la opción de poderlo
 * modificar, así le envío el correcto. Pero confirmando que no envíe otro
 * sólo por enviar (si hay más de 1 lote real, que haga confirmar)».
 *
 * Hasta ese día el servidor completaba con el que vence primero y lo dejaba en
 * un aviso. Ahora frena (`LOTE_PEDIDO_NO_ESTA`) y esta cuenta decide qué se
 * ofrece: los lotes de la sala que cubren el renglón ENTERO —uno por renglón,
 * para que no se complete con otro por la espalda—, y «sin lote asignado» al
 * final si alcanza (ése después pide el lote de la caja).
 *
 * Con UNA sola opción viene elegida; con más, ninguna: hay que tocarla.
 */
import { esLoteGenerico } from './unidadesInventario';

const norm = (s) => String(s ?? '').trim().toUpperCase();
const dia = (s) => String(s ?? '').slice(0, 10);

/** Los lotes REALES que reservó el renglón, en unidades base. */
export function lotesRealesPedidos(item) {
    return (Array.isArray(item?.lotes) ? item.lotes : [])
        .filter((l) => l?.lote && !esLoteGenerico(l.lote) && Number(l?.unidades) > 0)
        .map((l) => ({ lote: norm(l.lote), vence: dia(l.vence), unidades: Number(l.unidades) }));
}

/**
 * Lo que se ofrece para mandar `paquetes` del renglón, sobre los lotes de la
 * sala (`lotesEnUnidades`: `{ lote, vence, unidades }`).
 * @returns {{ lote: string, vence: string, unidades: number, sinAsignar: boolean }[]}
 */
export function opcionesDeLote(lotesSala, paquetes, factor) {
    const hace = Math.max(1, Number(paquetes) || 0) * (Number(factor) || 1);
    const sala = Array.isArray(lotesSala) ? lotesSala : [];
    const reales = sala
        .filter((l) => l?.lote && !esLoteGenerico(l.lote) && Number(l.unidades) >= hace)
        .map((l) => ({ lote: norm(l.lote), vence: dia(l.vence), unidades: Number(l.unidades), sinAsignar: false }));
    const gen = sala.filter((l) => esLoteGenerico(l?.lote) && Number(l.unidades) >= hace)
        .sort((a, b) => b.unidades - a.unidades)[0];
    return gen ? [...reales, { lote: 'GENERICO', vence: '', unidades: Number(gen.unidades), sinAsignar: true }] : reales;
}

/**
 * ¿El lote pedido está en la sala para lo que sale? Cada reservado cubre en
 * ORDEN hasta lo que sale: con un despacho parcial, el último reservado da
 * menos sin que falte nada (igual que el servidor).
 * Devuelve los números pedidos que no alcanzan; vacío = está.
 */
export function pedidosQueNoEstan(item, lotesSala, paquetes, factor) {
    let porCubrir = (Number(paquetes) || 0) * (Number(factor) || 1);
    const sala = Array.isArray(lotesSala) ? lotesSala : [];
    const faltan = [];
    for (const p of lotesRealesPedidos(item)) {
        const espera = Math.min(p.unidades, Math.max(0, porCubrir));
        porCubrir -= espera;
        if (espera <= 0) continue;
        const hay = sala.filter((l) => norm(l.lote) === p.lote && (!p.vence || !l.vence || dia(l.vence) === p.vence))
            .reduce((n, l) => n + Number(l.unidades || 0), 0);
        if (hay < espera) faltan.push(p.lote);
    }
    return faltan;
}

/** La elección que vale: la tocada, o la única opción si hay una sola. */
export function eleccionEfectiva(tocada, opciones) {
    if (tocada) return tocada;
    return Array.isArray(opciones) && opciones.length === 1 ? opciones[0] : null;
}

/** 'AAAA-MM-DD' de dentro de 6 meses, contando desde `hoy`. */
export function seisMesesDesde(hoy) {
    const [a, m, d] = String(hoy).split('-').map(Number);
    const f = new Date(Date.UTC(a, m - 1 + 6, d));
    return f.toISOString().slice(0, 10);
}

/**
 * ¿El lote que sale vence ANTES que lo pedido y dentro de 6 meses? Entonces
 * no se despacha: se le propone a la sala que pidió (usuario, 2026-11-05).
 * Misma regla que `aplicar-traslado-inventario`, que es la autoridad.
 */
export function venceMasCortoQueLoPedido(vence, item, hoy) {
    const v = String(vence || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const pedido = lotesRealesPedidos(item).map((p) => p.vence).filter(Boolean).sort()[0];
    return Boolean(pedido) && v < pedido && v <= seisMesesDesde(hoy);
}
