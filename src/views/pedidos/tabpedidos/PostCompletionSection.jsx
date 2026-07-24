// Extracted from TabPedidos.jsx (Bloque 6.C)
import { useRef, useEffect } from 'react';
import { UserCircle2, Truck, CheckCircle2, AlertCircle } from 'lucide-react';

const LLEGADA_TIPO_INFO = {
    completa:   { cls: 'bg-success/10 border-success/30 text-emerald-700', icon: '✓', label: 'Recibido sin novedad' },
    caja_danada:{ cls: 'bg-warning/10 border-warning/30 text-amber-700',       icon: '⚠', label: 'Caja dañada' },
    falta_caja: { cls: 'bg-rose-50 border-rose-200 text-rose-700',          icon: '!', label: 'Caja faltante' },
    mixto:      { cls: 'bg-orange-50 border-orange-200 text-orange-700',    icon: '!', label: 'Daños + faltantes' },
};

export default function PostCompletionSection({ row, difItems = [], empMap = new Map(), onNeedItems, itemsLoaded }) {
    // Auto-load items once per card so dif counts are accurate
    const calledRef = useRef(false);
    useEffect(() => {
        if (!itemsLoaded && !calledRef.current && onNeedItems) {
            calledRef.current = true;
            onNeedItems();
        }
    }, [itemsLoaded, onNeedItems]);

    const tipoInfo = LLEGADA_TIPO_INFO[row.llegada_tipo] ?? null;
    const reenvios = (row.reenvios_historial ?? []);
    const difResueltas   = difItems.filter(d => d.resolucion_status === 'confirmada').length;
    const difPendientes  = difItems.filter(d => d.resolucion_status !== 'confirmada').length;
    const hasCajasDanadas = (row.cajas_danadas ?? []).length > 0;
    const llegadaEmp = row.llegada_fisica_por ? empMap.get(row.llegada_fisica_por) : null;

    return (
        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold text-content-2 uppercase tracking-wide">Resumen de recepción</p>
                {llegadaEmp && (
                    <span className="flex items-center gap-1 text-[10px] text-content-3">
                        {llegadaEmp.photo_url
                            ? <img src={llegadaEmp.photo_url} className="w-4 h-4 rounded-full object-cover border border-white shadow-sm" alt="" />
                            : <UserCircle2 size={12} className="text-content-3" />}
                        {llegadaEmp.name?.split(' ')[0]}
                    </span>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tipoInfo && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${tipoInfo.cls}`}>
                        <span>{tipoInfo.icon}</span>{tipoInfo.label}
                    </span>
                )}
                {hasCajasDanadas && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-warning/10 border-warning/30 text-amber-700">
                        ⚠ Caja{row.cajas_danadas.length > 1 ? 's' : ''} {row.cajas_danadas.map(n => `#${n}`).join(', ')} dañada{row.cajas_danadas.length > 1 ? 's' : ''}
                    </span>
                )}
                {reenvios.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-indigo-50 border-indigo-200 text-indigo-700">
                        <Truck size={9} />{reenvios.length} reenvío{reenvios.length > 1 ? 's' : ''}
                    </span>
                )}
                {difResueltas > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-success/10 border-success/30 text-emerald-700">
                        <CheckCircle2 size={9} />{difResueltas} dif. resuelta{difResueltas > 1 ? 's' : ''}
                    </span>
                )}
                {difPendientes > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-warning/10 border-warning/30 text-amber-700">
                        <AlertCircle size={9} />{difPendientes} dif. pendiente{difPendientes > 1 ? 's' : ''}
                    </span>
                )}
            </div>
        </div>
    );
}
