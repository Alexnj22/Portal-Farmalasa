import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, ChevronLeft, ChevronRight, Search, Printer, CheckCircle2, ShieldCheck, Loader2,
    Plus, X, Package, FlaskConical, History, Radio, Pencil,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { supabase } from '../../supabaseClient';
import { printHojaConteo, printResultadosConteo } from '../../utils/conteoInventarioPrint';

const PAGE_SIZE = 25;

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
];

const COLUMNS = [
    { key: 'producto', label: 'Producto' },
    { key: 'laboratorio', label: 'Laboratorio', hideBelow: 'lg' },
    { key: 'presentacion', label: 'Presentación', align: 'center', hideBelow: 'md' },
    { key: 'lote', label: 'Lote', hideBelow: 'md' },
    { key: 'vence', label: 'Vence', align: 'center', hideBelow: 'lg' },
    { key: 'sistema', label: 'Sistema', align: 'center' },
    { key: 'fisico', label: 'Físico', align: 'center' },
    { key: 'diferencia', label: 'Diferencia', align: 'center' },
    { key: 'nota', label: 'Nota', hideBelow: 'lg' },
    { key: 'estado', label: 'Estado', align: 'center' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};
const fmtMoney = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const fmtDateTime = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const difClass = (dif) => (dif == null ? 'text-slate-300' : dif === 0 ? 'text-emerald-600' : dif < 0 ? 'text-red-600' : 'text-blue-600');
const difLabel = (dif) => (dif == null ? '—' : dif > 0 ? `+${dif}` : String(dif));

// Umbral "próximo a vencer" — mismo valor usado en get_conteo_products_page
// para que el aviso a nivel de grupo (sin expandir) y el de la línea coincidan.
const VENCE_UMBRAL_DIAS = 90;
function vencimientoStatus(fechaVencimiento) {
    if (!fechaVencimiento) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(`${fechaVencimiento}T00:00:00`);
    const diffDias = Math.round((fecha - hoy) / 86400000);
    if (diffDias < 0) return 'VENCIDO';
    if (diffDias <= VENCE_UMBRAL_DIAS) return 'PROXIMO';
    return null;
}
function VencimientoBadge({ status }) {
    if (!status) return null;
    if (status === 'VENCIDO') return <span className="text-[8px] font-black uppercase text-red-700 bg-red-50 border border-red-300 px-1.5 py-0.5 rounded-full shrink-0">Vencido</span>;
    return <span className="text-[8px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded-full shrink-0">Por vencer</span>;
}

// Indicador "en vivo" — animate-pulse de Tailwind usa un único keyframe
// compartido sin animation-delay por instancia, así que todos laten en fase
// (no c/u a su ritmo) y el costo es una sola propiedad opacity por GPU.
function LiveBadge() {
    return (
        <span
            className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-300 px-1.5 py-0.5 rounded-full animate-pulse shrink-0"
            title="En vivo — se actualiza hasta que se cuente"
        >
            <Radio size={9} strokeWidth={3} /> Vivo
        </span>
    );
}

function ItemRow({ item, index, editable, onSave, onShowHistory, onEditLote, currentUserName }) {
    const [fisico, setFisico] = useState(item.fisico_cantidad ?? '');
    const [nota, setNota] = useState(item.nota ?? '');
    const [sistema, setSistema] = useState(item.sistema_cantidad);
    const [contadoPorNombre, setContadoPorNombre] = useState(item.contado_por_nombre ?? null);
    const [contadoAt, setContadoAt] = useState(item.contado_at ?? null);
    const [estadoItem, setEstadoItem] = useState(item.estado_item);
    const [saving, setSaving] = useState(false);
    // Última combinación efectivamente guardada — evita que un blur sin
    // cambios (ej. Tab entre celdas) dispare un guardado/historial redundante.
    const lastSaved = useRef({ fisico: item.fisico_cantidad ?? null, nota: item.nota ?? null, estado: item.estado_item });

    useEffect(() => {
        setFisico(item.fisico_cantidad ?? '');
        setNota(item.nota ?? '');
        setSistema(item.sistema_cantidad);
        setContadoPorNombre(item.contado_por_nombre ?? null);
        setContadoAt(item.contado_at ?? null);
        setEstadoItem(item.estado_item);
        lastSaved.current = { fisico: item.fisico_cantidad ?? null, nota: item.nota ?? null, estado: item.estado_item };
    }, [item.id, item.sistema_cantidad, item.fisico_cantidad]);

    // Estimado inmediato con el "sistema" ya visible (en vivo si aún no se ha
    // contado) — el valor definitivo llega en la respuesta de guardar_conteo_item,
    // que releyó inventory en el instante exacto del guardado.
    const dif = fisico !== '' ? Number(fisico) - sistema : null;
    const isLive = item.fisico_cantidad == null && !item.es_agregado_manual;

    const commit = async () => {
        if (!editable) return;
        const nextFisico = fisico === '' ? null : Number(fisico);
        const nextNota = nota.trim() || null;
        const nextEstado = nextFisico !== null ? 'CONTADO' : 'PENDIENTE';
        const prev = lastSaved.current;
        if (prev.fisico === nextFisico && prev.nota === nextNota && prev.estado === nextEstado) return;
        setSaving(true);
        try {
            const result = await onSave(item.id, {
                fisicoCantidad: nextFisico,
                nota: nextNota,
                estadoItem: nextEstado,
            });
            lastSaved.current = { fisico: nextFisico, nota: nextNota, estado: nextEstado };
            setSistema(result.sistema_cantidad);
            setEstadoItem(nextEstado);
            setContadoPorNombre(currentUserName);
            setContadoAt(new Date().toISOString());
        } finally {
            setSaving(false);
        }
    };

    const handleFisicoKeyDown = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const inputs = Array.from(document.querySelectorAll('input[data-fisico-input="true"]'));
        const idx = inputs.indexOf(e.currentTarget);
        const next = e.key === 'ArrowDown' ? inputs[idx + 1] : inputs[idx - 1];
        if (next) { next.focus(); next.select(); }
    };

    return (
        <DataRow index={index} className="bg-slate-50/30">
            <DataCell><span className="text-slate-300 text-[11px]">↳</span></DataCell>
            <DataCell hideBelow="lg" />
            <DataCell align="center" hideBelow="md"><span className="text-[11px] font-semibold text-slate-600">{item.presentacion || '—'}</span></DataCell>
            <DataCell hideBelow="md">
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-600 tabular-nums">{item.lote || '—'}</span>
                    {editable && (
                        <button onClick={() => onEditLote(item)} disabled={saving} className="text-slate-300 hover:text-teal-600 transition-colors shrink-0" title="Corregir lote/vencimiento">
                            <Pencil size={10} />
                        </button>
                    )}
                </div>
            </DataCell>
            <DataCell align="center" hideBelow="lg">
                <div className="flex items-center justify-center gap-1">
                    <span className="text-[11px] text-slate-500 tabular-nums">{fmtDate(item.fecha_vencimiento)}</span>
                    <VencimientoBadge status={vencimientoStatus(item.fecha_vencimiento)} />
                </div>
            </DataCell>
            <DataCell align="center">
                <div className="flex items-center justify-center gap-1.5">
                    <span className="text-[12px] font-bold text-slate-700 tabular-nums">{sistema}</span>
                    {isLive && <LiveBadge />}
                </div>
            </DataCell>
            <DataCell align="center">
                <input
                    type="number"
                    data-fisico-input="true"
                    value={fisico}
                    disabled={!editable}
                    onChange={(e) => setFisico(e.target.value)}
                    onBlur={commit}
                    onKeyDown={handleFisicoKeyDown}
                    placeholder="—"
                    className="w-16 text-center text-[12px] font-bold bg-white border border-slate-200 rounded-lg px-1 py-1 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
            </DataCell>
            <DataCell align="center">
                <span className={`text-[12px] font-black tabular-nums ${difClass(dif)}`}>{difLabel(dif)}</span>
            </DataCell>
            <DataCell hideBelow="lg">
                <input
                    type="text"
                    value={nota}
                    disabled={!editable}
                    onChange={(e) => setNota(e.target.value)}
                    onBlur={commit}
                    placeholder="Nota..."
                    className="w-full text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-50"
                />
            </DataCell>
            <DataCell align="center">
                <div className="flex flex-col items-center gap-0.5">
                    {!editable && (estadoItem === 'CONTADO' ? <CheckCircle2 size={14} className="text-emerald-500" /> : <span className="text-slate-300 text-[9px]">Pendiente</span>)}
                    {contadoPorNombre && (
                        <button onClick={() => onShowHistory(item)} className="flex items-center gap-1 text-[8px] font-semibold text-slate-400 hover:text-teal-600 transition-colors" title={`Contado por ${contadoPorNombre} · ${fmtDateTime(contadoAt)} — ver historial`}>
                            <History size={9} /> {contadoPorNombre}
                        </button>
                    )}
                </div>
            </DataCell>
        </DataRow>
    );
}

function ProductGroupRow({ product, index, expanded, onToggle }) {
    const dif = product.diferencia_total;
    return (
        <DataRow index={index} onClick={onToggle} className="cursor-pointer">
            <DataCell className="w-[280px]">
                <div className="flex items-center gap-2">
                    <ChevronRight size={14} className={`text-slate-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className="font-bold text-slate-800 text-[12px] truncate">{product.product_nombre || `Producto ${product.erp_product_id}`}</p>
                            {product.es_antibiotico && <span className="text-[7px] font-black uppercase text-amber-700 bg-amber-100 border border-amber-200 px-1 py-0.5 rounded shrink-0">Bajo Receta</span>}
                        </div>
                    </div>
                </div>
            </DataCell>
            <DataCell hideBelow="lg"><span className="text-[11px] text-slate-500 truncate">{product.laboratorio_nombre || '—'}</span></DataCell>
            <DataCell align="center" hideBelow="md">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{product.item_count} lote{product.item_count === 1 ? '' : 's'}</span>
            </DataCell>
            <DataCell hideBelow="md" />
            <DataCell align="center" hideBelow="lg">
                <div className="flex items-center justify-center gap-1">
                    {product.con_vencidos_count > 0 && <VencimientoBadge status="VENCIDO" />}
                    {product.con_proximos_count > 0 && <VencimientoBadge status="PROXIMO" />}
                </div>
            </DataCell>
            <DataCell align="center"><span className="text-[12px] font-black text-slate-700 tabular-nums">{product.sistema_total}</span></DataCell>
            <DataCell align="center"><span className="text-[12px] font-black text-slate-700 tabular-nums">{product.fisico_total ?? '—'}</span></DataCell>
            <DataCell align="center"><span className={`text-[12px] font-black tabular-nums ${difClass(dif)}`}>{difLabel(dif)}</span></DataCell>
            <DataCell hideBelow="lg" />
            <DataCell align="center">
                <span className={`text-[10px] font-bold tabular-nums ${product.contados_count >= product.item_count ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {product.contados_count}/{product.item_count}
                </span>
            </DataCell>
        </DataRow>
    );
}

function ItemHistoryModal({ item, onClose }) {
    const fetchConteoItemHistory = useStaffStore((s) => s.fetchConteoItemHistory);
    const [history, setHistory] = useState(null);

    useEffect(() => {
        if (!item) return;
        setHistory(null);
        fetchConteoItemHistory(item.id).then(setHistory);
    }, [item, fetchConteoItemHistory]);

    return (
        <LiquidModal open={!!item} onClose={onClose} maxWidth="max-w-lg">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-white/40 flex items-center justify-between relative z-10">
                <div>
                    <h3 className="font-black text-slate-800 text-[15px]">{item?.product_nombre}</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Historial de conteo · {item?.lote || 'sin lote'}</p>
                </div>
                <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto relative z-10">
                {history === null ? (
                    <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
                ) : history.length === 0 ? (
                    <p className="text-[12px] text-slate-400 text-center py-8">Sin registros todavía.</p>
                ) : (
                    <div className="space-y-2">
                        {history.map((h) => (
                            <div key={h.id} className="bg-slate-50 rounded-xl p-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-bold text-slate-700">{h.contado_por_nombre || 'Desconocido'}</p>
                                    <p className="text-[9px] text-slate-400">{fmtDateTime(h.contado_at)}</p>
                                    {h.nota && <p className="text-[10px] text-slate-500 italic mt-0.5">"{h.nota}"</p>}
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-[11px] font-bold text-slate-700 tabular-nums">Sist. {h.sistema_cantidad} · Fís. {h.fisico_cantidad ?? '—'}</p>
                                    {h.diferencia != null && (
                                        <p className={`text-[10px] font-black tabular-nums ${difClass(h.diferencia)}`}>{difLabel(h.diferencia)}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </LiquidModal>
    );
}

function EditLoteModal({ item, onClose, onSave }) {
    const [lote, setLote] = useState('');
    const [fecha, setFecha] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!item) return;
        setLote(item.lote || '');
        setFecha(item.fecha_vencimiento || '');
    }, [item]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(item.id, { lote: lote.trim() || null, fechaVencimiento: fecha || null });
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={!!item} onClose={onClose} maxWidth="max-w-sm">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-white/40 flex items-center justify-between relative z-10">
                <div>
                    <h3 className="font-black text-slate-800 text-[15px]">Corregir lote</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold truncate max-w-[220px]">{item?.product_nombre}</p>
                </div>
                <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-3 relative z-10">
                <p className="text-[11px] text-slate-500">Usa esto cuando el lote físico encontrado no corresponde al de este renglón (ej. el ERP aún no sincronizó el lote nuevo). Solo corrige la etiqueta de este conteo — no modifica el inventario real.</p>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1 block">Lote</label>
                    <input type="text" value={lote} onChange={(e) => setLote(e.target.value)} className="w-full text-[12px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1 block">Fecha de vencimiento</label>
                    <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full text-[12px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
                </div>
                <button onClick={handleSave} disabled={saving} className="mt-2 flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] font-bold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-all">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Guardar corrección
                </button>
            </div>
        </LiquidModal>
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
    const fetchConteoProductsPage = useStaffStore((s) => s.fetchConteoProductsPage);
    const fetchConteoProductItems = useStaffStore((s) => s.fetchConteoProductItems);
    const guardarConteoItem = useStaffStore((s) => s.guardarConteoItem);
    const editarLoteConteoItem = useStaffStore((s) => s.editarLoteConteoItem);
    const agregarProductoManualConteo = useStaffStore((s) => s.agregarProductoManualConteo);
    const finalizarConteoInventario = useStaffStore((s) => s.finalizarConteoInventario);
    const aprobarConteoInventario = useStaffStore((s) => s.aprobarConteoInventario);
    const fetchTodosLosItemsConteo = useStaffStore((s) => s.fetchTodosLosItemsConteo);

    const [conteo, setConteo] = useState(null);
    const [products, setProducts] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [search, setSearch] = useState('');
    const [filtro, setFiltro] = useState('TODOS');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [historyItem, setHistoryItem] = useState(null);
    const [editLoteItem, setEditLoteItem] = useState(null);
    const [expanded, setExpanded] = useState({});
    const [itemsByProduct, setItemsByProduct] = useState({});
    const [loadingExpand, setLoadingExpand] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [detalle, productsPage] = await Promise.all([
                fetchConteoDetalle(id),
                fetchConteoProductsPage(id, { page, pageSize: PAGE_SIZE, search, filtro }),
            ]);
            setConteo(detalle);
            setProducts(productsPage.rows);
            setTotal(productsPage.total);
            setExpanded({});
            setItemsByProduct({});
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [id, page, search, filtro, fetchConteoDetalle, fetchConteoProductsPage, showToast]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [search, filtro]);

    const editable = conteo && ['BORRADOR', 'EN_PROGRESO'].includes(conteo.status);
    const canFinalize = editable && canEdit;
    const canApproveNow = conteo?.status === 'FINALIZADO' && canApprove;
    const hasResults = conteo && ['FINALIZADO', 'APROBADO', 'CERRADO'].includes(conteo.status);

    const toggleExpand = async (product) => {
        const key = product.erp_product_id;
        if (expanded[key]) { setExpanded((prev) => ({ ...prev, [key]: false })); return; }
        setExpanded((prev) => ({ ...prev, [key]: true }));
        if (itemsByProduct[key]) return;
        setLoadingExpand((prev) => ({ ...prev, [key]: true }));
        try {
            const rows = await fetchConteoProductItems(id, key);
            setItemsByProduct((prev) => ({ ...prev, [key]: rows }));
        } catch (err) {
            showToast('Error', err.message, 'error');
            setExpanded((prev) => ({ ...prev, [key]: false }));
        } finally {
            setLoadingExpand((prev) => ({ ...prev, [key]: false }));
        }
    };

    // Recalcula los totales agregados del producto a partir de sus líneas ya
    // en memoria — evita un refetch de la página de productos por cada guardado.
    const recomputeProductTotals = (erpProductId, lines) => {
        const item_count = lines.length;
        const contados_count = lines.filter((l) => l.estado_item !== 'PENDIENTE').length;
        const con_diferencia_count = lines.filter((l) => l.diferencia != null && l.diferencia !== 0).length;
        const sistema_total = lines.reduce((sum, l) => sum + (l.sistema_cantidad ?? 0), 0);
        const contadas = lines.filter((l) => l.fisico_cantidad != null);
        const fisico_total = contadas.length ? contadas.reduce((sum, l) => sum + l.fisico_cantidad, 0) : null;
        const diferencia_total = contadas.length ? contadas.reduce((sum, l) => sum + (l.diferencia ?? 0), 0) : null;
        setProducts((prev) => prev.map((p) => (p.erp_product_id === erpProductId ? {
            ...p, item_count, contados_count, con_diferencia_count, sistema_total, fisico_total, diferencia_total,
        } : p)));
    };

    const handleSaveItem = async (itemId, payload, erpProductId) => {
        const result = await guardarConteoItem(itemId, payload);
        setItemsByProduct((prev) => {
            const lines = (prev[erpProductId] || []).map((it) => (it.id === itemId ? {
                ...it,
                fisico_cantidad: payload.fisicoCantidad,
                nota: payload.nota,
                estado_item: payload.estadoItem,
                sistema_cantidad: result.sistema_cantidad,
                diferencia: result.diferencia,
                contado_por_nombre: user?.name || it.contado_por_nombre,
                contado_at: new Date().toISOString(),
            } : it));
            recomputeProductTotals(erpProductId, lines);
            return { ...prev, [erpProductId]: lines };
        });
        return result;
    };

    const handleEditLote = async (itemId, payload, erpProductId) => {
        const result = await editarLoteConteoItem(itemId, payload);
        setItemsByProduct((prev) => ({
            ...prev,
            [erpProductId]: (prev[erpProductId] || []).map((it) => (it.id === itemId ? { ...it, lote: result.lote, fecha_vencimiento: result.fecha_vencimiento } : it)),
        }));
        showToast('Lote corregido', 'Se actualizó la etiqueta del renglón', 'success');
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

    const filtersContent = (
        <div className="flex items-center bg-white/40 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchActive ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
                <Search size={18} className="text-[#0052CC] shrink-0" strokeWidth={2.5} />
                <input
                    ref={(el) => { if (el && isSearchActive) setTimeout(() => el.focus(), 100); }}
                    type="text"
                    placeholder="Buscar producto, laboratorio o lote..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[14px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                {search && <button onClick={() => setSearch("")} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                <button onClick={() => { setIsSearchActive(false); setSearch(""); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white/60 hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2 border border-white"><ChevronRight size={18} strokeWidth={2.5} /></button>
            </div>
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchActive ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-2 gap-3"}`}>
                <button
                    onClick={() => setIsSearchActive(true)}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
                    title="Buscar producto, laboratorio o lote"
                >
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {search && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario" filtersContent={filtersContent}>
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
                    {editable && canEdit && (
                        <button onClick={() => setShowAddForm((v) => !v)} className="flex items-center gap-1.5 ml-auto px-3 py-2 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-xl hover:bg-teal-100 transition-all">
                            <Plus size={13} /> Agregar Producto/Lote
                        </button>
                    )}
                </div>

                {showAddForm && editable && conteo && (
                    <AddManualItemForm
                        conteoId={id}
                        branchId={conteo.branch_id}
                        onAdd={async (payload) => {
                            await agregarProductoManualConteo(id, payload);
                            setShowAddForm(false);
                            await load();
                        }}
                        onCancel={() => setShowAddForm(false)}
                    />
                )}

                <DataTable columns={COLUMNS} loading={loading} empty={{ icon: Package, message: 'Sin productos para este filtro' }}>
                    {products.map((product, i) => {
                        const key = product.erp_product_id;
                        const isExpanded = !!expanded[key];
                        const lines = itemsByProduct[key];
                        return (
                            <React.Fragment key={key}>
                                <ProductGroupRow product={product} index={i} expanded={isExpanded} onToggle={() => toggleExpand(product)} />
                                {isExpanded && loadingExpand[key] && (
                                    <tr><td colSpan={COLUMNS.length} className="py-4 text-center"><Loader2 size={16} className="animate-spin text-slate-400 inline" /></td></tr>
                                )}
                                {isExpanded && lines && lines.map((item, j) => (
                                    <ItemRow
                                        key={item.id}
                                        item={item}
                                        index={j}
                                        editable={editable}
                                        onSave={(itemId, payload) => handleSaveItem(itemId, payload, key)}
                                        onShowHistory={setHistoryItem}
                                        onEditLote={setEditLoteItem}
                                        currentUserName={user?.name}
                                    />
                                ))}
                            </React.Fragment>
                        );
                    })}
                </DataTable>

                {total > 0 && (
                    <TablePagination pageSize={PAGE_SIZE} onPageSizeChange={() => {}} page={page} totalPages={totalPages} onPageChange={setPage} total={total} unit="productos" />
                )}
            </div>

            <ItemHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
            <EditLoteModal
                item={editLoteItem}
                onClose={() => setEditLoteItem(null)}
                onSave={(itemId, payload) => handleEditLote(itemId, payload, editLoteItem?.erp_product_id)}
            />
        </GlassViewLayout>
    );
}

function AddManualItemForm({ conteoId, branchId, onAdd, onCancel }) {
    const { showToast } = useToastStore();
    const fetchConteoExistingProductIds = useStaffStore((s) => s.fetchConteoExistingProductIds);
    const [existingIds, setExistingIds] = useState([]);
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [presentacionOpts, setPresentacionOpts] = useState([]);
    const [presentacion, setPresentacion] = useState('');
    const [loteOpts, setLoteOpts] = useState([]);
    const [lote, setLote] = useState('');
    const [loteOtro, setLoteOtro] = useState('');
    const [fechaVencimiento, setFechaVencimiento] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchConteoExistingProductIds(conteoId).then(setExistingIds);
    }, [conteoId, fetchConteoExistingProductIds]);

    const handleSearch = async (q) => {
        if (!q || q.trim().length < 2) { setResults([]); return; }
        const { data } = await supabase.from('products').select('id, nombre, laboratorios(nombre)').eq('activo', true).ilike('nombre', `%${q.trim()}%`).order('nombre').limit(30);
        setResults((data || []).filter((p) => !existingIds.includes(p.id)));
    };

    const handleSelectProduct = async (val) => {
        const found = results.find((p) => String(p.id) === val) || null;
        setSelected(found);
        setPresentacion('');
        setLote('');
        setLoteOtro('');
        setFechaVencimiento('');
        setPresentacionOpts([]);
        setLoteOpts([]);
        if (!found) return;

        const [{ data: precios }, { data: erpMap }] = await Promise.all([
            supabase.from('product_precios').select('id_presentacion, presentaciones(tipo)').eq('product_id', found.id).eq('activo', true),
            supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', branchId),
        ]);
        const tipos = [...new Set((precios || []).map((p) => p.presentaciones?.tipo).filter(Boolean))];
        setPresentacionOpts(tipos.map((t) => ({ value: t, label: t })));

        const erpIds = (erpMap || []).map((m) => m.erp_sucursal_id);
        if (erpIds.length) {
            const { data: lotes } = await supabase.from('inventory').select('lote, fecha_vencimiento').eq('erp_product_id', found.id).in('erp_sucursal_id', erpIds).not('lote', 'is', null);
            const seen = new Map();
            (lotes || []).forEach((l) => { if (!seen.has(l.lote)) seen.set(l.lote, l.fecha_vencimiento); });
            setLoteOpts(Array.from(seen.entries()).map(([value, fecha]) => ({ value, fecha })));
        }
    };

    const handleSelectLote = (val) => {
        setLote(val);
        if (val === '__OTRO__') { setFechaVencimiento(''); return; }
        const match = loteOpts.find((l) => l.value === val);
        setFechaVencimiento(match?.fecha || '');
    };

    const finalLote = lote === '__OTRO__' ? loteOtro.trim() : lote;
    const canSubmit = selected && presentacion && finalLote;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const { data: precio } = await supabase.from('product_precios').select('costo').eq('product_id', selected.id).eq('activo', true).order('id').limit(1).maybeSingle();
            await onAdd({
                erpProductId: selected.id,
                presentacion,
                lote: finalLote,
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="md:col-span-3">
                    <LiquidSelect value={selected ? String(selected.id) : null} onChange={handleSelectProduct} options={results.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleSearch} />
                </div>
                <LiquidSelect value={presentacion || null} onChange={setPresentacion} options={presentacionOpts} placeholder={selected ? 'Presentación...' : 'Elige un producto primero'} disabled={!selected} clearable={false} />
                <LiquidSelect
                    value={lote || null}
                    onChange={handleSelectLote}
                    options={[...loteOpts.map((l) => ({ value: l.value, label: l.value })), { value: '__OTRO__', label: '+ Otro lote (nuevo)' }]}
                    placeholder={selected ? 'Lote...' : 'Elige un producto primero'}
                    disabled={!selected}
                    clearable={false}
                />
                {lote === '__OTRO__' && (
                    <input value={loteOtro} onChange={(e) => setLoteOtro(e.target.value)} placeholder="Número de lote nuevo" className="text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400" />
                )}
            </div>
            <div className="flex items-center gap-2">
                <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1 block">Vencimiento</label>
                    <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} disabled={lote !== '__OTRO__'} className="text-[11px] bg-white border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-teal-400 disabled:bg-slate-100 disabled:text-slate-400" />
                </div>
                <button onClick={handleSubmit} disabled={!canSubmit || saving} className="ml-auto flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40 transition-all">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Agregar al conteo
                </button>
            </div>
        </div>
    );
}
