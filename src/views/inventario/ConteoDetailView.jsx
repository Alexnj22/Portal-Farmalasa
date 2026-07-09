import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, ChevronLeft, Search, Printer, CheckCircle2, ShieldCheck, Loader2,
    Plus, X, Package, FlaskConical,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { supabase } from '../../supabaseClient';
import { printHojaConteo, printResultadosConteo } from '../../utils/conteoInventarioPrint';

const PAGE_SIZE = 50;

const ESTADO_CFG = {
    BORRADOR:    { bg: 'bg-slate-100',  text: 'text-slate-600',   label: 'Borrador' },
    EN_PROGRESO: { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'En Progreso' },
    FINALIZADO:  { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Finalizado' },
    APROBADO:    { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Aprobado' },
    CERRADO:     { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Cerrado' },
};

const FILTRO_PILLS = [
    { key: 'TODOS', label: 'Todos' },
    { key: 'PENDIENTES', label: 'Pendientes' },
    { key: 'DIFERENCIA', label: 'Con diferencia' },
    { key: 'SIN_UBICAR', label: 'Sin ubicar' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};
const fmtMoney = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

function ItemRow({ item, index, editable, onSave }) {
    const [fisico, setFisico] = useState(item.fisico_cantidad ?? '');
    const [nota, setNota] = useState(item.nota ?? '');
    const [saving, setSaving] = useState(false);

    useEffect(() => { setFisico(item.fisico_cantidad ?? ''); setNota(item.nota ?? ''); }, [item.id]);

    const dif = fisico !== '' ? Number(fisico) - item.sistema_cantidad : null;

    const commit = async (extra = {}) => {
        if (!editable) return;
        const nextFisico = fisico === '' ? null : Number(fisico);
        setSaving(true);
        try {
            await onSave(item.id, {
                fisicoCantidad: nextFisico,
                nota: nota.trim() || null,
                estadoItem: extra.estadoItem ?? (nextFisico !== null ? 'CONTADO' : 'PENDIENTE'),
                sistemaCantidad: item.sistema_cantidad,
            });
        } finally {
            setSaving(false);
        }
    };

    const markSinUbicar = () => commit({ estadoItem: 'SIN_UBICAR' });

    return (
        <DataRow index={index}>
            <DataCell className="w-[280px]">
                <div className="flex items-center gap-2">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="font-bold text-slate-800 text-[12px] truncate">{item.product_nombre || `Producto ${item.erp_product_id}`}</p>
                            {item.es_antibiotico && <span className="text-[7px] font-black uppercase text-amber-700 bg-amber-100 border border-amber-200 px-1 py-0.5 rounded shrink-0">Bajo Receta</span>}
                            {item.es_agregado_manual && <span className="text-[7px] font-black uppercase text-teal-700 bg-teal-50 border border-teal-200 px-1 py-0.5 rounded shrink-0">Agregado</span>}
                        </div>
                        <p className="text-[9px] text-slate-400 uppercase tracking-wide truncate">{item.laboratorio_nombre || '—'} {item.presentacion ? `· ${item.presentacion}` : ''}</p>
                    </div>
                </div>
            </DataCell>
            <DataCell hideBelow="md"><span className="text-[11px] text-slate-600 tabular-nums">{item.lote || '—'}</span></DataCell>
            <DataCell align="center" hideBelow="lg"><span className="text-[11px] text-slate-500 tabular-nums">{fmtDate(item.fecha_vencimiento)}</span></DataCell>
            <DataCell align="center"><span className="text-[12px] font-bold text-slate-700 tabular-nums">{item.sistema_cantidad}</span></DataCell>
            <DataCell align="center">
                <input
                    type="number"
                    value={fisico}
                    disabled={!editable}
                    onChange={(e) => setFisico(e.target.value)}
                    onBlur={() => commit()}
                    placeholder="—"
                    className="w-16 text-center text-[12px] font-bold bg-white border border-slate-200 rounded-lg px-1 py-1 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
            </DataCell>
            <DataCell align="center">
                {dif == null ? <span className="text-slate-300">—</span> : (
                    <span className={`text-[12px] font-black tabular-nums ${dif === 0 ? 'text-emerald-600' : dif < 0 ? 'text-red-600' : 'text-blue-600'}`}>{dif > 0 ? `+${dif}` : dif}</span>
                )}
            </DataCell>
            <DataCell hideBelow="lg">
                <input
                    type="text"
                    value={nota}
                    disabled={!editable}
                    onChange={(e) => setNota(e.target.value)}
                    onBlur={() => commit()}
                    placeholder="Nota..."
                    className="w-full text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50"
                />
            </DataCell>
            <DataCell align="center">
                {item.estado_item === 'SIN_UBICAR' ? (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">Sin ubicar</span>
                ) : editable ? (
                    <button onClick={markSinUbicar} disabled={saving} className="text-[9px] font-bold text-slate-400 hover:text-red-500 underline" title="Marcar como no encontrado">No encontrado</button>
                ) : item.estado_item === 'CONTADO' ? (
                    <CheckCircle2 size={14} className="text-emerald-500 mx-auto" />
                ) : <span className="text-slate-300 text-[9px]">Pendiente</span>}
            </DataCell>
        </DataRow>
    );
}

export default function ConteoDetailView() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { showToast } = useToastStore();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const canApprove = hasPermission('conteo_inventario', 'can_approve');

    const fetchConteoDetalle = useStaffStore((s) => s.fetchConteoDetalle);
    const fetchConteoItems = useStaffStore((s) => s.fetchConteoItems);
    const guardarConteoItem = useStaffStore((s) => s.guardarConteoItem);
    const agregarProductoManualConteo = useStaffStore((s) => s.agregarProductoManualConteo);
    const finalizarConteoInventario = useStaffStore((s) => s.finalizarConteoInventario);
    const aprobarConteoInventario = useStaffStore((s) => s.aprobarConteoInventario);
    const fetchTodosLosItemsConteo = useStaffStore((s) => s.fetchTodosLosItemsConteo);

    const [conteo, setConteo] = useState(null);
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [filtro, setFiltro] = useState('TODOS');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [printing, setPrinting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [detalle, itemsPage] = await Promise.all([
                fetchConteoDetalle(id),
                fetchConteoItems(id, { page, pageSize: PAGE_SIZE, search, filtro }),
            ]);
            setConteo(detalle);
            setItems(itemsPage.rows);
            setTotal(itemsPage.total);
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [id, page, search, filtro, fetchConteoDetalle, fetchConteoItems, showToast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [search, filtro]);

    const editable = conteo && ['BORRADOR', 'EN_PROGRESO'].includes(conteo.status);
    const canFinalize = editable && canEdit;
    const canApproveNow = conteo?.status === 'FINALIZADO' && canApprove;
    const hasResults = conteo && ['FINALIZADO', 'APROBADO', 'CERRADO'].includes(conteo.status);

    const handleSaveItem = async (itemId, payload) => {
        await guardarConteoItem(itemId, { ...payload, contadoPor: user?.id });
        setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, fisico_cantidad: payload.fisicoCantidad, nota: payload.nota, estado_item: payload.estadoItem, diferencia: payload.fisicoCantidad != null ? payload.fisicoCantidad - payload.sistemaCantidad : it.diferencia } : it)));
    };

    const handleFinalizar = async () => {
        if (!window.confirm('¿Finalizar el conteo? Los ítems sin contar quedarán marcados como pendientes y ya no se podrán editar cantidades.')) return;
        setBusy(true);
        try {
            await finalizarConteoInventario(id);
            showToast('Conteo finalizado', 'Se calcularon los resultados', 'success');
            await load();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleAprobar = async () => {
        const nota = window.prompt('Nota de aprobación (opcional):', '') ?? '';
        setBusy(true);
        try {
            await aprobarConteoInventario(id, nota);
            showToast('Conteo aprobado', 'Queda cerrado y con firma auditable', 'success');
            await load();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handlePrint = async (kind) => {
        setPrinting(true);
        try {
            const allItems = await fetchTodosLosItemsConteo(id);
            if (kind === 'hoja') printHojaConteo(conteo, allItems, { ciego: false });
            else printResultadosConteo(conteo, allItems, { soloDiferencias: false });
        } catch (err) {
            showToast('Error al imprimir', err.message, 'error');
        } finally {
            setPrinting(false);
        }
    };

    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
    const es = conteo ? (ESTADO_CFG[conteo.status] || ESTADO_CFG.BORRADOR) : null;

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario">
            <div className="p-4 md:p-6 lg:p-8 space-y-6">
                <button onClick={() => navigate('/conteo-inventario')} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-teal-600 transition-colors">
                    <ChevronLeft size={14} /> Volver a Conteos
                </button>

                {conteo && (
                    <div className="bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h2 className="text-[16px] font-black text-slate-800">{conteo.branches?.name}</h2>
                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${es.bg} ${es.text}`}>{es.label}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Iniciado {fmtDate(conteo.created_at?.split('T')[0])} · Alcance: {conteo.scope_type}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => handlePrint('hoja')} disabled={printing} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-teal-300 transition-all disabled:opacity-50">
                                    <Printer size={13} /> Imprimir Hoja
                                </button>
                                {hasResults && (
                                    <button onClick={() => handlePrint('resultados')} disabled={printing} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-teal-300 transition-all disabled:opacity-50">
                                        <Printer size={13} /> Imprimir Resultados
                                    </button>
                                )}
                                {canFinalize && (
                                    <button onClick={handleFinalizar} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50">
                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Finalizar Conteo
                                    </button>
                                )}
                                {canApproveNow && (
                                    <button onClick={handleAprobar} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50">
                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Aprobar
                                    </button>
                                )}
                            </div>
                        </div>

                        {hasResults && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                                <div className="bg-slate-50 rounded-xl px-3 py-2 text-center">
                                    <p className="text-[16px] font-black text-slate-700 tabular-nums">{conteo.total_contados ?? 0}/{conteo.total_items ?? 0}</p>
                                    <p className="text-[8px] uppercase tracking-widest text-slate-400 font-bold">Contados</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl px-3 py-2 text-center">
                                    <p className="text-[16px] font-black text-amber-700 tabular-nums">{conteo.total_diferencias ?? 0}</p>
                                    <p className="text-[8px] uppercase tracking-widest text-amber-500 font-bold">Diferencias</p>
                                </div>
                                <div className="bg-red-50 rounded-xl px-3 py-2 text-center">
                                    <p className="text-[14px] font-black text-red-600 tabular-nums">{fmtMoney(conteo.valor_faltante)}</p>
                                    <p className="text-[8px] uppercase tracking-widest text-red-400 font-bold">Faltante</p>
                                </div>
                                <div className="bg-blue-50 rounded-xl px-3 py-2 text-center">
                                    <p className="text-[14px] font-black text-blue-600 tabular-nums">{fmtMoney(conteo.valor_sobrante)}</p>
                                    <p className="text-[8px] uppercase tracking-widest text-blue-400 font-bold">Sobrante</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center rounded-2xl border border-slate-200/70 bg-white/80 overflow-hidden">
                        {FILTRO_PILLS.map((f, idx) => (
                            <React.Fragment key={f.key}>
                                {idx > 0 && <div className="h-5 w-px bg-slate-100" />}
                                <button onClick={() => setFiltro(f.key)} className={`px-3 py-2 text-[11px] font-semibold transition-all ${filtro === f.key ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                                    {f.label}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 flex-1 min-w-[200px] max-w-[320px]">
                        <Search size={13} className="text-slate-400" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto o lote..." className="flex-1 text-[11px] bg-transparent outline-none" />
                    </div>
                    {editable && canEdit && (
                        <button onClick={() => setShowAddForm((v) => !v)} className="flex items-center gap-1.5 ml-auto px-3 py-2 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-xl hover:bg-teal-100 transition-all">
                            <Plus size={13} /> Agregar Producto/Lote
                        </button>
                    )}
                </div>

                {showAddForm && editable && (
                    <AddManualItemForm
                        onAdd={async (payload) => {
                            await agregarProductoManualConteo(id, payload);
                            setShowAddForm(false);
                            await load();
                        }}
                        onCancel={() => setShowAddForm(false)}
                    />
                )}

                <DataTable
                    columns={[
                        { key: 'producto', label: 'Producto' },
                        { key: 'lote', label: 'Lote' },
                        { key: 'vence', label: 'Vence', align: 'center' },
                        { key: 'sistema', label: 'Sistema', align: 'center' },
                        { key: 'fisico', label: 'Físico', align: 'center' },
                        { key: 'diferencia', label: 'Diferencia', align: 'center' },
                        { key: 'nota', label: 'Nota' },
                        { key: 'estado', label: 'Estado', align: 'center' },
                    ]}
                    loading={loading}
                    empty={{ icon: Package, message: 'Sin ítems para este filtro' }}
                >
                    {items.map((item, i) => (
                        <ItemRow key={item.id} item={item} index={i} editable={editable} onSave={handleSaveItem} />
                    ))}
                </DataTable>

                {total > 0 && (
                    <TablePagination pageSize={PAGE_SIZE} onPageSizeChange={() => {}} page={page} totalPages={totalPages} onPageChange={setPage} total={total} unit="ítems" />
                )}
            </div>
        </GlassViewLayout>
    );
}

function AddManualItemForm({ onAdd, onCancel }) {
    const { showToast } = useToastStore();
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [presentacion, setPresentacion] = useState('');
    const [lote, setLote] = useState('');
    const [fechaVencimiento, setFechaVencimiento] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSearch = async (q) => {
        if (!q || q.trim().length < 2) { setResults([]); return; }
        const { data } = await supabase.from('products').select('id, nombre, laboratorios(nombre)').eq('activo', true).ilike('nombre', `%${q.trim()}%`).order('nombre').limit(30);
        setResults(data || []);
    };

    const handleSubmit = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            const { data: precio } = await supabase.from('product_precios').select('costo').eq('product_id', selected.id).eq('activo', true).order('id').limit(1).maybeSingle();
            await onAdd({
                erpProductId: selected.id,
                presentacion: presentacion.trim() || null,
                lote: lote.trim() || null,
                fechaVencimiento: fechaVencimiento || null,
                costoUnitario: precio?.costo ?? null,
            });
            showToast('Producto agregado', selected.nombre, 'success');
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-teal-50/60 border border-teal-200/70 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-widest text-teal-700 flex items-center gap-1.5"><FlaskConical size={12} /> Producto no listado en el snapshot</p>
                <button onClick={onCancel} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="md:col-span-2">
                    <LiquidSelect value={selected ? String(selected.id) : null} onChange={(val) => setSelected(results.find((p) => String(p.id) === val) || null)} options={results.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleSearch} />
                </div>
                <input value={presentacion} onChange={(e) => setPresentacion(e.target.value)} placeholder="Presentación (ej. CAJA X10)" className="text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
                <input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote" className="text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
            </div>
            <div className="flex items-center gap-2">
                <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} className="text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
                <button onClick={handleSubmit} disabled={!selected || saving} className="ml-auto flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-all">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Agregar al conteo
                </button>
            </div>
        </div>
    );
}
