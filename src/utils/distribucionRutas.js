// Rutas, visitas y camiones de la distribuidora: las reglas que el portal
// tenía dentro de `TabRutas.jsx` y `TabCamiones.jsx`, en el núcleo para que la
// app nativa diga lo mismo con los mismos números.

const num = (v) => Number(v) || 0;

/** Lo que pasó en una visita sin venta (el `resultado` de `dist_registrar_visita`). */
export const RESULTADOS_VISITA = [
    { value: 'sin_pedido', label: 'Sin pedido' },
    { value: 'cerrado', label: 'Cerrado' },
    { value: 'no_estaba', label: 'No estaba' },
    { value: 'cobro', label: 'Sólo cobro' },
];
export const ROTULO_RESULTADO = Object.fromEntries(RESULTADOS_VISITA.map(r => [r.value, r.label]));

/** Los días de visita de una ruta (1 = lunes … 7 = domingo) con su letra. */
export const DIAS_RUTA = [{ n: 1, c: 'L' }, { n: 2, c: 'M' }, { n: 3, c: 'Mi' }, { n: 4, c: 'J' }, { n: 5, c: 'V' }, { n: 6, c: 'S' }, { n: 7, c: 'D' }];

/** «L Mi V», o «sin días». */
export const diasDeRuta = (dias) => (dias?.length ? DIAS_RUTA.filter(d => dias.includes(d.n)).map(d => d.c).join(' ') : 'sin días');

/** Pone o quita un día de la lista, siempre ordenada. */
export const alternarDia = (dias, n) => (dias.includes(n) ? dias.filter(x => x !== n) : [...dias, n].sort());

/** El avance de la ruta del día: cuántos clientes, cuántos con venta, cuántos visitados. */
export function avanceDeRuta(clientes) {
    const lista = clientes ?? [];
    const venta = lista.filter(c => c.estado === 'venta').length;
    const visitados = lista.filter(c => c.estado !== 'pendiente').length;
    return {
        total: lista.length, venta, visitados, porVisitar: lista.length - visitados,
        pctVenta: visitados ? Math.round((venta / visitados) * 100) : null,
    };
}

/** El enlace de «Cómo llegar»: a las coordenadas si el cliente las tiene; si no, a su nombre y dirección. */
export const comoLlegar = (c) => (c.lat != null && c.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.nombre} ${c.direccion ?? ''} Chalatenango El Salvador`)}`);

/** El enlace al mapa de una posición (la última del recorrido). */
export const enElMapa = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** Sube o baja un elemento de una lista (para el orden de visita). Fuera de rango, la misma lista. */
export function moverEnLista(lista, i, d) {
    const j = i + d;
    if (j < 0 || j >= lista.length) return lista;
    const n = [...lista];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
}

// ── Camiones (autoventa) ───────────────────────────────────────────────────

/** Una carga circula sin Nota de Remisión válida: sin documento, o el que tuvo se cayó. */
export const cargaSinNota = (carga) => !!carga && (!carga.dte || ['descartado', 'rechazado', 'invalidado'].includes(carga.dte.estado));

/** Los números de arriba de Camiones. */
export function resumenDeCamiones(camiones) {
    const lista = camiones ?? [];
    return {
        camiones: lista.filter(c => c.carga).length,
        unidades: lista.reduce((t, c) => t + (c.lotes ?? []).reduce((s, l) => s + num(l.queda), 0), 0),
        sinNota: lista.filter(c => cargaSinNota(c.carga)).length,
    };
}

/** Lotes en bodega que se pueden cargar: con existencia y que no están ya en un camión. */
export const lotesCargables = (lotes) => (lotes ?? []).filter(l => !l.en_camion_de && num(l.existencia) > 0);

/** Cuántas unidades de un lote ya van en la carga que se está armando. */
export const yaEnLaCarga = (items, loteId) => (items ?? []).filter(i => i.lote_id === Number(loteId)).reduce((t, i) => t + i.unidades, 0);

/**
 * ¿Se pueden cargar `texto` unidades de ese lote? Devuelve `{ n, libre, malo }`:
 * `malo` cuando lo escrito no es un entero positivo o pasa lo libre.
 */
export function validarUnidadesDeCarga(lote, items, texto) {
    const libre = lote ? num(lote.existencia) - yaEnLaCarga(items, lote.id) : 0;
    const n = Number(texto);
    const malo = texto !== '' && (!Number.isInteger(n) || n <= 0 || n > libre);
    return { n, libre, malo };
}

/**
 * La cuenta de la descarga: lo contado por lote contra lo que debería haber.
 * `malos` son los lotes con un número imposible; `faltan` las unidades que no
 * volvieron, y con faltante la nota es obligatoria.
 */
export function cuentaDeDescarga(lotes, contado, nota) {
    const conAlgo = (lotes ?? []).filter(l => num(l.queda) > 0);
    const malos = conAlgo.filter(l => {
        const v = contado[l.lote_id];
        return v === '' || v == null || !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > num(l.queda);
    });
    const faltan = conAlgo.reduce((t, l) => t + Math.max(0, num(l.queda) - (Number(contado[l.lote_id]) || 0)), 0);
    return { conAlgo, malos, faltan, listo: !malos.length && (faltan === 0 || String(nota ?? '').trim() !== '') };
}
