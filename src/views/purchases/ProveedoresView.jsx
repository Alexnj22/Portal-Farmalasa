import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import { Truck, Tag, Layers, AlertTriangle, X, CheckCircle2, Building2 } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Badge from '../../components/common/Badge';
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
} from '../../data/proveedores';
import FilterBar from '../../components/common/FilterBar';
import { useToastStore } from '../../store/toastStore';

const SIN_CATEGORIA = '__sin_categoria__';
const SIN_MATCH_ERP = '__sin_match__';

// Proveedor con ancho acotado (className hint al <th>) — sin esto, el nombre
// largo estira la columna a su ancho natural y empuja el resto de la tabla
// fuera del viewport (a pedido del usuario, ver también max-w+truncate en las
// celdas de abajo, que es lo que realmente frena el ancho bajo table-layout
// auto). Giro se quita del todo (no solo hideBelow) — no cabía junto al resto.
// `sel` se inyecta desde la vista (necesita el estado de selección para el
// "seleccionar todo"), por eso COLS deja de ser una constante suelta.
const BASE_COLS = [
    { key: 'proveedor',  label: 'Proveedor',  align: 'left', className: 'w-[260px]' },
    { key: 'fiscal',     label: 'NIT / NRC',  align: 'left', hideBelow: 'md' },
    { key: 'tipo',       label: 'Tipo',       align: 'left', hideBelow: 'lg' },
    { key: 'categoria',  label: 'Categoría',  align: 'left' },
    { key: 'match_erp',  label: 'Match ERP',  align: 'left' },
    { key: 'docs',       label: 'Docs',       align: 'right', hideBelow: 'md' },
    { key: 'ultima',     label: 'Última compra', align: 'left', hideBelow: 'lg' },
];

// Tipo de Proveedor real (régimen fiscal, Código Tributario) — derivado
// server-side en get_proveedores_maestro (regimen_fiscal), NO es la clase de
// gasto/costo de la categoría asignada (eso es "Categoría", campo distinto).
const REGIMEN_LABELS = { contribuyente: 'Contribuyente IVA', sujeto_excluido: 'Sujeto Excluido' };

function RegimenCell({ row }) {
    if (!row.regimen_fiscal) return <span className="text-content-3 text-label">—</span>;
    const isExcluido = row.regimen_fiscal === 'sujeto_excluido';
    return (
        <span title={isExcluido ? 'Sin NRC (Art. 119 CT) — no da crédito fiscal; retención de Renta 10% si es persona natural por un servicio (Art. 156 CT)' : 'Tiene NRC — da derecho a crédito fiscal de IVA'}>
            <Badge variant={isExcluido ? 'warning' : 'success'}>{REGIMEN_LABELS[row.regimen_fiscal]}</Badge>
        </span>
    );
}

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
            <span className="text-warning text-label font-bold whitespace-nowrap block">Sin categoría</span>
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

// ── BulkBar — aparece solo con filas seleccionadas ────────────────────────────
// Dos acciones separadas porque hacen cosas distintas: "Aceptar sugerencia" le
// da a cada proveedor LA SUYA; el select le da a todos LA MISMA. El contador
// del botón cuenta solo los seleccionados que tienen sugerencia, así que si
// entra un ambiguo el número no sube y se ve por qué.
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
        return <span className="text-content font-medium text-body-sm truncate max-w-[180px] block" title={row.supplier_nombre}>{row.supplier_nombre}</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-warning shrink-0" title="Sin match con proveedor del ERP" />
            <span className="text-content-3 text-label whitespace-nowrap">Sin match ERP</span>
        </div>
    );
}

// ── ProveedoresView ────────────────────────────────────────────────────────────

export default function ProveedoresView({ openModal }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('proveedores', 'can_edit');

    const [search, setSearch] = useState('');
    const [categoriaId, setCategoriaId] = useState('');
    const [claseFilter, setClaseFilter] = useState('');
    const [activoFilter, setActivoFilter] = useState('activos');

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
            useToastStore.getState().showToast('No se pudieron cargar los proveedores', 'Revisá la conexión e intentá de nuevo.', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);  

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

    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (activoFilter === 'activos' && !r.activo) return false;
            if (activoFilter === 'inactivos' && r.activo) return false;
            if (categoriaId === SIN_CATEGORIA) { if (r.categoria_id) return false; }
            else if (categoriaId && categoriaId !== SIN_MATCH_ERP) { if (String(r.categoria_id) !== String(categoriaId)) return false; }
            if (claseFilter) { if (r.categoria_clase !== claseFilter) return false; }
            if (search && !tokenMatch(search, r.nombre, r.nombre_comercial, r.alias, r.nit, r.dui, r.nrc, r.desc_actividad)) return false;
            return true;
        });
    }, [rows, activoFilter, categoriaId, claseFilter, search]);

    const filteredSinMatch = useMemo(() => {
        if (categoriaId !== SIN_MATCH_ERP) return filtered;
        return filtered.filter(r => !r.supplier_id);
    }, [filtered, categoriaId]);

    useEffect(() => { setPage(1); }, [search, categoriaId, claseFilter, activoFilter]);  

    const sorted = useMemo(() => [...filteredSinMatch].sort((a, b) => a.nombre.localeCompare(b.nombre)), [filteredSinMatch]);
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
            useToastStore.getState().showToast('No se pudo guardar', e.message || 'Intentá de nuevo.', 'error');
        } finally {
            setBulkBusy(false);
        }
    }, [selectedIds, clearSelection, load]);

    const openDetail = (row) => {
        openModal?.('editProveedor', { ...row, categorias, suppliers, canEdit, onSaved: load });
        useStaff.getState().appendAuditLog('PROVEEDORES_VER_DETALLE', String(row.id), { nombre: row.nombre });
    };

    const categoriaFilterOptions = [
        { value: SIN_CATEGORIA, label: '(sin categoría)' },
        { value: SIN_MATCH_ERP, label: '(sin match ERP)' },
        ...categorias.map(c => ({ value: c.id, label: c.nombre })),
    ];
    const claseOptions = [
        { value: 'costo', label: 'Costo' },
        { value: 'gasto_operativo', label: 'Gasto Operativo' },
        { value: 'gasto_admin', label: 'Gasto Admin' },
        { value: 'otro', label: 'Otro' },
    ];

    const filtersContent = (
        <ViewTabBar
            tabs={[]}
            activeTab=""
            onTabChange={() => {}}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por nombre, alias, NIT, NRC…"
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={Truck} title="Proveedores" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">
                {/* Filter pill — vive en el body (regla §17 DESIGN.md) */}
                <div className="flex items-start justify-end gap-3 flex-wrap">
                    <FilterBar
                        onClear={() => { setCategoriaId(''); setClaseFilter(''); setActivoFilter('activos'); }}
                        activeCount={[categoriaId, claseFilter, activoFilter !== 'activos'].filter(Boolean).length}
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

                        <FilterBar.Section active={activoFilter !== 'activos'} onClear={() => setActivoFilter('activos')} label="estado">
                            <div style={{ width: '130px' }}>
                                <LiquidSelect value={activoFilter} onChange={setActivoFilter}
                                    options={[{ value: 'activos', label: 'Activos' }, { value: 'inactivos', label: 'Inactivos' }, { value: 'todos', label: 'Todos' }]}
                                    icon={CheckCircle2} compact bare clearable={false} />
                            </div>
                        </FilterBar.Section>
                    </FilterBar>
                </div>

                <DataTable columns={COLS} loading={loading} empty={{ icon: Truck, message: 'Sin proveedores registrados todavía.' }}>
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
                                        <Building2 size={14} className="text-content-3" strokeWidth={1.8} />
                                    </div>
                                    <div className="min-w-0 max-w-[200px]">
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
                            <DataCell hideBelow="md">
                                <p className="font-mono text-caption text-content-2">{row.nit || row.dui || '—'}</p>
                                {row.nrc && <p className="font-mono text-caption text-content-3">NRC {row.nrc}</p>}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <RegimenCell row={row} />
                            </DataCell>
                            <DataCell>
                                <CategoriaCell row={row} />
                            </DataCell>
                            <DataCell>
                                <MatchErpCell row={row} />
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
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
            </div>
        </GlassViewLayout>
    );
}
