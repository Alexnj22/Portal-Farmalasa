// ARCHIVO TEMPORAL — solo para preview visual del componente StatCard.
// Eliminar cuando se confirme el molde. Ruta: /dev/stat-cards
import { TrendingUp, FileText, ShieldAlert, Star } from 'lucide-react';
import StatCard from '../components/common/StatCard';

export default function StatCardPreview() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-10 flex flex-col gap-10">

            <h1 className="text-[13px] font-black uppercase tracking-widest text-content-2">
                StatCard — preview (borrar después)
            </h1>

            {/* ── Caso real: 4 cards lado a lado ──────────────────────── */}
            <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-content-2 mb-3">
                    4 cards en flex items-stretch gap-3 flex-wrap
                </p>
                <div className="flex items-stretch gap-3 flex-wrap">

                    {/* 1. Con sub-texto */}
                    <StatCard
                        icon={TrendingUp}
                        iconBg="bg-success/10"
                        iconCls="text-success"
                        label="Total Ventas"
                        value="$12,450"
                        valueCls="text-emerald-700"
                        sub="vs mes anterior"
                    />

                    {/* 2. Sin sub-texto — debe tener EXACTAMENTE la misma altura que #1 */}
                    <StatCard
                        icon={FileText}
                        iconBg="bg-blue-50"
                        iconCls="text-blue-500"
                        label="Facturas"
                        value="847"
                        valueCls="text-blue-700"
                    />

                    {/* 3. Estado activo */}
                    <StatCard
                        icon={ShieldAlert}
                        iconBg="bg-danger/10"
                        iconCls="text-danger"
                        label="Con pérdida"
                        value="12"
                        valueCls="text-danger"
                        sub="precio < costo"
                        active={true}
                        activeBg="bg-danger/10 border-red-300 shadow-md"
                        onClick={() => {}}
                    />

                    {/* 4. Clickable (hover sobre esta para ver el lift) */}
                    <StatCard
                        icon={Star}
                        iconBg="bg-warning/10"
                        iconCls="text-warning"
                        label="Pts. Canjeados"
                        value="$3,200"
                        valueCls="text-amber-700"
                        sub="este período"
                        activeBg="bg-warning/10 border-amber-300 shadow-md"
                        inactiveBg="bg-white border-slate-200 hover:border-warning/30 hover:bg-warning/40"
                        onClick={() => alert('click')}
                    />
                </div>
            </section>

            {/* ── Verificación de altura: card con sub vs sin sub ──────── */}
            <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-content-2 mb-3">
                    Verificación de altura — con sub vs sin sub (deben ser iguales)
                </p>
                <div className="flex items-stretch gap-3">
                    <StatCard
                        icon={TrendingUp}
                        iconBg="bg-success/10"
                        iconCls="text-success"
                        label="Con sub-texto"
                        value="$12,450"
                        valueCls="text-emerald-700"
                        sub="vs mes anterior"
                    />
                    <StatCard
                        icon={FileText}
                        iconBg="bg-blue-50"
                        iconCls="text-blue-500"
                        label="Sin sub-texto"
                        value="847"
                        valueCls="text-blue-700"
                    />
                    {/* Guía visual — barra de referencia al mismo height */}
                    <div className="flex items-stretch">
                        <div className="w-px bg-red-300 self-stretch" title="guía de altura" />
                    </div>
                </div>
            </section>

            {/* ── Estado loading ───────────────────────────────────────── */}
            <section>
                <p className="text-[11px] font-bold uppercase tracking-wider text-content-2 mb-3">
                    Estado loading
                </p>
                <div className="flex items-stretch gap-3">
                    <StatCard icon={TrendingUp} iconBg="bg-success/10" label="Total Ventas" value="" loading />
                    <StatCard icon={FileText}   iconBg="bg-blue-50"    label="Facturas"     value="" loading />
                    <StatCard icon={Star}       iconBg="bg-warning/10"   label="Pts. Canjeados" value="" sub="este período" loading />
                </div>
            </section>

        </div>
    );
}
