// Extracted from TabPedidos.jsx (Bloque 6.C) — differences (dif) resolution
// section shown inside an expanded pedido card.
import { useState, useEffect, useMemo } from 'react';
import Button from '../../../components/common/Button';
import { AlertCircle, CheckCircle2, X, Loader2, Check } from 'lucide-react';
import LiquidAvatar from '../../../components/common/LiquidAvatar';
import LiquidSelect from '../../../components/common/LiquidSelect';
import { calcSolicitado, fmtRelative } from './helpers';
import Badge from '../../../components/common/Badge';
import PortalInput from '../../../components/common/PortalInput';
import DevolucionBloque from './DevolucionBloque';
import EmpChip from './EmpChip';
import DecisionDiferencia from './DecisionDiferencia';
import { fetchOpcionesDiferencia } from '../../../data/diferencias';

const ERROR_TIPO_LABEL = {
    faltante:     { label: 'Faltante',        variante: 'danger'           },
    sobrante:     { label: 'Sobrante',        variante: 'success' },
    danado:       { label: 'Dañado',          variante: 'neutral'   },
    vencido:      { label: 'Vencido',         variante: 'neutral'   },
    presentacion: { label: 'Pres. distinta',  variante: 'neutral'         },
    otro:         { label: 'Otro',            variante: 'neutral'      },
    diferencia:   { label: 'Diferencia',      variante: 'warning'      },
};

// La lista de salidas ya NO se escribe acá. Vive en `diferencia_opcion` y la
// pantalla la lee: es la misma que la base usa para validar, así que el valor
// que se elige coincide con el que se acepta por construcción. Antes eran dos
// copias —una acá y otra en la cabeza de quien escribió la RPC— y encima las
// elegía BODEGA, cuando quien ve la diferencia es la sala.

// Los rótulos de las resoluciones VIEJAS. Se quedan para poder leer lo que ya
// está guardado; las nuevas traen su rótulo desde la tabla.
const RESOLUCION_LABEL = {
    envio_fisico:        'Enviar producto',
    ajuste_sistema:      'Ajuste en sistema',
    aceptar_sobrante:    'Sucursal queda con sobrante',
    devolver_bodega:     'Devolver a bodega',
    devolucion_aceptada: 'Devolución aceptada',
    devolucion_negada:   'Devolución negada',
    aceptar_dif_pres:    'Dif. presentación aceptada',
    resuelto:            'Resuelto',
    no_aplica:           'Sin solución',
};

const EVENTO_LABEL = {
    resolucion_propuesta:    'propuso resolución',
    resolucion_confirmada:   'confirmó resolución',
    resolucion_rechazada:    'rechazó resolución',
    diferencia_proponer:     'propuso cómo se arregla',
    diferencia_contraproponer:'propuso la otra salida',
    diferencia_aceptar:      'estuvo de acuerdo',
    diferencia_escalada:     'no estuvo de acuerdo — pasó a supervisión',
    diferencia_supervisar:   'lo decidió supervisión',
    diferencia_llegada:      'confirmó que lo tiene',
    devolucion_solicitada:   'pidió la devolución',
    devolucion_aceptada:     'aceptó la devolución',
    devolucion_rechazada:    'no aceptó la devolución',
    devolucion_recibida:     'recibió la devolución en bodega',
    correccion_conteo:       'corrigió lo contado',
};

const DIF_MAX = 3;

export default function DifSection({ row, difItems = [], eventos = [], devoluciones = [], isBranch, esSupervision = false, busyAction, empMap = new Map(), onCorregirBodega, onConfirmarCorreccion, onDecidirDiferencia, onConfirmarLlegada, onPedirFoto, onMoverDevolucion, onRecibirDevolucion, readOnly = false, onNeedItems, itemsLoaded = true }) {
    const [showAll,  setShowAll]  = useState(false);
    const [corrNota, setCorrNota] = useState('');
    const [catalogo, setCatalogo] = useState({});

    // El catálogo de salidas. Se pide una vez por sesión —son doce filas que no
    // cambian mientras el portal está abierto— y sin él no se ofrece ninguna
    // opción: es preferible a inventarlas.
    useEffect(() => {
        let vivo = true;
        fetchOpcionesDiferencia().then(c => { if (vivo) setCatalogo(c); });
        return () => { vivo = false; };
    }, []);

    useEffect(() => {
        if (!itemsLoaded && onNeedItems) onNeedItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemsLoaded]);

    // La devolución de cada renglón. Puede haber varias por ítem —una rechazada
    // no impide volver a pedir— pero VIVA hay una sola: lo garantiza el índice
    // único de la base. Se prefiere la viva; si no hay, se muestra la última
    // rechazada, que es la que explica por qué no se devolvió.
    const devPorItem = useMemo(() => {
        const m = new Map();
        for (const d of devoluciones) {
            const previa = m.get(d.pedido_item_id);
            if (!previa || previa.estado === 'rechazada') m.set(d.pedido_item_id, d);
        }
        return m;
    }, [devoluciones]);

    const allConfirmed  = difItems.length > 0 && difItems.every(r => r.resolucion_status === 'confirmada');
    const visibleItems  = showAll ? difItems : difItems.slice(0, DIF_MAX);
    const hiddenCount   = difItems.length - DIF_MAX;

    // Cierre a nivel sucursal (7A.1): backend listo desde 2026-06-21
    // (pedido_sucursal_status.corregido_bodega_*/confirmado_correccion_*),
    // solo faltaba este bloque de UI. Aparece tras confirmar cada item
    // individual — bodega marca la corrección global, sucursal la confirma.
    const corrBodegaEmp = row?.corregido_bodega_por      ? empMap.get(row.corregido_bodega_por)      : null;
    const corrConfEmp   = row?.confirmado_correccion_por ? empMap.get(row.confirmado_correccion_por) : null;

    return (
        <div className="border-t border-warning/30 bg-gradient-to-b from-warning/10 to-surface-card px-4 py-3 space-y-3">
            {/* El ícono ya dice el estado: llevaba además un ✓ de texto pegado
                al final del rótulo, que en versalitas queda a otra altura. */}
            <div className="flex items-center gap-1.5">
                {allConfirmed
                    ? <CheckCircle2 size={12} className="text-success shrink-0" />
                    : <AlertCircle size={12} className="text-warning shrink-0" />}
                <span className={`text-caption font-semibold uppercase tracking-wide ${allConfirmed ? 'text-success-text' : 'text-warning-text'}`}>
                    {allConfirmed ? 'Diferencias resueltas' : `Diferencias — pendiente resolución${difItems.length > 1 ? ` (${difItems.length})` : ''}`}
                </span>
            </div>

            {visibleItems.map(item => {
                const et      = ERROR_TIPO_LABEL[item.error_tipo];
                const res     = item.resolucion_status;
                const qtyDiff = item.cantidad_recibida !== null && item.cantidad_recibida !== item.cantidad_asignada;
                const dev     = devPorItem.get(item.id) ?? null;

                // El marco dice de un vistazo en qué está el renglón. `escalada`
                // se pinta en rojo porque es lo único que no avanza solo: alguien
                // tiene que ir a mirarlo.
                const borderCls = res === 'confirmada'      ? 'border-success/30 bg-success/10'
                                : res === 'escalada'        ? 'border-danger/40 bg-danger/10'
                                : res === 'acordada'        ? 'border-warning/40 bg-warning/10'
                                : res === 'contrapropuesta' ? 'border-chart-4/30 bg-chart-4/10'
                                : res === 'propuesta'       ? 'border-chart-3/30 bg-chart-3/10'
                                :                             'border-warning/30 bg-surface-card';

                return (
                    <div key={item.id} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                        {/* Item header */}
                        <div className="flex items-center gap-2 px-3 py-2">
                            <span className="flex-1 text-label font-semibold text-content-2 truncate">{item.products?.nombre}</span>
                            {et && <Badge variant={et.variante} size="sm" className="shrink-0" uppercase={false}>{et.label}</Badge>}
                            {res === 'confirmada' && <CheckCircle2 size={13} className="text-success shrink-0" />}
                            {res === 'rechazada'  && <X size={13} className="text-danger shrink-0" />}
                        </div>

                        {/* Qty diff */}
                        {(qtyDiff || item.cantidad_asignada != null) && (
                            <div className="flex items-center gap-2 px-3 pb-1.5 text-caption text-content-3 flex-wrap">
                                {(() => { const sol = calcSolicitado(item); return sol != null ? <span>Solicitado: <strong className="text-content-2">{sol}</strong></span> : null; })()}
                                <span>Enviado: <strong className="text-content-2">{item.cantidad_asignada}</strong></span>
                                {item.cantidad_recibida != null && <>
                                    <span className="text-content-3">→</span>
                                    <span>Físico: <strong className={item.cantidad_recibida < item.cantidad_asignada ? 'text-danger' : 'text-success'}>{item.cantidad_recibida}</strong></span>
                                </>}
                            </div>
                        )}

                        <div className="px-3 pb-3 space-y-2">

                            {/* ── Cómo se arregla ──
                                UNA conversación por renglón. Antes eran dos —la
                                lista de resolución y el botón «Devolver a
                                bodega»— sobre el mismo renglón, y tenerlas a la
                                vez es la forma de que una diga que sí y la otra
                                que no. */}
                            <DecisionDiferencia
                                item={item} catalogo={catalogo}
                                esSala={isBranch} esSupervision={esSupervision}
                                empMap={empMap} busyAction={busyAction} readOnly={readOnly}
                                onDecidir={onDecidirDiferencia}
                                onConfirmarLlegada={onConfirmarLlegada}
                                onPedirFoto={onPedirFoto}
                            />

                            {/* ── El movimiento, cuando la salida acordada lo
                                tiene. Ya no ofrece pedirlo: el acuerdo se dio
                                arriba y la devolución nace aceptada. */}
                            <DevolucionBloque
                                dev={dev} item={item} isBranch={isBranch} busyAction={busyAction}
                                empMap={empMap} readOnly={readOnly}
                                onMover={onMoverDevolucion}
                                onRecibir={onRecibirDevolucion}
                            />

                        </div>
                    </div>
                );
            })}

            {/* ── Cierre de bodega (7A.1) ── */}
            {allConfirmed && !readOnly && (
                <div className="border-t border-warning/30 pt-2.5 space-y-2">
                    {!row?.confirmado_correccion_at ? (
                        !row?.corregido_bodega_at ? (
                            !isBranch ? (
                                <div className="space-y-2">
                                    <p className="text-caption text-content-2 font-semibold">Todas las diferencias fueron resueltas — marca la corrección como completa</p>
                                    <div className="flex gap-2">
                                        <PortalInput
                                            aria-label="Nota de la corrección" className="flex-1" tono="success" compact
                                            value={corrNota} onChange={e => setCorrNota(e.target.value)}
                                            placeholder="Nota (opcional)…"
                                        />
                                        <Button tone="success" disabled={busyAction === 'corr_bodega'} onClick={() => onCorregirBodega?.(corrNota || null)}>{busyAction === 'corr_bodega' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar corregido'}</Button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-caption text-content-3 italic">Esperando que bodega marque la corrección…</p>
                            )
                        ) : isBranch ? (
                            <div className="space-y-2">
                                <div className="flex items-start gap-1.5 text-caption bg-success/10 rounded-lg px-2.5 py-1.5 border border-success/30">
                                    <CheckCircle2 size={10} className="text-success mt-0.5 shrink-0" />
                                    <div>
                                        <span className="font-semibold text-success-text">Bodega marcó la corrección</span>
                                        <EmpChip emp={corrBodegaEmp} size="xs" tono="success-text" />
                                        {row.corregido_bodega_nota && <p className="text-success italic">{row.corregido_bodega_nota}</p>}
                                    </div>
                                </div>
                                <Button tone="success" icon={Check} loading={busyAction === 'confirmar_corr'} onClick={() => onConfirmarCorreccion?.()}>Confirmar corrección recibida</Button>
                            </div>
                        ) : (
                            <p className="text-caption text-content-3 italic">Esperando confirmación de sucursal…</p>
                        )
                    ) : (
                        <div className="flex flex-wrap items-center gap-1.5 text-caption text-success-text">
                            <CheckCircle2 size={11} className="text-success shrink-0" />
                            <strong>Corrección confirmada</strong>
                            <EmpChip emp={corrConfEmp} size="xs" tono="success-text" />
                        </div>
                    )}
                </div>
            )}

            {/* ── Actividad ── */}
            {eventos.length > 0 && (
                <div className="border-t border-warning/30 pt-2 space-y-1.5">
                    <p className="text-micro text-content-2 uppercase tracking-widest font-bold">Actividad</p>
                    {eventos.map(ev => {
                        const emp       = ev.hecho_por ? empMap.get(ev.hecho_por) : null;
                        const itemName  = difItems.find(d => d.id === ev.pedido_item_id)?.products?.nombre;
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-caption text-content-2 flex-wrap">
                                <span className="text-content-3 shrink-0 tabular-nums">{fmtRelative(ev.created_at)}</span>
                                {emp ? <EmpChip emp={emp} size="xs" /> : <strong className="text-content-2">—</strong>}
                                <span>
                                    {EVENTO_LABEL[ev.tipo] ?? ev.tipo}
                                    {ev.resolucion_tipo && <em className="text-content-3"> ({RESOLUCION_LABEL[ev.resolucion_tipo] ?? ev.resolucion_tipo})</em>}
                                    {itemName && <span className="text-content-3"> · {itemName}</span>}
                                    {ev.nota && <span className="text-content-3 italic"> — {ev.nota}</span>}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {hiddenCount > 0 && (
                <Button tone="warning" onClick={() => setShowAll(s => !s)}>{showAll ? 'Ver menos ↑' : `Ver todas las diferencias (${difItems.length}) ↓`}</Button>
            )}
        </div>
    );
}
