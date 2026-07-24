import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { fetchProveedoresMaestro, fetchProveedorCategorias } from '../../data/proveedores';

const SIN_CATEGORIA = '__sin_categoria__';
const SIN_MATCH_ERP = '__sin_match__';

// Proveedor con ancho acotado (className hint al <th>) — sin esto, el nombre
// largo estira la columna a su ancho natural y empuja el resto de la tabla
// fuera del viewport (a pedido del usuario, ver también max-w+truncate en las
// celdas de abajo, que es lo que realmente frena el ancho bajo table-layout
// auto). Giro se quita del todo (no solo hideBelow) — no cabía junto al resto.
const COLS = [
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
    if (!row.regimen_fiscal) return <span className="text-content-3 text-[11px]">—</span>;
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

function CategoriaCell({ row }) {
    return row.categoria_nombre
        ? <span className="text-content-2 text-[12px] font-medium truncate max-w-[160px] block" title={row.categoria_nombre}>{row.categoria_nombre}</span>
        : <span className="text-warning text-[11px] font-bold whitespace-nowrap">Sin categoría</span>;
}

function MatchErpCell({ row }) {
    if (row.supplier_id) {
        return <span className="text-content font-medium text-[12px] truncate max-w-[180px] block" title={row.supplier_nombre}>{row.supplier_nombre}</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-warning shrink-0" title="Sin match con proveedor del ERP" />
            <span className="text-content-3 text-[11px] whitespace-nowrap">Sin match ERP</span>
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

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchProveedoresMaestro();
            setRows(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

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

    useEffect(() => { setPage(1); }, [search, categoriaId, claseFilter, activoFilter]); // eslint-disable-line react-hooks/set-state-in-effect

    const sorted = useMemo(() => [...filteredSinMatch].sort((a, b) => a.nombre.localeCompare(b.nombre)), [filteredSinMatch]);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

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
                    <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-surface-card backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 shrink-0 overflow-visible flex-wrap">
                        <div className="flex items-center">
                            <div className="px-2 py-2 overflow-visible" style={{ width: '190px' }}>
                                <LiquidSelect value={categoriaId} onChange={setCategoriaId}
                                    options={categoriaFilterOptions} placeholder="Categoría" icon={Tag} compact bare />
                            </div>
                            {categoriaId && (
                                <button onClick={() => setCategoriaId('')} title="Quitar categoría"
                                    className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-colors shrink-0">
                                    <X size={9} strokeWidth={3} />
                                </button>
                            )}
                        </div>

                        <div className="h-5 w-px bg-surface-card-hover shrink-0" />

                        <div className="flex items-center">
                            <div className="px-2 py-2 overflow-visible" style={{ width: '160px' }}>
                                <LiquidSelect value={claseFilter} onChange={setClaseFilter}
                                    options={claseOptions} placeholder="Clase" icon={Layers} compact bare />
                            </div>
                            {claseFilter && (
                                <button onClick={() => setClaseFilter('')} title="Quitar clase"
                                    className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-colors shrink-0">
                                    <X size={9} strokeWidth={3} />
                                </button>
                            )}
                        </div>

                        <div className="h-5 w-px bg-surface-card-hover shrink-0" />

                        <div className="flex items-center">
                            <div className="px-2 py-2 overflow-visible" style={{ width: '130px' }}>
                                <LiquidSelect value={activoFilter} onChange={setActivoFilter}
                                    options={[{ value: 'activos', label: 'Activos' }, { value: 'inactivos', label: 'Inactivos' }, { value: 'todos', label: 'Todos' }]}
                                    icon={CheckCircle2} compact bare clearable={false} />
                            </div>
                        </div>
                    </div>
                </div>

                <DataTable columns={COLS} loading={loading} empty={{ icon: Truck, message: 'Sin proveedores registrados todavía.' }}>
                    {pageRows.map((row, i) => (
                        <DataRow key={row.id} index={i} onClick={() => openDetail(row)}>
                            <DataCell>
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-surface-card-hover/80 border border-slate-200/60 flex items-center justify-center shrink-0">
                                        <Building2 size={14} className="text-content-3" strokeWidth={1.8} />
                                    </div>
                                    <div className="min-w-0 max-w-[200px]">
                                        <p className="text-[12px] font-bold text-content-2 truncate" title={row.nombre}>{row.nombre}</p>
                                        {row.alias && (
                                            <p className="text-[10px] text-content-3 truncate italic">&ldquo;{row.alias}&rdquo;</p>
                                        )}
                                        {!row.alias && row.nombre_comercial && row.nombre_comercial !== row.nombre && (
                                            <p className="text-[10px] text-content-3 truncate">{row.nombre_comercial}</p>
                                        )}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <p className="font-mono text-[10px] text-content-2">{row.nit || row.dui || '—'}</p>
                                {row.nrc && <p className="font-mono text-[10px] text-content-3">NRC {row.nrc}</p>}
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
                                <span className="text-content-2 text-[11px] tabular-nums">{fmtDate(row.ultima_vez_visto)}</span>
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
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
