import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { Truck, Tag, Layers, AlertTriangle, X, CheckCircle2, Building2, Scale, List, Minus } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidSelect from '../../components/common/LiquidSelect';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { fetchSuppliersBasic } from '../../data/compras';
import Checkbox from '../../components/common/Checkbox';
import {
    fetchProveedoresMaestro, fetchProveedorCategorias,
    setProveedoresCategoriaBulk, applyProveedoresCategoriaSugerida,
    confirmarClasificacionPropuesta, fetchClasificacionFiscalPendiente,
    resolverClasificacionPendiente,
} from '../../data/proveedores';
import PanelDeducibilidad from './PanelDeducibilidad';
import FilterBar from '../../components/common/FilterBar';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';

const SIN_CATEGORIA = '__sin_categoria__';

const TABS = [
    { key: 'listado',       label: 'Listado',              icon: List },
    { key: 'deducibilidad', label: 'Deducibilidad del IVA', icon: Scale },
];

// Proveedor con ancho acotado (className hint al <th>) — sin esto, el nombre
// largo estira la columna a su ancho natural y empuja el resto de la tabla
// fuera del viewport (a pedido del usuario, ver también max-w+truncate en las
// celdas de abajo, que es lo que realmente frena el ancho bajo table-layout
// auto). Giro se quita del todo (no solo hideBelow) — no cabía junto al resto.
// `sel` se inyecta desde la vista (necesita el estado de selección para el
// "seleccionar todo"), por eso COLS deja de ser una constante suelta.
const BASE_COLS = [
    { key: 'proveedor',  label: 'Proveedor',  align: 'left', className: 'w-[260px]', sortable: true },
    // Deducibilidad del IVA. 64px y una palabra de rótulo — el ancho de esta
    // tabla es una restricción real (ya perdió Giro en v2.27.4 y Tipo el
    // 2026-07-29), así que la columna que faltaba no podía ser ancha.
    //
    // Existe porque la v2.584.0 puso el botón de confirmar sin poner el estado:
    // se pedía confirmar algo que no estaba en pantalla. La decisión en tanda se
    // mudó al panel por regla; acá queda lo que la lista sí necesita, que es
    // saber en qué anda cada ficha.
    { key: 'iva',        label: 'IVA',        align: 'center', className: 'w-[64px]' },
    // `2xl`: a 1280 las seis columnas piden 1,015px contra los 884 del marco y
    // **Última compra se sale 131px**. NIT y NRC son identificadores fiscales
    // —contexto de la ficha, no de la lista— y viven completos en el detalle;
    // la fecha de la última compra no se alcanzaba de ninguna forma.
    { key: 'fiscal',     label: 'NIT / NRC',  align: 'left', hideBelow: '2xl' },
    // "Tipo" (régimen fiscal) se quitó de la tabla el 2026-07-29: mostraba el
    // MISMO badge "Contribuyente IVA" en los 99 proveedores (verificado en
    // prod — 99 de 99 tienen NRC), o sea información cero por 175px, en una
    // tabla que ya desbordaba su contenedor. Es la segunda columna que sale
    // por lo mismo, después de Giro en v2.27.4. El dato sigue en el detalle
    // (FormProveedorDetail), donde además explica la consecuencia fiscal, y
    // el día que aparezca un Sujeto Excluido se verá ahí.
    { key: 'categoria',  label: 'Categoría',  align: 'left', sortable: true },
    // Se ocultaba entera con `xl`, incluso a 1440px — o sea, en la pantalla
    // donde se trabaja. Quitar una columna en silencio no es arreglar el ancho.
    // Con `lg` desaparece solo en pantallas donde igual no cabía, y en desktop
    // sigue visible; el match ERP además ya tiene filtro propio (H15) y se ve
    // completo en el detalle.
    { key: 'match_erp',  label: 'Registrado como', align: 'left', hideBelow: 'lg' },
    // `2xl`: a 1440 las siete columnas pedían 1,113px contra los 1,044 del
    // marco y **Última compra se salía 69px**. `Docs` es un conteo y además
    // ordena, así que el dato se sigue alcanzando por el encabezado; la fecha
    // de la última compra no se alcanzaba de ninguna forma.
    { key: 'docs',       label: 'Docs',       align: 'right', hideBelow: '2xl', sortable: true },
    { key: 'ultima',     label: 'Última compra', align: 'left', hideBelow: 'lg', sortable: true },
];

const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return '—';
    return `${day}/${m}/${y}`;
};

// ── CategoriaCell / MatchErpCell — solo lectura; editar vive en el modal
// detalle (FormProveedorDetail), a pedido del usuario 2026-07-18. ───────────

// H5 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): sin categoría, la celda muestra
// lo que el sistema propone según el giro fiscal del DTE — informativo, nunca
// se aplica solo. Los giros ambiguos (supermercados, alimentos, bebidas) no
// traen sugerencia a propósito y lo dicen en gris, no en ámbar: no es un
// problema del dato, es una decisión que le toca al usuario.
function CategoriaCell({ row }) {
    if (row.categoria_nombre) {
        return <span className="text-content-2 text-body-sm font-medium truncate max-w-[160px] block" title={row.categoria_nombre}>{row.categoria_nombre}</span>;
    }
    return (
        <div className="min-w-0">
            <span className="text-warning-text text-label font-bold whitespace-nowrap block">Sin categoría</span>
            {/* max-w acotado y `truncate`: esta tabla ya venía angosta de ancho
                (v2.27.4 le quitó la columna Giro por lo mismo), así que el
                subtexto no puede volver a estirarla. El texto completo vive en
                el title, junto con el giro que justifica la sugerencia. */}
            {row.categoria_sugerida_nombre ? (
                <span className="text-caption text-brand-text truncate block max-w-[132px]" title={`Sugerida: ${row.categoria_sugerida_nombre} — por el giro "${row.desc_actividad || '—'}"`}>
                    Sugerida: {row.categoria_sugerida_nombre}
                </span>
            ) : (
                <span className="text-caption text-content-3 truncate block max-w-[132px]" title={`Giro ambiguo o ausente ("${row.desc_actividad || '—'}") — la categoría la decidís vos`}>
                    Sin sugerencia
                </span>
            )}
        </div>
    );
}

// ── IvaCell — el estado de la clasificación fiscal, en 64px ──────────────────
// Se distingue por FORMA además de color: cuatro marcas de color distinto que
// además son cuatro íconos distintos, para que no dependa de ver el color. El
// texto completo —el artículo, la condición legal, o quién y cuándo la
// confirmó— va en el `title`, que es lo único que cabe a este ancho.
const IVA_MARCAS = {
    confirmada: { Icono: CheckCircle2,  clase: 'text-success-text bg-success/15' },
    propuesta:  { Icono: Scale,         clase: 'text-brand-text bg-brand/15' },
    condicion:  { Icono: AlertTriangle, clase: 'text-warning-text bg-warning/15' },
    sinGiro:    { Icono: Minus,         clase: 'text-content-3 bg-content-3/12' },
};

function IvaCell({ row }) {
    const estado = row.clasificacion_estado;
    // `iva_deducible` es booleano ANULABLE a propósito: NULL es "nadie lo
    // miró", no "no es deducible". Leerlo como false borraría la diferencia
    // que el libro necesita.
    const deducible = row.iva_deducible;

    let clave, titulo;
    if (estado === 'confirmada') {
        clave = 'confirmada';
        titulo = `Confirmada: ${deducible ? 'sí da' : 'no da'} crédito fiscal`
            + (row.clasificado_por_nombre ? ` — por ${row.clasificado_por_nombre}` : '')
            + (row.clasificado_at ? ` el ${fmtDate(row.clasificado_at)}` : '');
    } else if (estado === 'propuesta') {
        clave = 'propuesta';
        titulo = `Propuesta: sí da crédito fiscal — ${row.clasificacion_base_legal || 'derivada del giro'}. Falta confirmarla.`;
    } else if (row.clasificacion_base_legal) {
        clave = 'condicion';
        titulo = `La ley lo condiciona — ${row.clasificacion_base_legal}`
            + (row.clasificacion_nota ? `. ${row.clasificacion_nota}` : '');
    } else {
        clave = 'sinGiro';
        titulo = 'Sin giro registrado en la ficha — no se puede derivar la regla';
    }

    const { Icono, clase } = IVA_MARCAS[clave];
    return (
        <span role="img" aria-label={titulo} title={titulo}
            className={`inline-grid place-items-center w-6 h-6 rounded-lg ${clase}`}>
            <Icono size={14} strokeWidth={2.5} />
        </span>
    );
}

// ── BulkBar — aparece solo con filas seleccionadas ────────────────────────────
// Dos acciones separadas porque hacen cosas distintas: "Aceptar sugerencia" le
// da a cada proveedor LA SUYA; el select le da a todos LA MISMA. El contador
// del botón cuenta solo los seleccionados que tienen sugerencia, así que si
// entra un ambiguo el número no sube y se ve por qué.
//
// ── El botón «Confirmar deducibilidad» se fue de acá (2026-08-13) ───────────
// Lo agregó la v2.584.0 y era el camino a ciegas: contaba 67 propuestas que la
// lista no mostraba. Hoy esa decisión vive en la pestaña «Deducibilidad del
// IVA», agrupada por regla y con la propuesta a la vista. La selección de filas
// queda para lo que se construyó (H5): asignar categoría.
function BulkBar({ count, conSugerencia, categorias, busy, onAceptarSugerencia, onAsignar, onCancelar }) {
    return (
        <div
            data-surface="card"
            data-tono="brand"
            className="sticky bottom-4 z-dropdown mt-4 flex items-center gap-3 flex-wrap px-4 py-3"
        >
            <span className="text-body-sm font-black text-content whitespace-nowrap">
                {count.toLocaleString()} seleccionado{count !== 1 ? 's' : ''}
            </span>
            <span className="w-px h-6 bg-divider" aria-hidden="true" />
            <Button
                size="sm"
                icon={CheckCircle2}
                disabled={busy || conSugerencia === 0}
                title={conSugerencia === 0
                    ? 'Ninguno de los seleccionados tiene sugerencia — asignales una a mano'
                    : `Aplica a cada proveedor la categoría sugerida por su propio giro`}
                onClick={onAceptarSugerencia}
            >
                Aceptar sugerencia ({conSugerencia})
            </Button>
            <div className="w-[210px]">
                <LiquidSelect
                    value=""
                    onChange={onAsignar}
                    options={categorias.map(c => ({ value: c.id, label: c.nombre }))}
                    placeholder={busy ? 'Guardando…' : 'Asignar categoría…'}
                    icon={Tag}
                    compact
                    clearable={false}
                />
            </div>
            <div className="flex-1" />
            <Button variant="ghost" disabled={busy} onClick={onCancelar}>Cancelar</Button>
        </div>
    );
}

function MatchErpCell({ row }) {
    if (row.supplier_id) {
        return <span className="text-content font-medium text-body-sm truncate max-w-[140px] block" title={row.supplier_nombre}>{row.supplier_nombre}</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-warning shrink-0" title="Todavía no está vinculado a un proveedor registrado" />
            <span className="text-content-3 text-label whitespace-nowrap">Sin vincular</span>
        </div>
    );
}

// ── ProveedoresView ────────────────────────────────────────────────────────────

export default function ProveedoresView({ openModal }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('proveedores', 'can_edit');

    const [activeTab, setActiveTab] = useState('listado');
    const [search, setSearch] = useState('');
    const [categoriaId, setCategoriaId] = useState('');
    const [claseFilter, setClaseFilter] = useState('');
    const [activoFilter, setActivoFilter] = useState('activos');
    const [matchErpFilter, setMatchErpFilter] = useState(''); // '' | 'con' | 'sin' (H15)
    // '' | 'sin_confirmar' | 'pendiente' | 'propuesta' | 'confirmada'
    const [fiscalFilter, setFiscalFilter] = useState('');
    const [sortCol, setSortCol] = useState('proveedor');
    const [sortDir, setSortDir] = useState('asc');

    const [rows, setRows] = useState([]);
    const [categorias, setCategorias] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    // H5: selección múltiple para asignar categoría a varios de una. Es el
    // primer patrón de este tipo en el proyecto — si otra vista lo necesita,
    // copiar de acá.
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
    const toggleId = useCallback((id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchProveedoresMaestro();
            setRows(data);
        } catch (e) {
            console.error('ProveedoresView.jsx: ', e);
            useToastStore.getState().showToast('No se pudieron cargar los proveedores', 'Revisa la conexión e intenta de nuevo.', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ── El panel por regla trae SUS PROPIOS datos ────────────────────────────
    // No es una vista distinta de `rows`: necesita el crédito fiscal de cada
    // ficha, que cruza `purchase_dte_documents` y cuesta ~200ms. El listado no
    // tiene por qué pagarlos en cada carga, así que se piden al abrir la
    // pestaña y no antes.
    const [fiscalRows, setFiscalRows] = useState([]);
    const [fiscalLoading, setFiscalLoading] = useState(false);
    const loadFiscal = useCallback(async () => {
        setFiscalLoading(true);
        try {
            setFiscalRows(await fetchClasificacionFiscalPendiente());
        } catch (e) {
            console.error('ProveedoresView.jsx: clasificación fiscal', e);
            useToastStore.getState().showToast('No se pudo cargar la clasificación', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally {
            setFiscalLoading(false);
        }
    }, []);
    useEffect(() => { if (activeTab === 'deducibilidad') loadFiscal(); }, [activeTab, loadFiscal]);

    useEffect(() => {
        fetchProveedorCategorias().then(({ data, error }) => {
            if (error) { console.error('fetchProveedorCategorias:', error.message); return; }
            setCategorias(data || []);
        });
        fetchSuppliersBasic().then(({ data, error }) => {
            if (error) { console.error('fetchSuppliersBasic:', error.message); return; }
            setSuppliers(data || []);
        });
    }, []);

    // H15 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): "(sin match ERP)" vivía
    // como una opción DENTRO del select de Categoría, y para que funcionara
    // hacía falta un segundo filtrado aparte. No es una categoría, y metida ahí
    // no se podía combinar con una categoría real. Ahora es su propia sección
    // del FilterBar y el doble filtrado desaparece.
    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (activoFilter === 'activos' && !r.activo) return false;
            if (activoFilter === 'inactivos' && r.activo) return false;
            if (matchErpFilter === 'sin' && r.supplier_id) return false;
            if (matchErpFilter === 'con' && !r.supplier_id) return false;
            if (categoriaId === SIN_CATEGORIA) { if (r.categoria_id) return false; }
            else if (categoriaId) { if (String(r.categoria_id) !== String(categoriaId)) return false; }
            if (claseFilter) { if (r.categoria_clase !== claseFilter) return false; }
            // 'sin_confirmar' junta propuestas y pendientes a propósito: son las
            // dos que el libro de compras NO puede usar todavía, que es la
            // pregunta que se hace quien viene a esta pantalla.
            if (fiscalFilter === 'sin_confirmar' && r.clasificacion_estado === 'confirmada') return false;
            if (fiscalFilter && fiscalFilter !== 'sin_confirmar' && r.clasificacion_estado !== fiscalFilter) return false;
            if (search && !tokenMatch(search, r.nombre, r.nombre_comercial, r.alias, r.nit, r.dui, r.nrc, r.desc_actividad)) return false;
            return true;
        });
    }, [rows, activoFilter, matchErpFilter, categoriaId, claseFilter, fiscalFilter, search]);

    useEffect(() => { setPage(1); }, [search, categoriaId, claseFilter, activoFilter, matchErpFilter, fiscalFilter]);

    // H16: la tabla no ordenaba por ninguna columna — orden alfabético fijo,
    // contra el estándar del proyecto (DataTable soporta sort desde siempre) y
    // justo en las dos columnas donde más importa: cuántos documentos trae cada
    // proveedor y hace cuánto que no le compramos.
    const sorted = useMemo(() => {
        const dir = sortDir === 'asc' ? 1 : -1;
        const val = (r) => {
            switch (sortCol) {
                case 'docs':      return Number(r.docs_count) || 0;
                case 'ultima':    return r.ultima_vez_visto || '';
                case 'categoria': return (r.categoria_nombre || '').toLowerCase();
                default:          return (r.nombre || '').toLowerCase();
            }
        };
        return [...filtered].sort((a, b) => {
            const av = val(a), bv = val(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            // Desempate estable por nombre — sin esto, dos proveedores con el
            // mismo docs_count bailan de lugar entre renders.
            return (a.nombre || '').localeCompare(b.nombre || '');
        });
    }, [filtered, sortCol, sortDir]);

    const handleSort = useCallback((col) => {
        setSortCol(prev => {
            if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir(col === 'docs' || col === 'ultima' ? 'desc' : 'asc');
            return col;
        });
        setPage(1);
    }, []);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

    // "Seleccionar todo" opera sobre la PÁGINA visible, no sobre los 99: marcar
    // una casilla no debería alcanzar filas que el usuario no está viendo.
    const pageIds = useMemo(() => pageRows.map(r => r.id), [pageRows]);
    const pageAllSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    const pageSomeSelected = pageIds.some(id => selectedIds.has(id));
    const togglePage = useCallback(() => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            const todos = pageIds.length > 0 && pageIds.every(id => next.has(id));
            for (const id of pageIds) { if (todos) next.delete(id); else next.add(id); }
            return next;
        });
    }, [pageIds]);

    // El contador del botón cuenta solo los que TIENEN sugerencia — se calcula
    // sobre todo `rows` y no sobre la página, porque la selección sobrevive al
    // cambio de página.
    const seleccionConSugerencia = useMemo(
        () => rows.filter(r => selectedIds.has(r.id) && r.categoria_sugerida_id).length,
        [rows, selectedIds],
    );

    const COLS = useMemo(() => [
        {
            key: 'sel',
            align: 'left',
            className: 'w-[44px]',
            label: (
                <Checkbox
                    size="sm"
                    checked={pageAllSelected}
                    indeterminate={!pageAllSelected && pageSomeSelected}
                    onChange={togglePage}
                    aria-label={pageAllSelected ? 'Quitar la selección de esta página' : 'Seleccionar los proveedores de esta página'}
                />
            ),
        },
        ...BASE_COLS,
    ], [pageAllSelected, pageSomeSelected, togglePage]);

    const runBulk = useCallback(async (fn, accion, extra) => {
        setBulkBusy(true);
        try {
            const ids = [...selectedIds];
            const cambiados = await fn(ids);
            useStaff.getState().appendAuditLog(accion, null, { seleccionados: ids.length, cambiados, ...extra });
            useToastStore.getState().showToast(
                'Categorías actualizadas',
                cambiados === 0
                    ? 'Ninguno cambió — ya tenían esa categoría.'
                    : `${cambiados} proveedor${cambiados !== 1 ? 'es' : ''} actualizado${cambiados !== 1 ? 's' : ''}.`,
                cambiados === 0 ? 'info' : 'success',
            );
            clearSelection();
            await load();
        } catch (e) {
            console.error('ProveedoresView.jsx: bulk categoría', e);
            useToastStore.getState().showToast('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally {
            setBulkBusy(false);
        }
    }, [selectedIds, clearSelection, load]);

    const openDetail = (row) => {
        openModal?.('editProveedor', { ...row, categorias, suppliers, canEdit, onSaved: load });
        useStaff.getState().appendAuditLog('PROVEEDORES_VER_DETALLE', String(row.id), { nombre: row.nombre });
    };

    // ── Las dos escrituras del panel por regla ──────────────────────────────
    // Las dos recargan las DOS fuentes: `load()` porque el listado muestra el
    // estado en su columna, y `loadFiscal()` porque una regla confirmada tiene
    // que desaparecer del panel. Recargar sólo una dejaría la pantalla
    // contradiciéndose a sí misma.
    const runFiscal = useCallback(async (fn, accion, extra) => {
        setBulkBusy(true);
        try {
            const cambiados = await fn();
            useStaff.getState().appendAuditLog(accion, null, { cambiados, ...extra });
            useToastStore.getState().showToast(
                'Clasificación confirmada',
                cambiados === 0
                    ? 'Ninguna cambió — ya estaban confirmadas.'
                    : `${cambiados} proveedor${cambiados !== 1 ? 'es' : ''} ${cambiados !== 1 ? 'quedan' : 'queda'} con su deducibilidad confirmada.`,
                cambiados === 0 ? 'info' : 'success',
            );
            await Promise.all([load(), loadFiscal()]);
        } catch (e) {
            console.error('ProveedoresView.jsx: clasificación fiscal', e);
            useToastStore.getState().showToast('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally {
            setBulkBusy(false);
        }
    }, [load, loadFiscal]);

    // El panel trae sus propias filas (sin `categorias`/`suppliers`, que el
    // modal necesita), así que la ficha se abre con la del listado.
    const abrirFichaDesdePanel = useCallback((fila) => {
        const row = rows.find(r => r.id === fila.id);
        if (row) openDetail(row);
    }, [rows, categorias, suppliers, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps -- openDetail se redefine en cada render

    const categoriaFilterOptions = [
        { value: SIN_CATEGORIA, label: '(sin categoría)' },
        ...categorias.map(c => ({ value: c.id, label: c.nombre })),
    ];
    const matchErpOptions = [
        { value: 'con', label: 'Vinculados' },
        { value: 'sin', label: 'Sin vincular' },
    ];
    const claseOptions = [
        { value: 'costo', label: 'Costo' },
        { value: 'gasto_operativo', label: 'Gasto operativo' },
        { value: 'gasto_admin', label: 'Gasto admin' },
        { value: 'otro', label: 'Otro' },
    ];

    // `showSearch` sólo en el listado: el buscador filtra filas, y en el panel
    // por regla no hay filas que filtrar —son 12 tarjetas—. Una lupa que no
    // filtra nada es peor que ninguna (es el mismo caso que ViewTabBar ya
    // resuelve cuando no hay `onSearchChange`).
    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por nombre, alias, NIT, NRC…"
            showSearch={activeTab === 'listado'}
        />
    );

    return (
        <GlassViewLayout icon={Truck} title="Proveedores" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">
                {activeTab === 'deducibilidad' ? (
                    <PanelDeducibilidad
                        rows={fiscalRows}
                        loading={fiscalLoading}
                        canEdit={canEdit}
                        busy={bulkBusy}
                        onConfirmarPropuesta={(ids) => runFiscal(
                            () => confirmarClasificacionPropuesta(ids),
                            'PROVEEDORES_CLASIFICACION_FISCAL_BULK',
                            { seleccionados: ids.length },
                        )}
                        onResolver={(ids, c) => runFiscal(
                            () => resolverClasificacionPendiente(ids, c),
                            'PROVEEDORES_RESOLVER_CLASIFICACION',
                            { seleccionados: ids.length, ...c },
                        )}
                        onAbrirFicha={abrirFichaDesdePanel}
                    />
                ) : (<>
                {/* Filter pill — vive en el body (regla §17 DESIGN.md) */}
                <div className="flex items-start justify-end gap-3 flex-wrap">
                    <FilterBar
                        onClear={() => { setCategoriaId(''); setClaseFilter(''); setActivoFilter('activos'); setMatchErpFilter(''); }}
                        activeCount={[categoriaId, claseFilter, activoFilter !== 'activos', matchErpFilter, fiscalFilter].filter(Boolean).length}
                    >
                        <FilterBar.Section active={!!categoriaId} onClear={() => setCategoriaId('')} label="categoría">
                            <div style={{ width: '190px' }}>
                                <LiquidSelect value={categoriaId} onChange={setCategoriaId}
                                    options={categoriaFilterOptions} placeholder="Categoría" icon={Tag} compact bare />
                            </div>
                        </FilterBar.Section>

                        <FilterBar.Section active={!!claseFilter} onClear={() => setClaseFilter('')} label="clase">
                            <div style={{ width: '160px' }}>
                                <LiquidSelect value={claseFilter} onChange={setClaseFilter}
                                    options={claseOptions} placeholder="Clase" icon={Layers} compact bare />
                            </div>
                        </FilterBar.Section>

                        {/* H15: sección propia — antes era una opción dentro de
                            "Categoría", donde no es una categoría y no se podía
                            combinar con una real. */}
                        <FilterBar.Section active={!!matchErpFilter} onClear={() => setMatchErpFilter('')} label="vínculo">
                            <div style={{ width: '165px' }}>
                                <LiquidSelect value={matchErpFilter} onChange={setMatchErpFilter}
                                    options={matchErpOptions} placeholder="Vínculo" icon={Building2} compact bare />
                            </div>
                        </FilterBar.Section>

                        {/* Deducibilidad del IVA (Art. 65). «Falta confirmar»
                            junta propuestas y sin clasificar porque son las dos
                            que el libro de compras todavía no puede usar. */}
                        <FilterBar.Section active={!!fiscalFilter} onClear={() => setFiscalFilter('')} label="IVA">
                            <div style={{ width: '178px' }}>
                                <LiquidSelect value={fiscalFilter} onChange={setFiscalFilter}
                                    options={[
                                        { value: 'sin_confirmar', label: 'Falta confirmar' },
                                        { value: 'propuesta', label: 'Propuestas' },
                                        { value: 'pendiente', label: 'Sin clasificar' },
                                        { value: 'confirmada', label: 'Confirmadas' },
                                    ]}
                                    placeholder="Deducibilidad" icon={Scale} compact bare />
                            </div>
                        </FilterBar.Section>

                        <FilterBar.Section active={activoFilter !== 'activos'} onClear={() => setActivoFilter('activos')} label="estado">
                            <div style={{ width: '130px' }}>
                                <LiquidSelect value={activoFilter} onChange={setActivoFilter}
                                    options={[{ value: 'activos', label: 'Activos' }, { value: 'inactivos', label: 'Inactivos' }, { value: 'todos', label: 'Todos' }]}
                                    icon={CheckCircle2} compact bare clearable={false} />
                            </div>
                        </FilterBar.Section>
                    </FilterBar>
                </div>

                <DataTable columns={COLS} sortKey={sortCol} sortDir={sortDir} onSort={handleSort} loading={loading} empty={{ icon: Truck, message: 'Sin proveedores' }}>
                    {pageRows.map((row, i) => (
                        <DataRow key={row.id} index={i} onClick={() => openDetail(row)}>
                            {/* stopPropagation: la fila entera abre el detalle,
                                así que marcar la casilla no debe abrirlo también. */}
                            <DataCell onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                    size="sm"
                                    checked={selectedIds.has(row.id)}
                                    onChange={() => toggleId(row.id)}
                                    disabled={!canEdit}
                                    aria-label={`Seleccionar ${row.nombre}`}
                                />
                            </DataCell>
                            <DataCell>
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-surface-card-hover/80 border border-divider flex items-center justify-center shrink-0">
                                        <Building2 size={14} className="text-content-3" strokeWidth={2} />
                                    </div>
                                    <div className="min-w-0 max-w-[168px]">
                                        <p className="text-body-sm font-bold text-content-2 truncate" title={row.nombre}>{row.nombre}</p>
                                        {row.alias && (
                                            <p className="text-caption text-content-3 truncate italic">&ldquo;{row.alias}&rdquo;</p>
                                        )}
                                        {!row.alias && row.nombre_comercial && row.nombre_comercial !== row.nombre && (
                                            <p className="text-caption text-content-3 truncate">{row.nombre_comercial}</p>
                                        )}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell align="center">
                                <IvaCell row={row} />
                            </DataCell>
                            <DataCell hideBelow="2xl">
                                <p className="font-mono text-caption text-content-2">{row.nit || row.dui || '—'}</p>
                                {row.nrc && <p className="font-mono text-caption text-content-3">NRC {row.nrc}</p>}
                            </DataCell>
                            <DataCell>
                                <CategoriaCell row={row} />
                            </DataCell>
                            <DataCell>
                                <MatchErpCell row={row} />
                            </DataCell>
                            <DataCell align="right" hideBelow="2xl">
                                <span className="tabular-nums font-bold text-content-2">{row.docs_count}</span>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-content-2 text-label tabular-nums">{fmtDate(row.ultima_vez_visto)}</span>
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
                {canEdit && selectedIds.size > 0 && (
                    <BulkBar
                        count={selectedIds.size}
                        conSugerencia={seleccionConSugerencia}
                        categorias={categorias}
                        busy={bulkBusy}
                        onAceptarSugerencia={() => runBulk(applyProveedoresCategoriaSugerida, 'PROVEEDORES_CATEGORIA_SUGERIDA_BULK')}
                        onAsignar={(categoriaId) => {
                            if (!categoriaId) return;
                            runBulk((ids) => setProveedoresCategoriaBulk(ids, categoriaId), 'PROVEEDORES_CATEGORIA_BULK', { categoria_id: categoriaId });
                        }}
                        onCancelar={clearSelection}
                    />
                )}

                {!loading && sorted.length > 0 && (
                    <TablePagination
                        pageSize={pageSize}
                        onPageSizeChange={setPageSize}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        total={sorted.length}
                        unit="proveedores"
                    />
                )}
                </>)}
            </div>
        </GlassViewLayout>
    );
}
