import React, { useState, useEffect, useCallback } from 'react';
import { PackageMinus, CheckCircle2, TrendingDown, Clock } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { supabase }   from '../supabaseClient';

const TABS = [
    { id: 'pendiente', label: 'Pendiente' },
    { id: 'procesado', label: 'Procesado' },
];

export default function VentasPperdidasView() {
    const [activeTab,  setActiveTab]  = useState('pendiente');
    const [rows,       setRows]       = useState([]);
    const [loading,    setLoading]    = useState(false);
    const [branchMap,  setBranchMap]  = useState({});
    const [empMap,     setEmpMap]     = useState({});
    const [processing, setProcessing] = useState(null); // id being marked

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [{ data: bData }, { data: eData }, { data: vpData }] = await Promise.all([
                supabase.from('branches').select('id, name'),
                supabase.from('employees_safe').select('id, name'),
                supabase
                    .from('ventas_perdidas')
                    .select('id, producto_buscado, descripcion, cantidad, branch_id, reportado_por, status, created_at')
                    .eq('status', activeTab)
                    .order('created_at', { ascending: false }),
            ]);

            const bm = {};
            for (const b of bData || []) bm[b.id] = b.name;
            setBranchMap(bm);

            const em = {};
            for (const e of eData || []) em[e.id] = e.name;
            setEmpMap(em);

            setRows(vpData || []);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { loadData(); }, [loadData]);

    const markProcessed = async (id) => {
        setProcessing(id);
        await supabase.from('ventas_perdidas').update({ status: 'procesado' }).eq('id', id);
        setProcessing(null);
        loadData();
    };

    // Top-5 most requested by total quantity (pending only)
    const summary = activeTab === 'pendiente'
        ? Object.values(
            rows.reduce((acc, r) => {
                const k = r.descripcion || r.producto_buscado;
                if (!acc[k]) acc[k] = { nombre: k, veces: 0, total: 0 };
                acc[k].veces++;
                acc[k].total += r.cantidad;
                return acc;
            }, {})
          ).sort((a, b) => b.total - a.total).slice(0, 5)
        : [];

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={t => { setActiveTab(t); }}
            showSearch={false}
        />
    );

    return (
        <GlassViewLayout icon={PackageMinus} title="Ventas Perdidas" filtersContent={filtersContent}>
            <div className="flex flex-col gap-4 p-4">

                {/* Top requested summary */}
                {summary.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                            Más solicitados (pendientes)
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {summary.map(s => (
                                <div
                                    key={s.nombre}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200/70"
                                >
                                    <TrendingDown size={11} className="text-rose-400" strokeWidth={2.5} />
                                    <span className="text-[11px] font-black text-rose-700 max-w-[180px] truncate">{s.nombre}</span>
                                    <span className="text-[10px] font-bold text-rose-500">{s.total} uds</span>
                                    <span className="text-[9px] text-rose-400">({s.veces}×)</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Records */}
                {loading ? (
                    <div className="flex justify-center py-12">
                        <div className="w-5 h-5 border-2 border-slate-200 border-t-[#0052CC] rounded-full animate-spin" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16">
                        <CheckCircle2 size={30} strokeWidth={1.5} className="text-slate-200" />
                        <p className="text-[12px] text-slate-400 font-semibold">
                            {activeTab === 'pendiente'
                                ? 'Sin ventas perdidas pendientes'
                                : 'Sin registros procesados'}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {rows.map(r => {
                            const nombre   = r.descripcion || r.producto_buscado;
                            const searched = r.descripcion && r.producto_buscado !== r.descripcion
                                ? r.producto_buscado : null;
                            const branch   = branchMap[r.branch_id] || null;
                            const reporter = empMap[r.reportado_por] || null;
                            const fecha    = new Date(r.created_at).toLocaleDateString('es-SV', {
                                day: '2-digit', month: 'short', year: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                            });

                            return (
                                <div
                                    key={r.id}
                                    className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-white/70 border border-slate-200/70 backdrop-blur-sm shadow-sm"
                                >
                                    {/* Left: red strip for pending */}
                                    {activeTab === 'pendiente' && (
                                        <div className="w-1 self-stretch rounded-full bg-rose-300 shrink-0" />
                                    )}

                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12px] font-black text-slate-800 leading-tight truncate">{nombre}</p>
                                        {searched && (
                                            <p className="text-[9px] text-slate-400 mt-0.5">buscado: "{searched}"</p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
                                            <span className="text-[11px] font-black text-slate-700">
                                                {r.cantidad} ud{r.cantidad !== 1 ? 's' : ''}
                                            </span>
                                            {branch && (
                                                <span className="text-[10px] text-slate-500 font-medium">{branch}</span>
                                            )}
                                            {reporter && (
                                                <span className="text-[10px] text-slate-400">{reporter}</span>
                                            )}
                                            <span className="flex items-center gap-1 text-[9px] text-slate-400">
                                                <Clock size={9} strokeWidth={2} />
                                                {fecha}
                                            </span>
                                        </div>
                                    </div>

                                    {activeTab === 'pendiente' && (
                                        <button
                                            onClick={() => markProcessed(r.id)}
                                            disabled={processing === r.id}
                                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 text-emerald-700 text-[10px] font-black transition-colors disabled:opacity-50"
                                        >
                                            <CheckCircle2 size={11} strokeWidth={2.5} />
                                            Procesado
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
