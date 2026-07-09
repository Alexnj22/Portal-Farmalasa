import React, { useEffect, useState, useMemo } from 'react';
import { GraduationCap, Plus, FileCheck, FileX, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import LiquidSelect from '../components/common/LiquidSelect';
import PracticanteModal from '../components/practicantes/PracticanteModal';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { openStoredFile } from '../utils/storageFiles';

const ESTADO_CFG = {
    ACTIVO: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500', label: 'Activo' },
    FINALIZADO: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400', label: 'Finalizado' },
    CANCELADO: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-400', label: 'Cancelado' },
};

const COLS = [
    { key: 'nombre', label: 'Practicante', align: 'left' },
    { key: 'sucursal', label: 'Sucursal', align: 'left', hideBelow: 'md' },
    { key: 'institucion', label: 'Institución', align: 'left', hideBelow: 'lg' },
    { key: 'fechas', label: 'Período', align: 'center' },
    { key: 'horas', label: 'Horas', align: 'center', hideBelow: 'md' },
    { key: 'convenio', label: 'Convenio', align: 'center' },
    { key: 'estado', label: 'Estado', align: 'center' },
    { key: 'acciones', label: '', align: 'right' },
];

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const isVencido = (p) => p.estado === 'ACTIVO' && p.fecha_fin && new Date(`${p.fecha_fin}T00:00:00`) < new Date();

export default function PracticantesView() {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('practicantes', 'can_edit');
    const { showToast } = useToastStore();

    const practicantes = useStaffStore((s) => s.practicantes);
    const loading = useStaffStore((s) => s.practicantesLoading);
    const fetchPracticantes = useStaffStore((s) => s.fetchPracticantes);
    const deletePracticante = useStaffStore((s) => s.deletePracticante);
    const branches = useStaffStore((s) => s.branches);

    const [search, setSearch] = useState('');
    const [estadoFilter, setEstadoFilter] = useState('ACTIVO');
    const [branchFilter, setBranchFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);

    useEffect(() => { fetchPracticantes(); }, [fetchPracticantes]);

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    const filtered = useMemo(() => practicantes.filter((p) => {
        if (estadoFilter !== 'all' && p.estado !== estadoFilter) return false;
        if (branchFilter && String(p.branch_id) !== String(branchFilter)) return false;
        if (!search) return true;
        const term = norm(search);
        return norm(`${p.first_names} ${p.last_names}`).includes(term)
            || norm(p.institucion_educativa).includes(term)
            || norm(p.tutor_nombre).includes(term);
    }), [practicantes, estadoFilter, branchFilter, search]);

    const counts = useMemo(() => ({
        ACTIVO: practicantes.filter((p) => p.estado === 'ACTIVO').length,
        FINALIZADO: practicantes.filter((p) => p.estado === 'FINALIZADO').length,
        CANCELADO: practicantes.filter((p) => p.estado === 'CANCELADO').length,
    }), [practicantes]);

    const openCreate = () => { setEditing(null); setShowModal(true); };
    const openEdit = (p) => { setEditing(p); setShowModal(true); };

    const handleDelete = async (p) => {
        if (!window.confirm(`¿Eliminar el registro de "${p.first_names} ${p.last_names}"? Esta acción no se puede deshacer.`)) return;
        try {
            await deletePracticante(p.id);
            showToast('Eliminado', `${p.first_names} ${p.last_names}`, 'success');
        } catch (err) {
            showToast('Error', err.message, 'error');
        }
    };

    const branchOpts = [{ value: '', label: 'Todas las sucursales' }, ...(branches || []).map((b) => ({ value: String(b.id), label: b.name }))];

    const pillFilters = [
        { key: 'ACTIVO', label: 'Activos', count: counts.ACTIVO },
        { key: 'FINALIZADO', label: 'Finalizados', count: counts.FINALIZADO },
        { key: 'CANCELADO', label: 'Cancelados', count: counts.CANCELADO },
        { key: 'all', label: 'Todos', count: practicantes.length },
    ];

    const filtersContent = (
        <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06)] overflow-hidden">
                {pillFilters.map((pf, idx) => (
                    <React.Fragment key={pf.key}>
                        {idx > 0 && <div className="h-5 w-px bg-slate-100" />}
                        <button
                            onClick={() => setEstadoFilter(pf.key)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold transition-all ${
                                estadoFilter === pf.key ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            {pf.label}
                            {pf.count > 0 && (
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${estadoFilter === pf.key ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                    {pf.count}
                                </span>
                            )}
                        </button>
                    </React.Fragment>
                ))}
            </div>
            <div className="w-52">
                <LiquidSelect value={branchFilter} onChange={setBranchFilter} options={branchOpts} clearable={false} compact />
            </div>
            {canEdit && (
                <button
                    onClick={openCreate}
                    className="ml-auto flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 transition-all shadow-sm shadow-violet-200"
                >
                    <Plus size={13} /> Nuevo Practicante
                </button>
            )}
        </div>
    );

    return (
        <>
            <ViewTabBar tabs={[]} searchValue={search} onSearchChange={setSearch} showSearch placeholder="Buscar practicante, institución, tutor..." />

            <GlassViewLayout icon={GraduationCap} title="Practicantes / Horas Sociales" filtersContent={filtersContent}>
                <DataTable columns={COLS} loading={loading} empty={{ icon: GraduationCap, message: 'Sin practicantes registrados en este filtro.' }}>
                    {filtered.map((p, i) => {
                        const es = ESTADO_CFG[p.estado] || ESTADO_CFG.ACTIVO;
                        const vencido = isVencido(p);
                        return (
                            <DataRow key={p.id} index={i}>
                                <DataCell>
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-slate-800 text-[12px]">{p.first_names} {p.last_names}</span>
                                        <span className="text-[10px] text-slate-400">{p.tutor_nombre}</span>
                                    </div>
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <span className="text-[11px] text-slate-600">{p.branches?.name || '—'}</span>
                                </DataCell>
                                <DataCell hideBelow="lg">
                                    <span className="text-[11px] text-slate-600">{p.institucion_educativa}</span>
                                </DataCell>
                                <DataCell align="center">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[11px] tabular-nums text-slate-600">{fmtDate(p.fecha_inicio)} → {fmtDate(p.fecha_fin)}</span>
                                        {vencido && (
                                            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full mt-0.5">
                                                <AlertTriangle size={9} /> Vencido
                                            </span>
                                        )}
                                    </div>
                                </DataCell>
                                <DataCell align="center" hideBelow="md">
                                    <span className="text-[11px] tabular-nums text-slate-600">{p.horas_completadas ?? 0}{p.horas_requeridas ? `/${p.horas_requeridas}` : ''}</span>
                                </DataCell>
                                <DataCell align="center">
                                    {p.convenio_url ? (
                                        <button onClick={() => openStoredFile(p.convenio_url)} className="text-emerald-500 hover:text-emerald-600" title="Ver convenio">
                                            <FileCheck size={15} />
                                        </button>
                                    ) : (
                                        <FileX size={15} className="text-red-300 mx-auto" />
                                    )}
                                </DataCell>
                                <DataCell align="center">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${es.bg} ${es.text} ${es.border}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${es.dot}`} />
                                        {es.label}
                                    </span>
                                </DataCell>
                                <DataCell align="right">
                                    {canEdit && (
                                        <div className="flex items-center gap-1 justify-end">
                                            <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors">
                                                <Pencil size={13} />
                                            </button>
                                            <button onClick={() => handleDelete(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    )}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </GlassViewLayout>

            <PracticanteModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                practicante={editing}
                onSaved={() => fetchPracticantes()}
            />
        </>
    );
}
