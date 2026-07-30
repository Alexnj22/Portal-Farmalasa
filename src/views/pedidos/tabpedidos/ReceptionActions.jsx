// Extracted from TabPedidos.jsx (Bloque 6.C)
import { UserCircle2, PackageCheck, AlertTriangle, PackageX, Truck, Database, UserPlus, Loader2 } from 'lucide-react';
import Badge from '../../../components/common/Badge';
import Button from '../../../components/common/Button';

// Mismas etiquetas que LLEGADA_TIPO_INFO en PostCompletionSection.jsx (solo
// el texto — el estilo de esta tarjeta sigue el patrón "completado" propio
// de este componente, ver bloque "Confirmado en Sistema de Ventas").
const LLEGADA_TIPO_LABEL = {
    completa:    'sin novedad',
    caja_danada: 'caja dañada',
    falta_caja:  'caja faltante',
    mixto:       'daños + faltantes',
};

export default function ReceptionActions({ llegadaOk, erpOk, onMarkLlegada, onOpenRecibir, onOpenReenvioModal, onSegundaLlegada, onApoyo, busy, llegadaEmp, erpEmp, cardApoyo = [], pendientesCount = 0, llegadaTipo, reenviosHistorial = [], faltaCajas = [], cajasDanadas = [], hasFaltaItems = false, reenvioBodygaAt = null, segundaLlegadaAt = null }) {
    const empChip = (emp) => emp ? (
        <span className="flex items-center gap-1 text-caption text-content-3">
            {emp.photo_url
                ? <img src={emp.photo_url} className="w-4 h-4 rounded-full object-cover border border-border-card shadow-sm" alt="" />
                : <UserCircle2 size={12} className="text-content-3" />}
            {emp.name?.split(' ')[0]}
        </span>
    ) : null;

    const apoyoChips = cardApoyo.length > 0 ? (
        <div className="flex items-center gap-0.5">
            {cardApoyo.slice(0, 4).map((a, i) => (
                a.photo_url
                    ? <img key={a.id} src={a.photo_url} title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full object-cover border-2 border-border-card shadow-sm shrink-0" alt="" />
                    : <span key={a.id} role="img" title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full bg-surface-card-hover border-2 border-border-card flex items-center justify-center shrink-0"><UserCircle2 size={9} className="text-content-3" /></span>
            ))}
        </div>
    ) : null;

    const apoyoBtn = (
        <Button variant="secondary" icon={UserPlus} onClick={onApoyo}>Apoyo</Button>
    );

    // Estado de reenvíos — ciclo pendiente de llegada
    // Fallback para pedidos viejos: si no hay historial pero reenvio_bodega_at está seteado, sintetizar un ciclo virtual
    const cicloEnCamino = reenviosHistorial.find(c => c.sent_at && !c.arrived_at)
        ?? (reenvioBodygaAt && !segundaLlegadaAt && faltaCajas.length > 0
            ? { sent_at: reenvioBodygaAt, cajas: faltaCajas, ciclo: 1, _legacy: true }
            : null);
    const hasFaltaPendiente  = faltaCajas.length > 0;
    const hasDanadaPendiente = cajasDanadas.length > 0;

    // ¿Cuántos ciclos de reenvío se han completado? (todos tienen arrived_at)
    // Para pedidos viejos: "resuelto" cuando segunda_llegada_at está seteado
    const todosReenviosResueltos = reenviosHistorial.length > 0
        ? reenviosHistorial.every(c => c.arrived_at)
        : !!segundaLlegadaAt;

    return (
        <div className="border-t border-divider px-4 py-3 space-y-2">
            <div className="text-caption font-semibold text-content-3 uppercase tracking-wide mb-2">Recepción</div>

            {/* Paso 1: Llegada — solo visible cuando aún no confirmada */}
            {!llegadaOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-brand/10 border-brand/20 text-label">
                    <PackageCheck size={13} className="text-brand-text" />
                    <span className="text-brand-text">Paso 1 — Confirmar llegada de cajas</span>
                    <Button disabled={busy === 'llegada'} onClick={onMarkLlegada}>{busy === 'llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar'}</Button>
                </div>
            )}

            {/* Confirmado: llegada de cajas (7A.5) */}
            {llegadaOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-success/10 border-success/30 text-label">
                    <PackageCheck size={13} className="text-success" />
                    <span className="text-success-text">
                        Llegada confirmada{llegadaTipo && LLEGADA_TIPO_LABEL[llegadaTipo] ? ` — ${LLEGADA_TIPO_LABEL[llegadaTipo]}` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {empChip(llegadaEmp)}
                    </div>
                </div>
            )}

            {/* Badges compactos: cajas dañadas + faltantes */}
            {llegadaOk && (hasDanadaPendiente || (hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos)) && (
                <div className="flex flex-wrap gap-1.5">
                    {hasDanadaPendiente && cajasDanadas.map(n => (
                        <Badge key={`d${n}`} variant="warning" icon={AlertTriangle} uppercase={false}>#{n} dañada</Badge>
                    ))}
                    {hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos && faltaCajas.map(n => (
                        <Badge key={`f${n}`} variant="danger" icon={PackageX} uppercase={false}>#{n} no llegó</Badge>
                    ))}
                </div>
            )}

            {/* Banner: reenvío en camino — mostrar por cada ciclo activo */}
            {llegadaOk && cicloEnCamino && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-chart-3/10 border-chart-3/30 text-label">
                    <Truck size={12} className="text-chart-3-text shrink-0" />
                    <span className="text-chart-3-text flex-1">
                        {reenviosHistorial.length > 1 ? `Reenvío ${cicloEnCamino.ciclo} en camino` : 'Reenvío en camino'}
                        {(cicloEnCamino.cajas ?? []).length > 0 && ` — caja${cicloEnCamino.cajas.length > 1 ? 's' : ''} ${cicloEnCamino.cajas.map(n => `#${n}`).join(', ')}`}
                        {(cicloEnCamino.electrolits ?? 0) > 0 && ` · ${cicloEnCamino.electrolits} Electrolit`}
                        {(cicloEnCamino.especiales ?? []).length > 0 && ` · ${cicloEnCamino.especiales.join(', ')}`}
                    </span>
                    <Button tone="chart-3" disabled={!!busy} onClick={onSegundaLlegada}>{busy === 'segunda_llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar llegada'}</Button>
                </div>
            )}

            {/* Revisar items del reenvío (después de confirmar la segunda llegada) */}
            {llegadaOk && todosReenviosResueltos && !hasFaltaPendiente && hasFaltaItems && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-chart-3/10 border-chart-3/20 text-label">
                    <Database size={13} className="text-chart-3-text" />
                    <span className="text-chart-3-text">Revisar caja del reenvío en Sistema de Ventas</span>
                    <Button tone="chart-3" disabled={!!busy} onClick={onOpenReenvioModal}>Revisar</Button>
                </div>
            )}

            {/* Paso 2: Confirmar en Sistema de Ventas */}
            {llegadaOk && !erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-chart-3/10 border-chart-3/20 text-label">
                    <Database size={13} className="text-chart-3-text" />
                    <span className="text-chart-3-text">
                        Paso 2 — Confirmar en Sistema de Ventas {pendientesCount > 0 ? `(${pendientesCount})` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {apoyoChips}
                        {apoyoBtn}
                        <Button tone="chart-3" disabled={!!busy} onClick={onOpenRecibir}>Confirmar</Button>
                    </div>
                </div>
            )}

            {/* Completado en ERP */}
            {erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-success/10 border-success/30 text-label">
                    <Database size={13} className="text-success" />
                    <span className="text-success-text">Confirmado en Sistema de Ventas</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {empChip(erpEmp)}
                        {apoyoChips}
                    </div>
                </div>
            )}
        </div>
    );
}
