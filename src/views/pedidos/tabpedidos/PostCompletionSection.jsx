// Extracted from TabPedidos.jsx (Bloque 6.C)
import { useRef, useEffect } from 'react';
import Badge from '../../../components/common/Badge';
import { UserCircle2, Truck, CheckCircle2, AlertCircle } from 'lucide-react';

const LLEGADA_TIPO_INFO = {
    completa:   { cls: 'bg-success/10 border-success/30 text-success-text', icon: '✓', label: 'Recibido sin novedad' },
    caja_danada:{ cls: 'bg-warning/10 border-warning/30 text-warning-text',       icon: '⚠', label: 'Caja dañada' },
    falta_caja: { cls: 'bg-danger/10 border-danger/30 text-danger-text',          icon: '!', label: 'Caja faltante' },
    mixto:      { cls: 'bg-chart-4/10 border-chart-4/30 text-chart-4-text',    icon: '!', label: 'Daños + faltantes' },
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
        <div className="border-t border-divider px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-caption font-bold text-content-2 uppercase tracking-wide">Resumen de recepción</p>
                {llegadaEmp && (
                    <span className="flex items-center gap-1 text-caption text-content-3">
                        {llegadaEmp.photo_url
                            ? <img src={llegadaEmp.photo_url} className="w-4 h-4 rounded-full object-cover border border-border-card shadow-sm" alt="" />
                            : <UserCircle2 size={12} className="text-content-3" />}
                        {llegadaEmp.name?.split(' ')[0]}
                    </span>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tipoInfo && (
                    <span className={`inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-full border ${tipoInfo.cls}`}>
                        <span>{tipoInfo.icon}</span>{tipoInfo.label}
                    </span>
                )}
                {hasCajasDanadas && (
                    <Badge variant="warning" uppercase={false}>⚠ Caja{row.cajas_danadas.length > 1 ? 's' : ''} {row.cajas_danadas.map(n => `#${n}`).join(', ')} dañada{row.cajas_danadas.length > 1 ? 's' : ''}</Badge>
                )}
                {reenvios.length > 0 && (
                    <Badge variant="chart-3" icon={Truck} uppercase={false}>{reenvios.length} reenvío{reenvios.length > 1 ? 's' : ''}</Badge>
                )}
                {difResueltas > 0 && (
                    <Badge variant="success" icon={CheckCircle2} uppercase={false}>{difResueltas} dif. resuelta{difResueltas > 1 ? 's' : ''}</Badge>
                )}
                {difPendientes > 0 && (
                    <Badge variant="warning" icon={AlertCircle} uppercase={false}>{difPendientes} dif. pendiente{difPendientes > 1 ? 's' : ''}</Badge>
                )}
            </div>
        </div>
    );
}
