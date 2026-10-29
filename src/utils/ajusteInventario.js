/**
 * Las reglas de PEDIR un ajuste de inventario (cargar o descargar producto de
 * la sala). Vivían privadas en `WidgetInventoryMovement.jsx` y se mudaron acá
 * el 2026-09-30, cuando la app estrenó su propio formulario: escritas dos
 * veces, la primera que cambiara dejaría a una pidiendo lo que la otra no.
 * Puras: no conocen ni React ni el navegador. Los íconos van por NOMBRE.
 */
import { unidadesEnSala } from './unidadesInventario';

export const OPERACIONES_AJUSTE = [
    { key: 'VENCIMIENTO',     movimiento: 'DESCARTE', icono: 'CalendarX2',    tono: 'peligro',
      label: 'Descargar por vencimiento',     desc: 'Producto vencido que se retira de la sala' },
    { key: 'DESCARTE',        movimiento: 'DESCARTE', icono: 'Trash2',        tono: 'aviso',
      label: 'Descargar por descarte',        desc: 'Producto que se retira sin estar vencido' },
    { key: 'PRODUCTO DAÑADO', movimiento: 'DESCARTE', icono: 'AlertTriangle', tono: 'dano',
      label: 'Descargar por daño',            desc: 'Producto roto, golpeado o inservible' },
    { key: 'CONSUMO INTERNO', movimiento: 'DESCARTE', icono: 'Stethoscope',   tono: 'interno',
      label: 'Descargar por consumo interno', desc: 'Usado en inyecciones, curaciones o la sala' },
    { key: 'CARGA',           movimiento: 'CARGA',    icono: 'PackagePlus',   tono: 'exito',
      label: 'Cargar producto',               desc: 'Ingresar existencia que no entró por compra' },
];

export const MOTIVOS_AJUSTE = {
    'DESCARTE': [
        { value: 'CRUCE',       label: 'Cruce de producto' },
        { value: 'DESCUADRE',   label: 'Descuadre de inventario' },
        { value: 'MAL_ESTADO',  label: 'Llegó en mal estado' },
        { value: 'DEVOLUCION',  label: 'Devolución al proveedor' },
        { value: 'RETIRO',      label: 'Retiro sanitario' },
        { value: 'OTRO',        label: 'Otro' },
    ],
    'CONSUMO INTERNO': [
        { value: 'ENFERMERIA',  label: 'Enfermería — inyecciones' },
        { value: 'CURACIONES',  label: 'Curaciones' },
        { value: 'INSUMO',      label: 'Insumo de la sala' },
        { value: 'MUESTRA',     label: 'Muestra o demostración' },
        { value: 'PERSONAL',    label: 'Uso del personal' },
        { value: 'OTRO',        label: 'Otro' },
    ],
};

// Un descuadre no se fotografía, y pedirla ahí sería un trámite vacío.
// Vencimiento entró el 2026-10-29 (usuario): quien aprueba está en otra sala y
// la fecha impresa en el empaque es lo único que prueba que venció. Ese mismo
// día, el descarte «Llegó en mal estado»: es un daño con otro nombre, y sin la
// foto era el atajo para no tomarla.
// Cada caso dice QUÉ tiene que verse en la foto: el rótulo y el aviso de que
// falta salen de acá para el portal y la app.
const FOTO_DANO = {
    titulo: 'Foto del daño', alt: 'Daño', app: 'Fotos del producto dañado (obligatorio)',
    falta: 'Falta la foto: es lo único que quien aprueba puede mirar para saber que el producto está dañado.',
};
const FOTO_DE_AJUSTE = {
    'PRODUCTO DAÑADO': FOTO_DANO,
    'VENCIMIENTO': {
        titulo: 'Foto del vencimiento', alt: 'Vencimiento', app: 'Fotos de la fecha de vencimiento (obligatorio)',
        falta: 'Falta la foto: que se vea la fecha de vencimiento impresa en el empaque.',
    },
};
const FOTO_POR_MOTIVO = {
    'DESCARTE': { 'MAL_ESTADO': FOTO_DANO },
};

/** Los textos de la foto si esta operación —y este motivo— la exigen; si no, `null`. */
export function fotoDeAjuste(opKey, motivo) {
    return FOTO_DE_AJUSTE[opKey] ?? FOTO_POR_MOTIVO[opKey]?.[motivo] ?? null;
}
export const BUCKET_EVIDENCIA = 'inventario-evidencia';
export const MAX_FOTOS_AJUSTE = 3;

/**
 * Lo que le falta a una línea para poder enviarse. Una sola definición para
 * el compositor (¿se habilita «Agregar»?) y el banco (¿qué está incompleto?).
 *
 * `llevaLote` tiene TRES valores en una carga y el tercero no es un detalle:
 * `null` es «todavía no se sabe». En una carga «no se sabe» EXIGE el lote
 * (`!== false`): pedirlo de más cuesta un campo; no pedirlo cuesta una
 * solicitud que el sistema rechaza recién después de aprobada, con el
 * producto ya contado (pasó el 2026-08-12 con AVAMYS). En un descargo el lote
 * se elige de los que la sala tiene: si no hay ninguno, `llevaLote` es `false`.
 */
export function problemasDeLinea(l, { llevaLote, esCarga, esPerecedero }) {
    const problemas = [];
    if (!(Number(l.cantidad) > 0)) problemas.push('cantidad');
    if (!esCarga && excedeLaExistencia(l)) problemas.push('sin existencia');
    const loteObligatorio = esCarga ? llevaLote !== false : llevaLote === true;
    if (loteObligatorio && !String(l.lote ?? '').trim()) problemas.push('lote');
    if (esCarga && (loteObligatorio || esPerecedero) && !String(l.vence ?? '').trim())
        problemas.push('vence');
    return problemas;
}

// `unidadesEnSala` vive en `unidadesInventario` desde el 2026-10-24 y se
// re-exporta acá: la lee `data/inventoryMovements`, y por ella el Inicio
// arrastraba entero este archivo de reglas de ajuste (1.2 kB gzip) para una
// baldosa que sólo cuenta lotes por vencer.
export { unidadesEnSala };

/**
 * ¿La línea pide más de lo que hay? Con `unidadesEnSala` se compara en unidades
 * (`cantidad × factor`): antes se comparaba la cantidad de la línea, en
 * UNIDADES, contra la de una fila en CAJAS, y descargar 3 unidades de 2 cajas
 * ×30 daba «sin existencia · hay 2». `existencia` a secas queda para quien ya
 * la manda en la misma presentación que la línea (la corrección de factor).
 */
function excedeLaExistencia(l) {
    const cant = Number(l.cantidad);
    if (l.unidadesEnSala != null) return cant * (Number(l.factor) || 1) > Number(l.unidadesEnSala);
    return l.existencia != null && cant > Number(l.existencia);
}

/** El tope de la línea en SU presentación, o `null` si no se sabe. */
export function topeDeLinea(l) {
    if (l.unidadesEnSala != null) return Math.floor(Number(l.unidadesEnSala) / (Number(l.factor) || 1));
    return l.existencia ?? null;
}

/**
 * Si el producto lleva control de lote. `null` = no se sabe todavía.
 * Al DESCARGAR la respuesta es si la sala tiene algún lote; al CARGAR es una
 * propiedad del producto (`products.regulado`).
 */
export function llevaControlDeLote(linea, { esCarga, lotes }) {
    if (!esCarga) return (lotes ?? []).length > 0;
    return linea?.regulado ?? null;
}

/**
 * ¿Hace falta escribir la causa? SIEMPRE: la exige la base
 * (`validar_solicitud_movimiento_inventario`: «la solicitud necesita una
 * causa») porque es lo que va al concepto del movimiento y queda en el kardex.
 *
 * Hasta el 2026-09-30 el portal la pedía sólo sin lista de motivos o con
 * «Otro», así que elegir un motivo y dejarla vacía llegaba al servidor y
 * rebotaba. Lo encontró la prueba de la app. El motivo de la lista NO la
 * reemplaza: dice de qué tipo fue, la causa dice qué pasó.
 */
export const causaObligatoria = () => true;

/**
 * La solicitud lista para `insertMovimientoInventario`. `lineas` son las del
 * compositor: `{ erp_product_id, descripcion, tipo, factor, cantidad, lote,
 * vence, existencia }`. A Supervisión le avisa la base, no quien llama.
 */
export function solicitudDeAjuste({ op, motivo, causa, evidencia = [], lineas, usuarioId, sala, aprobador }) {
    const esCarga = op.movimiento === 'CARGA';
    const items = lineas.map(l => ({
        erp_product_id:    l.erp_product_id,
        descripcion:       l.descripcion,
        presentacion_tipo: l.tipo,
        factor:            l.factor,
        cantidad:          Number(l.cantidad),
        lote:              String(l.lote ?? '').trim() || null,
        numero_lote:       String(l.lote ?? '').trim() || null,
        vence:             String(l.vence ?? '').trim() || null,
        existencia:        l.unidadesEnSala ?? l.existencia,
    }));
    const motivos = MOTIVOS_AJUSTE[op.key];
    return {
        employee_id: usuarioId,
        approver_id: aprobador?.id ?? null,
        type: esCarga ? 'INVENTORY_LOAD_REQUEST' : 'INVENTORY_DISCARD_REQUEST',
        status: 'PENDING',
        note: String(causa ?? '').trim(),
        metadata: {
            movimiento: op.movimiento,
            subtipo: esCarga ? undefined : op.key,
            reason: String(causa ?? '').trim(),
            motivo: motivo || undefined,
            motivo_label: motivos?.find(m => m.value === motivo)?.label,
            evidencia_urls: evidencia.length ? evidencia : undefined,
            branch_id: sala.branchId,
            branch_name: sala.nombre,
            erp_sucursal_id: sala.erpSucursalId,
            erp_ubicacion_id: sala.erpUbicacionId,
            items,
            total_unidades: items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
            notified_employee_id: aprobador?.id ?? null,
            notified_employee: aprobador?.name ?? 'Sin supervisión asignada',
        },
    };
}
