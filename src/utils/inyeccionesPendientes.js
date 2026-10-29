/**
 * Inyecciones pagadas y sin aplicar — cómo se agrupan y se cuentan. Vivía en
 * `TabPendientes`; se mudó el 2026-10-05 para que la app diga lo mismo.
 *
 * Una fila por PAGO y producto (y dosis), no por aplicación: pagó 5 y hoy se
 * aplican 2 → «2 de 5». Cada grupo lleva los ids de sus aplicaciones en el
 * orden de la base, y se marcan aplicadas las PRIMERAS `n`.
 */
import { fechaHora12 } from './hora';
import { shortEmployeeName } from './nameUtils';
import { fmtMl } from './inyeccionDosis';

/** Días enteros desde una fecha (0 si es futura o no hay fecha). */
export const diasDesde = (f, ahora = Date.now()) => (f ? Math.max(0, Math.floor((ahora - new Date(f).getTime()) / 86_400_000)) : 0);

/** `[{ clave, p, ids }]` — `p` es la primera fila del grupo, con los datos del pago. */
export function gruposDePendientes(filas) {
    const m = new Map();
    for (const p of filas || []) {
        const k = `${p.cobro_id}|${p.producto}|${p.dosis_ml ?? ''}`;
        if (!m.has(k)) m.set(k, { clave: k, p, ids: [] });
        m.get(k).ids.push(p.id);
    }
    return [...m.values()];
}

/** Los ids a marcar: de cada grupo, las primeras `cuantas[clave]`. */
export const idsElegidos = (grupos, cuantas) => grupos.flatMap((g) => g.ids.slice(0, cuantas[g.clave] || 0));

/**
 * Las cifras de arriba. `deOtras` cuenta las pagadas en otra sala cuando quien
 * mira sólo ve la suya: se muestran igual —el cliente viene a aplicarse acá
 * aunque haya pagado allá—, pero se avisa cuántas son.
 */
export function resumenDePendientes(filas, salaPropia = null, ahora = Date.now()) {
    const lista = filas || [];
    return {
        aplicaciones: lista.length,
        total: lista.reduce((s, p) => s + Number(p.precio || 0), 0),
        clientes: new Set(lista.map((p) => p.customer_id || p.cliente)).size,
        viejas: lista.filter((p) => diasDesde(p.pagada_at, ahora) >= 7).length,
        deOtras: salaPropia ? lista.filter((p) => p.branch_id !== salaPropia).length : 0,
    };
}

// ── La bitácora de aplicaciones: estado y CSV ────────────────────────────────
// Vivían en `TabBitacora`; se mudaron el 2026-10-15 para que la app filtre y
// descargue lo mismo que el portal.

/** Los estados de una aplicación pagada, para el filtro de la bitácora. */
export const ESTADOS_BITACORA = [
    { value: 'todas',     label: 'Todas' },
    { value: 'APLICADA',  label: 'Aplicadas' },
    { value: 'PENDIENTE', label: 'Pendientes' },
];

export const filtrarBitacora = (filas, estado) => (filas || []).filter((f) => estado === 'todas' || f.estado === estado);

const horaBitacora = (ts) => (ts ? fechaHora12(ts) : '—');
const nombreBitacora = (n) => (n ? shortEmployeeName(n) : '—');
const facturaBitacora = (c) => String(c || '').replace(/^0+/, '');

export const CABECERA_CSV_BITACORA = ['COBRADA', 'SALA', 'ORIGEN', 'FACTURA', 'VENTA DE', 'CLIENTE', 'INYECCION', 'LOTE', 'VENCE', 'PRECIO', 'COBRADA POR', 'VENDIO',
    'ESTADO', 'APLICADA', 'APLICADA POR', 'APLICADA EN'];

/** El vencimiento de la ampolla como viene impreso: «05/2027». */
export const venceDeAmpolla = (v) => (v ? `${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : '');

export function filasCsvBitacora(filas) {
    return (filas || []).map((f) => [
        horaBitacora(f.cobrada_at), f.sala, f.origen === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA', facturaBitacora(f.correlativo), f.venta_sala || '',
        f.cliente || '', f.dosis_ml != null ? `${f.producto} (${fmtMl(f.dosis_ml)} ml)` : f.producto,
        f.lote || '', venceDeAmpolla(f.vence), f.precio, nombreBitacora(f.cobrada_por), f.vendedor ? nombreBitacora(f.vendedor) : '',
        f.estado, f.aplicada_at ? horaBitacora(f.aplicada_at) : '', f.aplicada_por ? nombreBitacora(f.aplicada_por) : '',
        f.aplicada_en || '',
    ]);
}

// ── Subfiltros de la bitácora (2026-10-17) ──────────────────────────────────
// Lo que se escribe en el buscador se puede FIJAR como filtro de un campo, y
// los filtros fijados se suman: «cliente: Ramírez» y después «medicamento:
// Neurobion». El texto que todavía no se fijó cuenta como «todo». Los mismos
// campos los entiende `inyecciones_bitacora_buscar` en la base.
export const CAMPOS_DE_BUSQUEDA_BITACORA = [
    { id: 'cliente', label: 'Cliente' },
    { id: 'medicamento', label: 'Medicamento' },
    { id: 'vendedor', label: 'Vendedor' },
    { id: 'factura', label: 'Factura' },
    { id: 'todo', label: 'Todo' },
];
const rotuloDeCampo = (id) => CAMPOS_DE_BUSQUEDA_BITACORA.find((c) => c.id === id)?.label || 'Todo';

/** Fijar el texto del buscador como filtro de un campo; no repite uno igual. */
export function agregarFiltroDeBitacora(filtros, campo, texto) {
    const t = String(texto || '').trim();
    if (!t) return filtros || [];
    const lista = filtros || [];
    if (lista.some((f) => f.campo === campo && f.texto.toLowerCase() === t.toLowerCase())) return lista;
    return [...lista, { campo, texto: t }];
}

export const quitarFiltroDeBitacora = (filtros, i) => (filtros || []).filter((_, j) => j !== i);

/** Los fijados más el texto suelto del buscador (como «todo»). */
export const filtrosEfectivosDeBitacora = (filtros, texto) =>
    (String(texto || '').trim() ? [...(filtros || []), { campo: 'todo', texto: String(texto).trim() }] : (filtros || []));

export const rotuloDeFiltroDeBitacora = (f) => (f.campo === 'todo' ? `«${f.texto}»` : `${rotuloDeCampo(f.campo)}: ${f.texto}`);
