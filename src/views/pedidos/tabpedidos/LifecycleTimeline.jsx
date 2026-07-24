// Extracted from TabPedidos.jsx (Bloque 6.C) — the horizontal lifecycle
// timeline (Confirmado → Inicio → Listo → En Ruta → ... → Finalizado) with
// its pause badge, shown inside each expanded pedido card.
import React from 'react';
import { motion } from 'framer-motion';
import { UserCircle2 } from 'lucide-react';
import { fmtMin, elapsed } from './helpers';

function fmtHM(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Todos los nodos activos/completados en un solo color indigo
const tlDot    = () => 'bg-indigo-500';
const tlLine   = () => 'bg-indigo-300';
const tlBorder = () => 'border-indigo-400';
const tlGlow   = () => 'rgba(99,102,241';

// ruta_entregado se inserta en índice 4; Llegada→5, Finalizado→6, extras→≥7
const TL_STAGE_IDX = { sin_iniciar: 0, preparando: 1, pausado: 1, preparado: 2, transito: 3, contando: 5, erp: 6 };

function PauseBadge({ pause, isPaused, empMap = new Map() }) {
    const mins     = pause ? elapsed(pause.pausado_at, pause.reanudado_at ?? undefined) : null;
    const isActive = isPaused && !pause?.reanudado_at;
    const empName  = (id) => { const e = empMap.get(id); return e ? `${e.first_names} ${e.last_names}`.trim() : null; };
    return (
        <div className="group/pb relative">
            <motion.span
                className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-px rounded whitespace-nowrap shadow-sm leading-tight cursor-default ${
                    isActive ? 'bg-amber-400 text-white' : 'bg-white text-warning border border-amber-300'
                }`}
                animate={isActive ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
                transition={isActive ? { duration: 1.2, repeat: Infinity } : undefined}
            >
                ⏸ {fmtMin(mins) ?? '—'}
            </motion.span>
            {pause && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-[200] hidden group-hover/pb:block pointer-events-none">
                    <div className="bg-slate-900/90 text-white rounded-xl px-2.5 py-2 shadow-xl flex flex-col gap-0.5 min-w-max">
                        <div className="text-[9px] font-bold capitalize">{pause.razon ?? 'Pausa'}</div>
                        <div className="text-[8px] text-content-3">
                            Pausó: <span className="text-white font-semibold">{fmtHM(pause.pausado_at) || '—'}</span>
                            {empName(pause.pausado_por) && <span className="text-content-3"> · {empName(pause.pausado_por)}</span>}
                        </div>
                        <div className="text-[8px] text-content-3">
                            Reanudó:{' '}
                            {pause.reanudado_at
                                ? <>
                                    <span className="text-white font-semibold">{fmtHM(pause.reanudado_at)}</span>
                                    {empName(pause.reanudado_por) && <span className="text-content-3"> · {empName(pause.reanudado_por)}</span>}
                                  </>
                                : <span className="text-amber-300 font-semibold">En curso</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// conteoEmp (row.conteo_por, BD desde v2.2.236) se recibe pero este timeline
// nunca le agregó un nodo propio — a diferencia de llegadaEmp/erpEmp, que sí
// se renderizan. No se adivina dónde va (¿nodo propio? ¿parte de "Llegada"?)
// — gap documentado, no se inventa la UI.
// eslint-disable-next-line no-unused-vars
export default function LifecycleTimeline({ row, stage, creatorEmp, iniciadorEmp, finalizadorEmp, enviadorEmp, llegadaEmp, conteoEmp, reenvioEmp, erpEmp, difsEmp, corrConfEmp, receptionApoyo = [], isBranch = false, empMap = new Map(), pauses = [], rutaStop = null, rutaCondEmp = null }) {
    const hasPause  = (row.min_pausado_total ?? 0) > 0;
    const isPaused  = stage === 'pausado';
    const activeIdx = TL_STAGE_IDX[stage] ?? 0;
    const hasDif    = !!row.diferencias_reportadas_at;

    // Quién entregó: preferir entregado_por lookup, fallback al conductor
    const entregadorEmp = rutaStop?.entregado_por
        ? (empMap.get(rutaStop.entregado_por) ?? rutaCondEmp)
        : rutaCondEmp;
    const nodes = [
        { key: 'confirmado',     label: 'Confirmado', time: row.created_at,           emp: creatorEmp    },
        { key: 'iniciado',       label: 'Inicio',     time: row.iniciado_at,          emp: iniciadorEmp  },
        { key: 'preparado',      label: 'Listo',      time: row.finalizado_at,        emp: finalizadorEmp },
        { key: 'enviado',        label: 'En Ruta',    time: row.enviado_at,           emp: enviadorEmp    },
        { key: 'ruta_entregado', label: 'Entregado',  time: rutaStop?.entregado_at ?? null, emp: entregadorEmp, isRutaNode: true },
        { key: 'llegada',        label: 'Llegada',    time: row.llegada_fisica_at,    emp: llegadaEmp,    apoyo: receptionApoyo },
        { key: 'erp',            label: 'Finalizado', time: row.recibido_erp_at,      emp: erpEmp,        apoyo: receptionApoyo },
    ];
    if (row.falta_caja_at) {
        // Label descriptivo según tipo
        const problemaLabel = row.llegada_tipo === 'mixto'      ? 'Dañada + Falta'
                            : row.llegada_tipo === 'caja_danada' ? 'Caja dañada'
                            :                                       'Falta caja';
        nodes.push({ key: 'falta_caja', label: problemaLabel, time: row.falta_caja_at, emp: llegadaEmp });

        // Ciclos de reenvío desde reenvios_historial (nuevo)
        const historial = row.reenvios_historial ?? [];
        if (historial.length > 0) {
            historial.forEach((ciclo, i) => {
                const lbl = historial.length > 1 ? `Reenvío ${ciclo.ciclo}` : 'Reenvío';
                nodes.push({ key: `reenvio_${i}`, label: lbl, time: ciclo.sent_at, emp: reenvioEmp });
                if (ciclo.arrived_at) {
                    const llegadaLbl    = historial.length > 1 ? `Llegada R.${ciclo.ciclo}` : '2ª Llegada';
                    const segLlegadaEmp = ciclo.arrived_por ? empMap.get(ciclo.arrived_por) ?? null : null;
                    nodes.push({ key: `seg_llegada_${i}`, label: llegadaLbl, time: ciclo.arrived_at, emp: segLlegadaEmp });
                }
            });
        } else {
            // Compat con pedidos anteriores sin reenvios_historial
            if (row.reenvio_bodega_at) nodes.push({ key: 'reenvio', label: 'Reenvío', time: row.reenvio_bodega_at, emp: reenvioEmp });
            if (row.segunda_llegada_at) nodes.push({ key: 'seg_llegada', label: '2ª Llegada', time: row.segunda_llegada_at });
        }
    }
    if (hasDif) {
        nodes.push({ key: 'diferencias', label: 'Diferencias', time: row.diferencias_reportadas_at, emp: difsEmp });
        nodes.push({ key: 'corregido',   label: 'Corregido',   time: row.confirmado_correccion_at,  emp: corrConfEmp });
    }

    return (
        /* overflow-visible so box-shadow glow never gets clipped */
        <div className="flex items-start w-full pb-1 pt-0.5" style={{ overflow: 'visible' }}>
            {nodes.map((node, idx) => {
                // Nodes appended after the main sequence (Diferencias, Corregido) are "done"
                // purely based on whether they have a timestamp, regardless of activeIdx
                const isExtraNode  = idx >= 7;
                // ruta_entregado es "done" cuando tiene timestamp, sin depender de activeIdx
                const isDone       = node.time != null && (isExtraNode || node.isRutaNode || idx < activeIdx);
                const isActive     = !isExtraNode && !node.isRutaNode && idx === activeIdx;
                const isPausedDot = isActive && isPaused;
                const isFuture    = !isDone && !isActive;
                const nextNode    = nodes[idx + 1];

                // Elapsed time between this node and the next (completed segment)
                const segElapsed = isDone && nextNode?.time
                    ? fmtMin(elapsed(node.time, nextNode.time))
                    : null;

                // Glow animation for active dot — uses box-shadow (no overflow)
                const glowColor = tlGlow(idx);
                const activeAnimate = isActive && !isPausedDot ? {
                    scale: 1, opacity: 1,
                    boxShadow: [
                        `0 0 0 0px ${glowColor},0.5)`,
                        `0 0 0 7px ${glowColor},0)`,
                        `0 0 0 0px ${glowColor},0.5)`,
                    ],
                } : { scale: 1, opacity: 1, boxShadow: '0 0 0 0px rgba(0,0,0,0)' };

                return (
                    <React.Fragment key={node.key}>
                        {/* Node */}
                        <div className="flex flex-col items-center shrink-0" style={{ width: 48 }}>
                            {/* Dot */}
                            <div className="flex items-center justify-center w-6 h-6">
                                <motion.div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center z-10 ${
                                        isDone      ? `${tlDot(idx)} shadow-sm` :
                                        isPausedDot ? 'bg-amber-400 shadow-md' :
                                        isActive    ? `bg-white border-2 ${tlBorder(idx)}` :
                                                      'bg-surface-card-hover border border-slate-200'
                                    }`}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={activeAnimate}
                                    transition={isActive && !isPausedDot ? {
                                        scale:      { type: 'spring', stiffness: 350, damping: 24, delay: idx * 0.06 },
                                        opacity:    { delay: idx * 0.06, duration: 0.3 },
                                        boxShadow:  { duration: 2, repeat: Infinity, ease: 'easeOut' },
                                    } : { type: 'spring', stiffness: 350, damping: 24, delay: idx * 0.06 }}
                                >
                                    {isDone && (
                                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                            <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                    {isActive && !isPausedDot && (
                                        <motion.div
                                            className={`w-2 h-2 rounded-full ${tlDot(idx)}`}
                                            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
                                            transition={{ duration: 1.4, repeat: Infinity }}
                                        />
                                    )}
                                    {isPausedDot && (
                                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                            <rect x="1.5" y="1.5" width="2.5" height="6" rx="0.6" fill="white" />
                                            <rect x="5" y="1.5" width="2.5" height="6" rx="0.6" fill="white" />
                                        </svg>
                                    )}
                                </motion.div>
                            </div>

                            {/* Label */}
                            <span className={`text-[9px] font-semibold text-center leading-tight ${isFuture ? 'text-content-3' : 'text-content-2'}`}>
                                {isPausedDot ? 'Pausado' : node.label}
                            </span>

                            {/* Time — muestra fecha si es de otro día */}
                            {(() => {
                                const t = node.time ? new Date(node.time) : null;
                                const isToday = t && t.toDateString() === new Date().toDateString();
                                const dateLabel = t && !isToday
                                    ? t.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })
                                    : null;
                                return (
                                    <span className="tabular-nums leading-tight text-center mt-px flex flex-col items-center">
                                        {dateLabel && <span className="text-[9px] text-content font-bold leading-none mb-0.5">{dateLabel}</span>}
                                        <span className="text-[10px] text-content-2 whitespace-nowrap">{fmtHM(node.time) || <span className="text-content-3">——</span>}</span>
                                    </span>
                                );
                            })()}

                            {/* Responsible person mini-avatar */}
                            {node.emp && (
                                <div className="flex flex-col items-center gap-0.5 mt-1">
                                    {node.emp.photo
                                        ? <img src={node.emp.photo} className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-md shrink-0" alt="" />
                                        : <span className="w-7 h-7 rounded-full bg-surface-card-hover flex items-center justify-center shrink-0"><UserCircle2 size={13} className="text-content-3" /></span>
                                    }
                                    <span className="text-[9px] text-content-2 leading-tight font-medium text-center">{node.emp.name?.split(' ')[0]}</span>
                                </div>
                            )}
                            {/* Apoyo avatar stack */}
                            {node.apoyo?.length > 0 && (
                                <div className="flex justify-center mt-0.5" style={{ paddingLeft: node.apoyo.length > 1 ? 6 : 0 }}>
                                    {node.apoyo.slice(0, 3).map((a, i) => (
                                        a.photo_url
                                            ? <img key={a.id} src={a.photo_url} title={a.name} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: i }} className="w-5 h-5 rounded-full object-cover border-2 border-white shadow-sm shrink-0 relative" alt="" />
                                            : <span key={a.id} title={a.name} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: i }} className="w-5 h-5 rounded-full bg-surface-card-hover border-2 border-white flex items-center justify-center shrink-0 relative"><UserCircle2 size={10} className="text-content-3" /></span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Connector */}
                        {idx < nodes.length - 1 && (
                            <div className="relative flex-1 min-w-[8px] self-start" style={{ marginTop: 15 }}>
                                {/* Track */}
                                <div className="h-0.5 w-full bg-surface-card-hover rounded-full" />
                                {/* Fill */}
                                {(isDone || (isActive && node.time)) && (
                                    <motion.div
                                        className={`absolute top-0 left-0 h-0.5 rounded-full ${tlLine(idx)}`}
                                        initial={{ width: '0%' }}
                                        animate={{ width: isDone && nextNode?.time ? '100%' : isDone ? '100%' : '50%' }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: idx * 0.08 }}
                                    />
                                )}
                                {/* Pause badges — above the line */}
                                {node.key === 'iniciado' && hasPause && (
                                    <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5" style={{ top: -14 }}>
                                        {pauses.length > 0
                                            ? pauses.map((p, i) => (
                                                <PauseBadge key={i} pause={p} isPaused={isPaused && i === pauses.length - 1} empMap={empMap} />
                                            ))
                                            : <PauseBadge pause={null} isPaused={isPaused} empMap={empMap} />
                                        }
                                    </div>
                                )}
                                {/* Elapsed time — below the line; hidden for the other side's steps */}
                                {segElapsed && (() => {
                                    const isBodegaSrc   = ['confirmado','iniciado','preparado'].includes(node.key);
                                    const isSucursalSrc = node.key === 'llegada' || node.key.startsWith('seg_llegada');
                                    const show = isBranch ? !isBodegaSrc : !isSucursalSrc;
                                    return show ? (
                                        <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap" style={{ top: 4 }}>
                                            <span className="text-[9px] font-semibold text-content-2 tabular-nums">{segElapsed}</span>
                                        </div>
                                    ) : null;
                                })()}
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}
