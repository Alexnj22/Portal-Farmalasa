import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock, FileCheck2, Search, X } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import NuevoConteoModal from '../components/inventario/NuevoConteoModal';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';

const ESTADO_CFG = {
    BORRADOR:    { bg: 'bg-slate-100',  text: 'text-slate-600',  border: 'border-slate-200',  icon: Clock,       label: 'Borrador' },
    EN_PROGRESO: { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  icon: Clock,       label: 'En Progreso' },
    FINALIZADO:  { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   icon: FileCheck2,  label: 'Finalizado' },
    APROBADO:    { bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200',icon: CheckCircle2,label: 'Aprobado' },
    CERRADO:     { bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200',icon: CheckCircle2,label: 'Cerrado' },
};

const SCOPE_LABEL = { TOTAL: 'Total', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta', MANUAL: 'Manual' };

const COLS = [
    { key: 'fecha', label: 'Fecha', align: 'left' },
    { key: 'sucursal', label: 'Sucursal', align: 'left' },
    { key: 'alcance', label: 'Alcance', align: 'left', hideBelow: 'md' },
    { key: 'items', label: 'Ítems', align: 'center', hideBelow: 'md' },
    { key: 'diferencias', label: 'Diferencias', align: 'center' },
    { key: 'valor', label: 'Valor Neto', align: 'right', hideBelow: 'lg' },
    { key: 'estado', label: 'Estado', align: 'center' },
    { key: 'acciones', label: '', align: 'right' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtMoney = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`;

export default function ConteoInventarioView() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const conteos = useStaffStore((s) => s.conteosInventario);
    const loading = useStaffStore((s) => s.conteosInventarioLoading);
    const fetchConteosInventario = useStaffStore((s) => s.fetchConteosInventario);

    const [isSearchActive, setIsSearchActive] = useState(false);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);

    useEffect(() => { fetchConteosInventario(); }, [fetchConteosInventario]);

    const filtered = useMemo(() => {
        if (!search.trim()) return conteos;
        const term = search.trim().toLowerCase();
        return conteos.filter((c) => (c.branches?.name || '').toLowerCase().includes(term));
    }, [conteos, search]);

    const filtersContent = (
        <div className="flex items-center bg-white/40 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">

            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchActive ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
                <Search size={18} className="text-[#0052CC] shrink-0" strokeWidth={2.5} />
                <input
                    ref={(el) => { if (el && isSearchActive) setTimeout(() => el.focus(), 100); }}
                    type="text"
                    placeholder="Buscar por sucursal..."
                    className="flex-1 bg-transparent border-none outline-none text-[16px] md:text-[16px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                {search && <button onClick={() => setSearch("")} className="p-1 text-slate-500 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
                <button onClick={() => { setIsSearchActive(false); setSearch(""); }} className="w-11 h-11 rounded-full bg-white/60 hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2 border border-white"><ChevronRight size={18} strokeWidth={2.5} /></button>
            </div>

            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchActive ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-2 gap-3"}`}>
                {canEdit && (
                    <div className="flex items-center gap-2 md:gap-3 shrink-0 overflow-visible">
                        <button
                            type="button"
                            onClick={() => setShowModal(true)}
                            className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-gradient-to-br from-[#0052CC] to-[#003D99] text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:scale-105 active:scale-[0.97] transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap border border-[#0052CC]/50"
                        >
                            <Plus size={14} strokeWidth={3} />
                            <span className="hidden sm:inline">Nuevo Conteo</span>
                        </button>
                    </div>
                )}

                <div className="flex items-center shrink-0 border-l border-white/30 pl-2 ml-1">
                    <button
                        onClick={() => setIsSearchActive(true)}
                        className="relative w-11 h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
                        title="Buscar conteo"
                    >
                        <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                        {search && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario" filtersContent={filtersContent}>
            <DataTable columns={COLS} loading={loading} empty={{ icon: ClipboardCheck, message: 'Sin conteos de inventario registrados' }}>
                {filtered.map((c, i) => {
                    const es = ESTADO_CFG[c.status] || ESTADO_CFG.BORRADOR;
                    const valorNeto = (c.valor_sobrante || 0) - (c.valor_faltante || 0);
                    return (
                        <DataRow key={c.id} index={i} onClick={() => navigate(`/conteo-inventario/${c.id}`)}>
                            <DataCell><span className="text-[12px] font-semibold text-slate-700">{fmtDate(c.created_at)}</span></DataCell>
                            <DataCell><span className="text-[12px] font-bold text-slate-800">{c.branches?.name || '—'}</span></DataCell>
                            <DataCell hideBelow="md"><span className="text-[11px] text-slate-500">{SCOPE_LABEL[c.scope_type] || c.scope_type}</span></DataCell>
                            <DataCell align="center" hideBelow="md"><span className="text-[11px] tabular-nums text-slate-600">{c.total_contados ?? '—'}/{c.total_items ?? '—'}</span></DataCell>
                            <DataCell align="center">
                                {c.total_diferencias > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                        <AlertTriangle size={10} /> {c.total_diferencias}
                                    </span>
                                ) : c.total_diferencias === 0 ? (
                                    <span className="text-[10px] font-bold text-emerald-600">Sin diferencias</span>
                                ) : <span className="text-slate-500">—</span>}
                            </DataCell>
                            <DataCell align="right" hideBelow="lg">
                                <span className={`text-[11px] font-bold tabular-nums ${valorNeto < 0 ? 'text-red-600' : valorNeto > 0 ? 'text-blue-600' : 'text-slate-500'}`}>{fmtMoney(valorNeto)}</span>
                            </DataCell>
                            <DataCell align="center">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${es.bg} ${es.text} ${es.border}`}>
                                    <es.icon size={12} strokeWidth={2.5} /> {es.label}
                                </span>
                            </DataCell>
                            <DataCell align="right">
                                <ChevronRight size={16} className="text-slate-300" />
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            <NuevoConteoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(id) => navigate(`/conteo-inventario/${id}`)}
            />
        </GlassViewLayout>
    );
}
