import React, { useState, useEffect } from 'react';
import { PackageMinus, CheckCircle2, TrendingDown, Clock, FlaskConical, Building2, ShoppingCart, Download } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { signPhotosDeep } from '../utils/storageFiles';
import { exportCsv } from '../utils/csvExport';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    fetchBranchesForVentasPerdidas, fetchEmployeesSafeBasic, fetchVentasPerdidas, updateVentaPerdidaStatus,
} from '../data/ventasPerdidas';

const TABS = [
    { key: 'pendiente', label: 'Pendiente' },
    { key: 'procesado', label: 'Procesado' },
];

const TAB_HELP = {
    pendiente: 'Productos que clientes buscaron y no teníamos — pendientes de revisar para compra.',
    procesado: 'Reportes ya atendidos por logística (ordenados, descartados o anotados).',
};

export default function VentasPperdidasView() {
    const [activeTab,  setActiveTab]  = useState('pendiente');
    const [rows,       setRows]       = useState([]);
    const [loading,    setLoading]    = useState(false);
    const [branchMap,  setBranchMap]  = useState({});
    const [empMap,     setEmpMap]     = useState({});
    const [processing, setProcessing] = useState(null);

    // Load reference maps once
    useEffect(() => {
        const loadMaps = async () => {
            const [{ data: bData, error: bErr }, { data: eData, error: eErr }] = await Promise.all([
                fetchBranchesForVentasPerdidas(),
                fetchEmployeesSafeBasic(),
            ]);
            if (bErr) console.error('VentasPperdidasView: fetch branches failed:', bErr.message);
            if (eErr) console.error('VentasPperdidasView: fetch employees_safe failed:', eErr.message);
            const bm = {};
            for (const b of bData || []) bm[b.id] = b.name;
            setBranchMap(bm);
            await signPhotosDeep(eData || []);
            const em = {};
            for (const e of eData || []) em[e.id] = { name: e.name, photo: e.photo_url || null };
            setEmpMap(em);
        };
        loadMaps();
    }, []);

    // Reload records whenever tab changes
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const { data, error } = await fetchVentasPerdidas(activeTab);
                if (error) console.error('VentasPperdidasView: fetch ventas_perdidas failed:', error.message);
                if (!cancelled) setRows(data || []);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [activeTab]);

    const markProcessed = async (id) => {
        setProcessing(id);
        await updateVentaPerdidaStatus(id, 'procesado');
        setProcessing(null);
        setRows(prev => prev.filter(r => r.id !== id));
    };

    const handleExportCsv = () => {
        const headers = ['Fecha', 'Producto', 'Buscado como', 'Cantidad', 'Principio activo', 'Laboratorio', 'Sucursal', 'Reportado por'];
        const csvRows = rows.map(r => [
            new Date(r.created_at).toLocaleString('es-SV'),
            r.descripcion || r.producto_buscado || '',
            r.producto_buscado || '',
            r.cantidad ?? '',
            r.principio_activo || '',
            r.laboratorio || '',
            branchMap[r.branch_id] || '',
            empMap[r.reportado_por]?.name || '',
        ]);
        exportCsv(headers, csvRows, `ventas_perdidas_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`);
        useStaff.getState().appendAuditLog('EXPORT_VENTAS_PERDIDAS', null, { count: rows.length, tab: activeTab });
    };

    // Top-5 most-needed products (pending only)
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
            onTabChange={setActiveTab}
            showSearch={false}
        />
    );

    return (
        <GlassViewLayout icon={PackageMinus} title="Ventas Perdidas" filtersContent={filtersContent}>
            <div className="flex flex-col gap-4 p-4 pb-8">

                {/* Tab explanation */}
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-800/6 border border-slate-200/60">
                    <ShoppingCart size={13} className="text-slate-500 shrink-0 mt-0.5" strokeWidth={2} />
                    <p className="text-[11px] text-slate-600 font-medium leading-snug flex-1">{TAB_HELP[activeTab]}</p>
                    {rows.length > 0 && (
                        <button
                            onClick={handleExportCsv}
                            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-black transition-colors"
                        >
                            <Download size={11} strokeWidth={2.5} />
                            CSV
                        </button>
                    )}
                </div>

                {/* Top requested summary (pending only) */}
                {summary.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-1">
                            Más solicitados
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {summary.map(s => (
                                <div
                                    key={s.nombre}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200"
                                >
                                    <TrendingDown size={11} className="text-rose-500" strokeWidth={2.5} />
                                    <span className="text-[11px] font-black text-rose-800 max-w-[180px] truncate">{s.nombre}</span>
                                    <span className="text-[10px] font-bold text-rose-600 tabular-nums">{s.total} uds</span>
                                    <span className="text-[9px] font-semibold text-rose-400">({s.veces}×)</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Records */}
                {loading ? (
                    <div className="flex justify-center py-14">
                        <div className="w-5 h-5 border-2 border-slate-200 border-t-[#0052CC] rounded-full animate-spin" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-16">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                            <CheckCircle2 size={22} strokeWidth={1.5} className="text-slate-300" />
                        </div>
                        <p className="text-[12px] text-slate-500 font-semibold">
                            {activeTab === 'pendiente'
                                ? 'Sin ventas perdidas pendientes'
                                : 'Sin registros procesados'}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {rows.map(r => {
                            const nombre   = r.descripcion   || r.producto_buscado;
                            const searched = r.descripcion   && r.producto_buscado !== r.descripcion ? r.producto_buscado : null;
                            const branch      = branchMap[r.branch_id]         || null;
                            const reporterObj = empMap[r.reportado_por]        || null;
                            const reporter    = reporterObj?.name              || null;
                            const reporterPic = reporterObj?.photo             || null;
                            const fecha    = new Date(r.created_at).toLocaleDateString('es-SV', {
                                day: '2-digit', month: 'short', year: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                            });

                            return (
                                <div
                                    key={r.id}
                                    className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden"
                                >
                                    {/* Colored top stripe */}
                                    <div className={`h-1 w-full ${activeTab === 'pendiente' ? 'bg-rose-400' : 'bg-emerald-400'}`} />

                                    <div className="flex items-start gap-3 px-4 py-3">
                                        {/* Quantity bubble */}
                                        <div className="shrink-0 w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center">
                                            <span className="text-[14px] font-black text-slate-800 leading-none tabular-nums">{r.cantidad}</span>
                                            <span className="text-[8px] font-bold text-slate-500 leading-none mt-0.5">uds</span>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            {/* Product name */}
                                            <p className="text-[12px] font-black text-slate-900 leading-tight">{nombre}</p>

                                            {/* Searched term if different */}
                                            {searched && (
                                                <p className="text-[9px] text-slate-500 mt-0.5">buscado: "{searched}"</p>
                                            )}

                                            {/* Principio activo */}
                                            {r.principio_activo && (
                                                <div className="flex items-center gap-1 mt-1.5">
                                                    <FlaskConical size={9} className="text-violet-500 shrink-0" strokeWidth={2} />
                                                    <span className="text-[10px] font-semibold text-violet-700">{r.principio_activo}</span>
                                                </div>
                                            )}

                                            {/* Laboratorio */}
                                            {r.laboratorio && (
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <Building2 size={9} className="text-slate-400 shrink-0" strokeWidth={2} />
                                                    <span className="text-[10px] text-slate-500 font-medium">{r.laboratorio}</span>
                                                </div>
                                            )}

                                            {/* Meta row */}
                                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-2">
                                                {branch && (
                                                    <span className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold">
                                                        <Building2 size={8} strokeWidth={2} className="text-slate-400" />
                                                        {branch}
                                                    </span>
                                                )}
                                                {reporter && (
                                                    <span className="flex items-center gap-1 text-[9px] text-slate-500">
                                                        {reporterPic ? (
                                                            <img src={reporterPic} alt={reporter} className="w-3.5 h-3.5 rounded-full object-cover border border-slate-200 shrink-0" />
                                                        ) : (
                                                            <span className="w-3.5 h-3.5 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                                                                <span className="text-[6px] font-black text-slate-500 leading-none">{reporter[0]}</span>
                                                            </span>
                                                        )}
                                                        {reporter}
                                                    </span>
                                                )}
                                                <span className="flex items-center gap-1 text-[9px] text-slate-500">
                                                    <Clock size={8} strokeWidth={2} />
                                                    {fecha}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Action */}
                                        {activeTab === 'pendiente' && (
                                            <button
                                                onClick={() => markProcessed(r.id)}
                                                disabled={processing === r.id}
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-black transition-colors disabled:opacity-40 self-start mt-0.5"
                                            >
                                                <CheckCircle2 size={11} strokeWidth={2.5} />
                                                {processing === r.id ? '...' : 'Listo'}
                                            </button>
                                        )}
                                        {activeTab === 'procesado' && (
                                            <span className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 text-[9px] font-black self-start mt-0.5">
                                                <CheckCircle2 size={9} strokeWidth={2.5} />
                                                Listo
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
