import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, Tag, Layers, AlertTriangle, X, CheckCircle2, Building2 } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidSelect from '../../components/common/LiquidSelect';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { fetchSuppliersBasic } from '../../data/compras';
import { fetchProveedoresMaestro, fetchProveedorCategorias } from '../../data/proveedores';

const SIN_CATEGORIA = '__sin_categoria__';
const SIN_MATCH_ERP = '__sin_match__';

const COLS = [
    { key: 'proveedor',  label: 'Proveedor',  align: 'left' },
    { key: 'fiscal',     label: 'NIT / NRC',  align: 'left', hideBelow: 'md' },
    { key: 'giro',       label: 'Giro',       align: 'left', hideBelow: 'lg' },
    { key: 'categoria',  label: 'Categoría',  align: 'left' },
    { key: 'match_erp',  label: 'Match ERP',  align: 'left' },
    { key: 'docs',       label: 'Docs',       align: 'right', hideBelow: 'md' },
    { key: 'ultima',     label: 'Última compra', align: 'left', hideBelow: 'lg' },
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

function CategoriaCell({ row }) {
    return row.categoria_nombre
        ? <span className="text-slate-700 text-[12px] font-medium">{row.categoria_nombre}</span>
        : <span className="text-amber-600 text-[11px] font-bold">Sin categoría</span>;
}

function MatchErpCell({ row }) {
    if (row.supplier_id) {
        return <span className="text-slate-800 font-medium text-[12px]">{row.supplier_nombre}</span>;
    }
    return (
        <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-amber-500 shrink-0" title="Sin match con proveedor del ERP" />
            <span className="text-slate-500 text-[11px]">Sin match ERP</span>
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
            else if (categoriaId) { if (String(r.categoria_id) !== String(categoriaId)) return false; }
            if (claseFilter) { if (r.categoria_clase !== claseFilter) return false; }
            if (categoriaId === SIN_MATCH_ERP) { /* manejado abajo */ }
            if (search && !tokenMatch(search, r.nombre, r.nombre_comercial, r.nit, r.dui, r.nrc, r.desc_actividad)) return false;
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
            placeholder="Buscar por nombre, NIT, NRC…"
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={Truck} title="Proveedores" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">
                {/* Filter pill — vive en el body (regla §17 DESIGN.md) */}
                <div className="flex items-start justify-end gap-3 flex-wrap">
                    <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 shrink-0 overflow-visible flex-wrap">
                        <div className="flex items-center">
                            <div className="px-2 py-2 overflow-visible" style={{ width: '190px' }}>
                                <LiquidSelect value={categoriaId} onChange={setCategoriaId}
                                    options={categoriaFilterOptions} placeholder="Categoría" icon={Tag} compact bare />
                            </div>
                            {categoriaId && (
                                <button onClick={() => setCategoriaId('')} title="Quitar categoría"
                                    className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-colors shrink-0">
                                    <X size={9} strokeWidth={3} />
                                </button>
                            )}
                        </div>

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

                        <div className="flex items-center">
                            <div className="px-2 py-2 overflow-visible" style={{ width: '160px' }}>
                                <LiquidSelect value={claseFilter} onChange={setClaseFilter}
                                    options={claseOptions} placeholder="Clase" icon={Layers} compact bare />
                            </div>
                            {claseFilter && (
                                <button onClick={() => setClaseFilter('')} title="Quitar clase"
                                    className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-colors shrink-0">
                                    <X size={9} strokeWidth={3} />
                                </button>
                            )}
                        </div>

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

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
                                    <div className="w-8 h-8 rounded-xl bg-slate-100/80 border border-slate-200/60 flex items-center justify-center shrink-0">
                                        <Building2 size={14} className="text-slate-500" strokeWidth={1.8} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[12px] font-bold text-slate-700 truncate">{row.nombre}</p>
                                        {row.nombre_comercial && row.nombre_comercial !== row.nombre && (
                                            <p className="text-[10px] text-slate-500 truncate">{row.nombre_comercial}</p>
                                        )}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <p className="font-mono text-[10px] text-slate-600">{row.nit || row.dui || '—'}</p>
                                {row.nrc && <p className="font-mono text-[10px] text-slate-400">NRC {row.nrc}</p>}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-slate-600 text-[11px] truncate max-w-[220px] block" title={row.desc_actividad}>{row.desc_actividad || '—'}</span>
                            </DataCell>
                            <DataCell>
                                <CategoriaCell row={row} />
                            </DataCell>
                            <DataCell>
                                <MatchErpCell row={row} />
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="tabular-nums font-bold text-slate-700">{row.docs_count}</span>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-slate-600 text-[11px] tabular-nums">{fmtDate(row.ultima_vez_visto)}</span>
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
