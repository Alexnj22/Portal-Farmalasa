// Pedir un producto a otra sala — lo que no depende de React.
//
// Vivía dentro de `PedirTrasladoModal`; salió al núcleo para que la app del
// teléfono arme la MISMA solicitud (F8, docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md).
import { diasEntre, fechaTexto, hoySV } from './fecha';

/**
 * De dónde sale el producto, dicho con una sola cadena.
 *
 * Desde el 2026-08-19 una sala puede aparecer DOS veces en la lista: Bodega
 * tiene su estante de operación y el área donde aparta lo próximo a vencer, y
 * de los dos se puede pedir. El `erp_sucursal_id` dejó de alcanzar como
 * identidad —las dos filas traen el 6— así que todo lo que elige, compara o
 * indexa por origen usa ESTA clave: el desplegable, los lotes de cada estante y
 * el descarte de lotes al cambiar de origen.
 *
 * Es el mismo problema que la clave de `groupInventory` en la consulta de
 * inventario: cuando dos filas distintas comparten identificador, la que llega
 * segunda pisa a la primera y nadie se entera.
 */
export const claveOrigen = (d) => (
    d?.vencidos ? `${d.erp_sucursal_id}:V` : String(d?.erp_sucursal_id ?? '')
);

export const fmtVence = (d) => d
    ? fechaTexto(d, { month: 'short', year: '2-digit' })
    : '';

/** Días hasta una fecha, en hora de El Salvador. Negativo = ya venció. */
export function diasHasta(d) {
    if (!d) return null;
    return diasEntre(hoySV(), d);
}

const u = (n) => (Number(n) === 1 ? 'unidad' : 'unidades');

/**
 * Los avisos del formulario de pedir, cada uno en su ranura — el TEXTO y el
 * tono salen de acá para que la web y la app digan exactamente lo mismo.
 * `null` en una ranura = no hay nada que decir ahí. `tono`: danger frena,
 * warning informa, neutral es el dato suelto.
 *
 *   existencia     — la cuenta contra lo que tiene la sala (tres estados
 *                    excluyentes: no alcanza · alcanza pero queda bajo su
 *                    mínimo · alcanza, decisión del usuario 2026-08-06)
 *   ningunaAlcanza — ni una presentación entra en lo que la sala tiene
 *   lotes          — los lotes que quedan en pie no cubren lo pedido
 *   aMedias        — un producto empezado que todavía no entra
 *   repetido       — el mismo producto al mismo estante dos veces
 *   conProblema    — renglones de la lista que no se pueden mandar así
 *   paraQue        — falta decir para qué se pide
 */
export function avisosDelPedido(t) {
    const { pres, cantidad, sala, unidades, opcionesPres = [], ningunaAlcanza, faltan, descartados,
        lotesDeSala = [], aMedias, renglones = [], producto, yaEstaEnLaLista, conProblema = [], faltaElParaQue } = t;
    let existencia = null;
    if (pres && Number(cantidad) > 0 && sala) {
        if (unidades > Number(sala.unidades ?? 0)) {
            const baja = Number(cantidad) > 1
                ? ` Baja la cantidad${opcionesPres.length > 1 ? ' o elige otra presentación' : ''}.` : '';
            existencia = { tono: 'danger', texto: `No alcanza: pides ${unidades} ${u(unidades)} y ${sala.sala} tiene ${sala.unidades}.${baja}` };
        } else if (Number(sala.minimo ?? 0) > 0 && (Number(sala.unidades) - unidades) < Number(sala.minimo)) {
            existencia = { tono: 'warning', texto: `${unidades} ${u(unidades)} · ${sala.sala} tiene ${sala.unidades} y quedaría en ${Number(sala.unidades) - unidades}, bajo su mínimo de ${sala.minimo}.` };
        } else {
            existencia = { tono: 'neutral', texto: `${unidades} ${u(unidades)} · ${sala.sala} tiene ${sala.unidades}` };
        }
    }
    const ninguna = ningunaAlcanza && sala
        ? { tono: 'danger', texto: `${sala.sala} tiene ${sala.unidades} ${u(sala.unidades)}, y no alcanzan para una sola de las presentaciones de este producto. Elige otra sala.` }
        : null;
    let lotes = null;
    if (faltan > 0 && descartados?.size > 0) {
        lotes = { tono: 'danger', texto: `Con los lotes que dejaste fuera faltan ${faltan} ${u(faltan)}. Vuelve a incluir alguno o baja la cantidad.` };
    } else if (faltan > 0 && !descartados?.size && unidades <= Number(sala?.unidades ?? 0)) {
        const suman = lotesDeSala.reduce((s, l) => s + Number(l.unidades ?? 0), 0);
        lotes = { tono: 'danger', texto: `Los lotes de ${sala?.sala ?? 'esa sala'} suman ${suman} unidades, menos que las ${unidades} que pides. Baja la cantidad.` };
    }
    return {
        existencia,
        ningunaAlcanza: ninguna,
        lotes,
        aMedias: aMedias && renglones.length > 0 && producto
            ? { tono: 'warning', texto: `Te falta terminar ${producto.descripcion}. Complétalo para que entre, o déjalo fuera.` } : null,
        repetido: yaEstaEnLaLista && producto
            ? { tono: 'warning', texto: `${producto.descripcion} ya está en la lista para ${sala?.sala}. Quítalo de «En la solicitud» y agrégalo con la cantidad total.` } : null,
        conProblema: conProblema.length
            ? { tono: 'danger', texto: `${conProblema.length === 1 ? `${conProblema[0].item.descripcion} no se puede mandar así.` : `${conProblema.length} productos no se pueden mandar así.`} Corrígelo en «En la solicitud».` } : null,
        paraQue: faltaElParaQue
            ? { tono: 'warning', texto: 'Falta decir para qué se pide: es lo único que queda escrito en el movimiento de las dos salas.' } : null,
    };
}
