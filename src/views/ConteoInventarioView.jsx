import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock, FileCheck2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
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

    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);

    useEffect(() => { fetchConteosInventario(); }, [fetchConteosInventario]);

    const filtered = useMemo(() => {
        if (!search.trim()) return conteos;
        const term = search.trim().toLowerCase();
        return conteos.filter((c) => (c.branches?.name || '').toLowerCase().includes(term));
    }, [conteos, search]);

    return (
        <>
            <ViewTabBar tabs={[]} searchValue={search} onSearchChange={setSearch} showSearch placeholder="Buscar por sucursal..." />

            <GlassViewLayout
                icon={ClipboardCheck}
                title="Conteo de Inventario"
                filtersContent={canEdit ? (
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl hover:from-teal-700 hover:to-teal-800 transition-all shadow-sm shadow-teal-200"
                    >
                        <Plus size={13} /> Nuevo Conteo
                    </button>
                ) : null}
            >
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
                                    ) : <span className="text-slate-300">—</span>}
                                </DataCell>
                                <DataCell align="right" hideBelow="lg">
                                    <span className={`text-[11px] font-bold tabular-nums ${valorNeto < 0 ? 'text-red-600' : valorNeto > 0 ? 'text-blue-600' : 'text-slate-400'}`}>{fmtMoney(valorNeto)}</span>
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
            </GlassViewLayout>

            <NuevoConteoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(id) => navigate(`/conteo-inventario/${id}`)}
            />
        </>
    );
}
