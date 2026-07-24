// Extracted from TabPedidos.jsx (Bloque 6.C)
import { UserCircle2, PackageCheck, AlertTriangle, PackageX, Truck, Database, UserPlus, Loader2 } from 'lucide-react';

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
        <span className="flex items-center gap-1 text-[10px] text-content-3">
            {emp.photo_url
                ? <img src={emp.photo_url} className="w-4 h-4 rounded-full object-cover border border-white shadow-sm" alt="" />
                : <UserCircle2 size={12} className="text-content-3" />}
            {emp.name?.split(' ')[0]}
        </span>
    ) : null;

    const apoyoChips = cardApoyo.length > 0 ? (
        <div className="flex items-center gap-0.5">
            {cardApoyo.slice(0, 4).map((a, i) => (
                a.photo_url
                    ? <img key={a.id} src={a.photo_url} title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full object-cover border-2 border-white shadow-sm shrink-0" alt="" />
                    : <span key={a.id} title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full bg-surface-card-hover border-2 border-white flex items-center justify-center shrink-0"><UserCircle2 size={9} className="text-content-3" /></span>
            ))}
        </div>
    ) : null;

    const apoyoBtn = (
        <button onClick={onApoyo} className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-surface-card-hover text-content-2 hover:bg-surface-card-hover border border-slate-200 active:scale-[0.97] transition-all shrink-0">
            <UserPlus size={10} />Apoyo
        </button>
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
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-content-3 uppercase tracking-wide mb-2">Recepción</div>

            {/* Paso 1: Llegada — solo visible cuando aún no confirmada */}
            {!llegadaOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-blue-50/40 border-blue-100 text-[11px]">
                    <PackageCheck size={13} className="text-blue-500" />
                    <span className="text-blue-700">Paso 1 — Confirmar llegada de cajas</span>
                    <button onClick={onMarkLlegada} disabled={busy === 'llegada'} className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97] transition-all disabled:opacity-50">
                        {busy === 'llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar'}
                    </button>
                </div>
            )}

            {/* Confirmado: llegada de cajas (7A.5) */}
            {llegadaOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-success/40 border-success/30 text-[11px]">
                    <PackageCheck size={13} className="text-success" />
                    <span className="text-emerald-700">
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
                        <span key={`d${n}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/30 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle size={9} />#{n} dañada
                        </span>
                    ))}
                    {hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos && faltaCajas.map(n => (
                        <span key={`f${n}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-[10px] font-semibold text-rose-700">
                            <PackageX size={9} />#{n} no llegó
                        </span>
                    ))}
                </div>
            )}

            {/* Banner: reenvío en camino — mostrar por cada ciclo activo */}
            {llegadaOk && cicloEnCamino && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-indigo-50/40 border-indigo-100 text-[11px]">
                    <Truck size={12} className="text-indigo-400 shrink-0" />
                    <span className="text-indigo-700 flex-1">
                        {reenviosHistorial.length > 1 ? `Reenvío ${cicloEnCamino.ciclo} en camino` : 'Reenvío en camino'}
                        {(cicloEnCamino.cajas ?? []).length > 0 && ` — caja${cicloEnCamino.cajas.length > 1 ? 's' : ''} ${cicloEnCamino.cajas.map(n => `#${n}`).join(', ')}`}
                        {(cicloEnCamino.electrolits ?? 0) > 0 && ` · ${cicloEnCamino.electrolits} Electrolit`}
                        {(cicloEnCamino.especiales ?? []).length > 0 && ` · ${cicloEnCamino.especiales.join(', ')}`}
                    </span>
                    <button onClick={onSegundaLlegada} disabled={!!busy}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:scale-[0.97] transition-all disabled:opacity-50 shrink-0">
                        {busy === 'segunda_llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar llegada'}
                    </button>
                </div>
            )}

            {/* Revisar items del reenvío (después de confirmar la segunda llegada) */}
            {llegadaOk && todosReenviosResueltos && !hasFaltaPendiente && hasFaltaItems && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">Revisar caja del reenvío en Sistema de Ventas</span>
                    <button onClick={onOpenReenvioModal} disabled={!!busy}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-[0.97] transition-all disabled:opacity-50">
                        Revisar
                    </button>
                </div>
            )}

            {/* Paso 2: Confirmar en Sistema de Ventas */}
            {llegadaOk && !erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">
                        Paso 2 — Confirmar en Sistema de Ventas {pendientesCount > 0 ? `(${pendientesCount})` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {apoyoChips}
                        {apoyoBtn}
                        <button onClick={onOpenRecibir} disabled={!!busy}
                            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-[0.97] transition-all disabled:opacity-50">
                            Confirmar
                        </button>
                    </div>
                </div>
            )}

            {/* Completado en ERP */}
            {erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-success/40 border-success/30 text-[11px]">
                    <Database size={13} className="text-success" />
                    <span className="text-emerald-700">Confirmado en Sistema de Ventas</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {empChip(erpEmp)}
                        {apoyoChips}
                    </div>
                </div>
            )}
        </div>
    );
}
