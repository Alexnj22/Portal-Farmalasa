/**
 * Las colas de Facturación: qué observaciones existen, cuáles se pueden dar
 * por solventadas a mano y cómo se separa lo pendiente de lo ya resuelto.
 * Vivía en `FacturacionView`; se mudó el 2026-10-05 para que la app muestre
 * las mismas colas con la misma regla.
 */

/** El catálogo de observaciones que devuelve `get_invoice_observations`. */
export const OBSERVACIONES = {
    SELLO_INVALIDO:         { label: 'Sello inválido',  variant: 'danger'  },
    RECHAZADA_POR_HACIENDA: { label: 'Rechazada MH',    variant: 'danger'  },
    SIN_CODIGO_VENCIDO:     { label: 'Sin código',      variant: 'warning' },
    ESTADO_DESCONOCIDO:     { label: 'Estado inválido', variant: 'danger'  },
    TIPO_DOC_DESCONOCIDO:   { label: 'Tipo inválido',   variant: 'warning' },
    SIN_CORRELATIVO:        { label: 'Sin correlativo', variant: 'warning' },
    TOTAL_INVALIDO:         { label: 'Total inválido',  variant: 'danger'  },
    SUMA_NO_CUADRA:         { label: 'No cuadra',       variant: 'warning' },
};

// Observaciones que NO se pueden dar por solventadas a mano.
//
// `sales_observation_resolutions` se lleva por `invoice_id` **a secas**, no por
// código: solventar saca la factura de la pestaña ENTERA, con todas sus
// observaciones. Para las siete reglas de forma eso está bien —«ya lo revisé»
// es una respuesta legítima a «la suma no cuadra»—, pero no para una factura
// que Hacienda rechazó y sigue sin sello: ahí «alguien la miró» y «se envió»
// son cosas distintas, y confundirlas es exactamente lo que dejó al
// `0000002848_COF` un año figurando como confirmada después de marcarlo
// solventado.
//
// Esta observación se cierra sola el día que llegue el sello de 40 caracteres,
// que es el único hecho que prueba que entró. Y si la factura ya tenía una
// resolución vieja por otra cosa, vuelve a aparecer igual: la resolución no la
// puede tapar.
export const NO_SOLVENTABLES = new Set(['RECHAZADA_POR_HACIENDA']);

export const esSolventable = (r) => !(r.observaciones || []).some((c) => NO_SOLVENTABLES.has(c));

// Un código que este mapa no conoce NO se oculta: se muestra crudo, en warning.
// Es la misma idea que los catch-alls del RPC — si el servidor empieza a
// reportar una clase nueva, tiene que llegar a la pantalla aunque nadie haya
// tocado el frontend todavía. Ocultarla sería repetir el defecto original.
export const metaObs = (code) => OBSERVACIONES[code] || { label: code, variant: 'warning' };

/**
 * Las observaciones pendientes. Una factura puede tener varias resoluciones
 * (la tabla es append-only); `resoluciones` llega ordenada por `resolved_at`
 * desc. `|| !esSolventable(r)`: una resolución vieja no puede tapar un rechazo
 * de Hacienda que llegó después.
 */
export function observacionesPendientes(rows, resoluciones) {
    const resueltas = new Set((resoluciones || []).map((x) => x.invoice_id));
    return (rows || []).filter((r) => !resueltas.has(r.id) || !esSolventable(r));
}

/** Cuántas pendientes hay de cada observación, de la más frecuente a la menos. */
export function conteoDeObservaciones(pendientes) {
    const m = new Map();
    for (const r of pendientes || []) for (const o of (r.observaciones || [])) m.set(o, (m.get(o) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Lo que sigue en una cola: todo lo que no tiene una resolución por `invoice_id`. */
export function sinResolver(rows, resoluciones, clave = 'invoice_id') {
    const hechas = new Set((resoluciones || []).map((x) => x[clave]));
    return (rows || []).filter((r) => !hechas.has(r.id));
}

/* ── Lo que la pantalla de Facturación decía dentro de la vista del portal ──
 * Mudado el 2026-10-06 para que la app diga exactamente lo mismo. */

/** Las formas de pago que no pasan por la caja y se confirman a mano. */
export const NON_CASH_TYPES = ['tarjeta', 'credito', 'transferencia', 'bitcoin', 'cheque'];

/** Días que le quedan al mes para mandar a Hacienda (0 = último día). */
export function diasQuedanDelMes(ahora) {
    return new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate() - ahora.getDate();
}

/** El tono de esos días: rojo con dos o menos, ámbar hasta cinco. */
export const tonoDeDiasQuedan = (d) => (d <= 2 ? 'danger' : d <= 5 ? 'warning' : 'success');

/**
 * Qué decir después de un envío a Hacienda por lote (`regularizarDte`). Se
 * dice lo que pasó y no «listo»: una corrida que resolvió 3 de 8 no es un
 * éxito, una que resolvió 0 porque no había nada tampoco es un fallo, y si
 * quedó cola hay que decirlo — callarla es lo que hace que un tope se lea como
 * «ya está todo».
 */
export function resumenDeRegularizacion(r) {
    const partes = [`${r.resueltas} de ${r.revisadas}`];
    if (r.fichas_corregidas) partes.push(`${r.fichas_corregidas} ficha${r.fichas_corregidas !== 1 ? 's' : ''} de cliente corregida${r.fichas_corregidas !== 1 ? 's' : ''}`);
    if (r.con_observaciones) partes.push(`${r.con_observaciones} con observaciones de Hacienda`);
    if (r.fallidas)          partes.push(`${r.fallidas} sin resolver`);
    if (r.restantes > 0)     partes.push(`quedan ${r.restantes} para la próxima tanda`);
    return {
        titulo: r.revisadas === 0 ? 'No había nada pendiente'
              : r.restantes > 0 ? 'Tanda enviada a Hacienda'
              : 'Trámite enviado a Hacienda',
        texto: partes.join(' · '),
        tono: (r.fallidas || r.restantes > 0) ? 'warning' : 'success',
    };
}

/** Lo mismo para UNA factura: el motivo de Hacienda palabra por palabra si no entró. */
export function resumenDeRegularizarUna(res, correlativo) {
    if (res.resueltas > 0) {
        const partes = [correlativo];
        if (res.fichas_corregidas) partes.push('se corrigió la ficha del cliente');
        if (res.con_observaciones) partes.push('Hacienda la recibió con observaciones');
        return { titulo: 'Enviado a Hacienda', texto: partes.filter(Boolean).join(' · '), tono: 'success' };
    }
    const fallo = (res.detalle || []).find((d) => !d.ok);
    return { titulo: 'Hacienda no la aceptó', texto: fallo?.error || 'No quedó registrado el motivo.', tono: 'warning' };
}

// ── Saltos de correlativo y campos nulos (pestaña Saltos) ───────────────────
// Lo que decide la pestaña, escrito UNA vez para el portal y la app.

/** La llave de un salto: sala, tipo de documento y el rango. */
export const claveDeSalto = (g) => `${g.branch_id}__${g.tipo_documento}__${g.gap_from}__${g.gap_to}`;

/** Los saltos que nadie ha solventado. */
export function saltosPendientes(gaps, resoluciones) {
    const hechos = new Set((resoluciones || []).map(claveDeSalto));
    return (gaps || []).filter((g) => !hechos.has(claveDeSalto(g)));
}

/** Las resoluciones con su salto al lado; `mes` ('YYYY-MM') limita a las de ese mes. */
export function saltosSolventados(gaps, resoluciones, mes = null) {
    const lista = (resoluciones || []).map((r) => ({
        ...r,
        gap: (gaps || []).find((g) => claveDeSalto(g) === claveDeSalto(r)) || null,
    }));
    return mes ? lista.filter((r) => (r.resolved_at || '').startsWith(mes)) : lista;
}

// Los nulos que son sólo el sello o el código de Hacienda van en Pendiente MH,
// no acá.
const CAMPOS_DE_HACIENDA = new Set(['recibido_mh', 'codigo_generacion']);
export const nuloEsDeHacienda = (n) => (n.campos_nulos || []).every((c) => CAMPOS_DE_HACIENDA.has(c));

/** Los documentos con campos nulos que siguen abiertos (sin resolver y que no son de Hacienda). */
export function nulosPendientes(nulls, idsResueltos) {
    const hechos = idsResueltos instanceof Set ? idsResueltos : new Set(idsResueltos || []);
    return (nulls || []).filter((n) => !hechos.has(n.id) && !nuloEsDeHacienda(n));
}

/** Lo que se escribe al solventar un salto (el portal y la app, iguales). */
export const filaDeSaltoSolventado = (g, comentario, quien) => ({
    branch_id: g.branch_id, tipo_documento: g.tipo_documento, gap_from: g.gap_from, gap_to: g.gap_to,
    comment: String(comentario ?? '').trim() || null, resolved_by: quien || 'Desconocido',
});

/** El correlativo con sus siete cifras, como en el talonario. */
export const correlativo7 = (n) => String(n).padStart(7, '0');
