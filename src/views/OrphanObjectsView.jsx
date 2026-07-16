import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Ghost, Clock, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import LiquidSelect from '../components/common/LiquidSelect';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { fetchOrphanObjects, updateOrphanObjectStatus } from '../data/orphanObjects';

const STATUS_LABELS = {
    candidate: 'Candidato',
    confirmed_orphan: 'Confirmado huérfano',
    false_positive: 'Falso positivo',
    resolved: 'Resuelto',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

const STATUS_BADGE = {
    candidate: { icon: HelpCircle, cls: 'bg-amber-50 text-amber-600 border-amber-100' },
    confirmed_orphan: { icon: XCircle, cls: 'bg-red-50 text-red-600 border-red-100' },
    false_positive: { icon: XCircle, cls: 'bg-slate-50 text-slate-500 border-slate-200' },
    resolved: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
};

const TABS = [
    { key: 'todos', label: 'Todos' },
    { key: 'candidate', label: 'Candidatos' },
    { key: 'confirmed_orphan', label: 'Confirmados' },
    { key: 'resolved', label: 'Resueltos' },
];

const EMPTY_ARRAY = [];

const OrphanObjectsView = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('orphan_objects', 'can_edit');
    const appendAuditLog = useStaff(state => state.appendAuditLog);

    const [activeTab, setActiveTab] = useState('todos');
    const [rows, setRows] = useState(EMPTY_ARRAY);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await fetchOrphanObjects();
        if (error) console.error('OrphanObjectsView: fetch failed:', error.message);
        setRows(data || EMPTY_ARRAY);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- fetch inicial (mismo patrón que AuditView.jsx)

    const handleStatusChange = async (row, newStatus) => {
        setSavingId(row.id);
        const { data, error } = await updateOrphanObjectStatus(row.id, newStatus);
        if (error) {
            console.error('OrphanObjectsView: update failed:', error.message);
        } else {
            setRows(prev => prev.map(r => r.id === row.id ? { ...r, status: data.status, resolved_at: data.resolved_at } : r));
            appendAuditLog?.('ORPHAN_OBJECT_STATUS_CHANGE', String(row.id), { title: row.title, from: row.status, to: newStatus });
        }
        setSavingId(null);
    };

    const filteredRows = useMemo(() => {
        if (activeTab === 'todos') return rows;
        return rows.filter(r => r.status === activeTab);
    }, [rows, activeTab]);

    const filtersContent = (
        <ViewTabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} showSearch={false} />
    );

    return (
        <GlassViewLayout icon={Ghost} title="Objetos Huérfanos" filtersContent={filtersContent}>
            <div className="p-4 md:p-6">
                <div className="mb-4 px-3 py-2 rounded-xl bg-slate-800/6 border border-slate-200/60">
                    <p className="text-[11px] text-slate-600 font-medium leading-snug">
                        Tablero de seguimiento de candidatos a código muerto (componentes/funciones/edge
                        functions sin caller real). No es detección automática — cada fila se agrega vía
                        migración cuando se confirma un caso real; acá solo se marca su estado.
                    </p>
                </div>
                <DataTable
                    columns={[
                        { key: 'title', label: 'Objeto' },
                        { key: 'kind', label: 'Tipo', hideBelow: 'md' },
                        { key: 'detected_at', label: 'Detectado', hideBelow: 'md' },
                        { key: 'status', label: 'Estado' },
                    ]}
                    loading={loading}
                    empty={{ icon: Ghost, message: 'Sin objetos registrados en este filtro' }}
                >
                    {filteredRows.map((row, i) => {
                        const badge = STATUS_BADGE[row.status] || STATUS_BADGE.candidate;
                        const BadgeIcon = badge.icon;
                        return (
                            <DataRow key={row.id} index={i}>
                                <DataCell>
                                    <div className="text-[12px] font-black text-slate-800">{row.title}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate max-w-[280px]" title={row.ref}>{row.ref}</div>
                                    {row.notes && (
                                        <div className="text-[10px] text-slate-500 mt-1 leading-snug max-w-[360px]">{row.notes}</div>
                                    )}
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{row.kind}</span>
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                        <Clock size={9} /> {new Date(row.detected_at).toLocaleDateString('es-SV')}
                                    </span>
                                </DataCell>
                                <DataCell>
                                    {canEdit ? (
                                        <div className="w-[180px]">
                                            <LiquidSelect
                                                value={row.status}
                                                onChange={(val) => handleStatusChange(row, val)}
                                                options={STATUS_OPTIONS}
                                                clearable={false}
                                                compact
                                                disabled={savingId === row.id}
                                            />
                                        </div>
                                    ) : (
                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${badge.cls}`}>
                                            <BadgeIcon size={10} /> {STATUS_LABELS[row.status] || row.status}
                                        </span>
                                    )}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </div>
        </GlassViewLayout>
    );
};

export default OrphanObjectsView;
