import { useState } from 'react';
import { Scale, Check, X, Loader2, ArrowLeftRight, Hand, Clock, ShieldQuestion } from 'lucide-react';
import Button from '../../../components/common/Button';
import Badge from '../../../components/common/Badge';
import Notice from '../../../components/common/Notice';
import LiquidSelect from '../../../components/common/LiquidSelect';
import PortalInput from '../../../components/common/PortalInput';
import EmpChip from './EmpChip';
import { opcionesDe, opcionElegida } from '../../../data/diferencias';
import { turnoDe } from '../../../utils/decisionDiferencia';

// La decisión de una diferencia, pegada a su renglón.
//
// Regla del usuario (2026-08-17/18): toda diferencia tiene DOS salidas, y lo que
// las separa es **en qué plano se arregla**. La propone la SALA —que es la que
// está revisando—, bodega acepta o contrapropone la otra, y sin acuerdo decide
// SUPERVISIÓN. Nada se mueve hasta que coinciden dos personas distintas.
//
// Por qué esto reemplaza a la lista de resolución vieja: aquélla la elegía
// BODEGA y la sala sólo confirmaba, y encima convivía con el botón «Devolver a
// bodega» — dos conversaciones sobre el mismo renglón, que es la forma de que
// una diga que sí y la otra que no. Acá hay una sola.

const ESPERA = {
    sala:        'Esperando que la sala decida…',
    bodega:      'Esperando la respuesta de bodega…',
    supervision: 'Sin acuerdo — lo está viendo supervisión…',
};

// Los rótulos del circuito ANTERIOR. Sirven para poder LEER lo que ya quedó
// cerrado así — no para elegirlos: las salidas de hoy vienen de la tabla.
const ROTULO_VIEJO = {
    envio_fisico:        'Enviar producto',
    ajuste_sistema:      'Ajuste en sistema',
    aceptar_sobrante:    'La sala se quedó con el sobrante',
    devolver_bodega:     'Devolver a bodega',
    devolucion_aceptada: 'Devolución aceptada',
    devolucion_negada:   'Devolución negada',
    aceptar_dif_pres:    'Diferencia de presentación aceptada',
    resuelto:            'Resuelto',
    no_aplica:           'Sin solución',
};

const MARCO = {
    propuesta:       'border-chart-3/30 bg-chart-3/10',
    contrapropuesta: 'border-chart-4/30 bg-chart-4/10',
    escalada:        'border-danger/40 bg-danger/10',
    acordada:        'border-warning/40 bg-warning/10',
    confirmada:      'border-success/30 bg-success/10',
};

const ROTULO_ESTADO = {
    propuesta:       'La sala propone',
    contrapropuesta: 'Bodega propone otra salida',
    escalada:        'Sin acuerdo — decide supervisión',
    acordada:        'De acuerdo — falta cerrarlo',
    confirmada:      'Resuelto',
};

// Cuántos días faltan para que el plazo del «te lo mando» se venza. En días y no
// en horas porque el plazo son 3 días corridos: decir «en 71 horas» sugiere una
// precisión que la decisión no tiene.
function diasPara(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / 86_400_000);
}

export default function DecisionDiferencia({
    item, catalogo = {}, esSala, esSupervision, empMap = new Map(),
    busyAction, readOnly = false, onDecidir, onConfirmarLlegada, onPedirFoto,
}) {
    const opciones = opcionesDe(catalogo, item.error_tipo);
    const [elegida,  setElegida]  = useState(() => opciones[0]?.valor ?? '');
    const [nota,     setNota]     = useState('');
    const [rechazando, setRechazando] = useState(false);
    const [motivoRech, setMotivoRech] = useState('');

    const estado  = item.resolucion_status ?? null;
    const turno   = turnoDe(estado, { esSala, esSupervision });
    const op      = opcionElegida(catalogo, item.error_tipo, item.resolucion_tipo);
    const ocupado = busyAction === `dif_${item.id}`;

    const quienPropuso = item.resuelto_por       ? empMap.get(item.resuelto_por)       : null;
    const quienAcepto  = item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por) : null;
    const quienRechazo = item.rechazado_por      ? empMap.get(item.rechazado_por)      : null;

    // Sin catálogo no se ofrece nada. Es preferible a pintar una lista vacía que
    // parece un error de la persona.
    if (!opciones.length) return null;

    // Un renglón resuelto con el circuito ANTERIOR: bodega elegía de otra lista
    // y la sala confirmaba. Su `resolucion_tipo` no existe en el catálogo de
    // hoy, así que no se puede decir de quién es el turno ni ofrecer «De
    // acuerdo» — la base lo rechazaría con OPCION_INVALIDA y quien apretara
    // vería un error que no explica nada. Se muestra lo que quedó anotado y
    // nada más; los que quedaron a medias se reabrieron el 2026-08-18.
    const esDelCircuitoViejo = !!item.resolucion_tipo && !op;
    if (esDelCircuitoViejo && estado !== 'confirmada') {
        return (
            <Notice variant="neutral" icon={Scale} compact>
                Esta diferencia se propuso con el circuito anterior. Hay que volver a
                decidirla con las dos salidas.
            </Notice>
        );
    }

    const decidir = (accion, tipo = null, txt = null) =>
        onDecidir?.(item.id, accion, tipo, txt);

    // Proponer devolver un producto DAÑADO exige la foto: es lo único que bodega
    // puede mirar para decidir si amerita la devolución o si todavía se vende, y
    // la base lo rechaza sin ella. Se pide en el modal, que es donde se puede
    // adjuntar; las demás salidas se proponen acá mismo.
    const necesitaFoto = (valor) => item.error_tipo === 'danado'
        && opcionElegida(catalogo, item.error_tipo, valor)?.mueve === 'devolucion';

    // ── Todavía nadie propuso ─────────────────────────────────────────────────
    if (estado === null) {
        if (readOnly) return null;
        if (turno !== 'yo') {
            return <p className="text-caption text-content-3 italic">{ESPERA.sala}</p>;
        }
        const ayuda = opciones.find(o => o.valor === elegida)?.ayuda;
        return (
            <div data-surface="card" className="rounded-xl border px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                    <Scale size={12} className="text-content-2 shrink-0" />
                    <span className="text-label font-bold text-content-2">¿Cómo se arregla?</span>
                </div>
                <LiquidSelect
                    value={elegida}
                    onChange={v => setElegida(v)}
                    options={opciones.map(o => ({ value: o.valor, label: o.rotulo }))}
                    compact
                    clearable={false}
                />
                {ayuda && <p className="text-caption text-content-3">{ayuda}</p>}
                <div className="flex gap-2">
                    <PortalInput
                        aria-label="Nota de la decisión" className="flex-1" tono="chart-3" compact
                        value={nota} onChange={e => setNota(e.target.value)}
                        placeholder="Nota (opcional)…"
                    />
                    <Button tone="chart-3" disabled={ocupado || !elegida}
                        onClick={() => (necesitaFoto(elegida)
                            ? onPedirFoto?.(item, elegida, nota || null)
                            : decidir('proponer', elegida, nota || null))}>
                        {ocupado ? <Loader2 size={10} className="animate-spin" /> : 'Proponer'}
                    </Button>
                </div>
            </div>
        );
    }

    const laOtra = opciones.find(o => o.valor !== item.resolucion_tipo);
    const dias   = diasPara(item.resolucion_vence_at);

    return (
        <div data-surface="card" className={`rounded-xl border px-3 py-2.5 space-y-2 ${MARCO[estado] ?? ''}`}>
            <div className="flex items-center gap-2 flex-wrap">
                {estado === 'escalada'
                    ? <ShieldQuestion size={12} className="text-danger shrink-0" />
                    : <Scale size={12} className="text-content-2 shrink-0" />}
                <span className="text-label font-bold text-content-2">{ROTULO_ESTADO[estado] ?? estado}</span>
                {(op || ROTULO_VIEJO[item.resolucion_tipo]) && (
                    <Badge variant="neutral" size="sm" uppercase={false}
                        icon={!op || op.mueve === 'ninguno' ? Hand : ArrowLeftRight}>
                        {op?.rotulo ?? ROTULO_VIEJO[item.resolucion_tipo]}
                    </Badge>
                )}
            </div>

            {op?.ayuda && <p className="text-caption text-content-3">{op.ayuda}</p>}

            {(quienPropuso || item.resolucion_nota) && (
                <div className="flex items-center gap-2 flex-wrap text-caption text-content-2">
                    {item.resolucion_nota && <span className="italic">«{item.resolucion_nota}»</span>}
                    <EmpChip emp={quienPropuso} size="xs" />
                </div>
            )}

            {/* Lo que dijo quien no estuvo de acuerdo. Es lo que supervisión
                necesita leer para decidir, así que se muestra siempre, no sólo
                del lado de quien rechazó. */}
            {estado === 'escalada' && item.nota_rechazo && (
                <Notice variant="danger" icon={X} compact
                    action={<EmpChip emp={quienRechazo} size="xs" tono="danger-text" />}>
                    «{item.nota_rechazo}»
                </Notice>
            )}

            {/* El plazo del «que bodega mande el producto». Se dice en la
                tarjeta y no sólo en el aviso: quien la abre tiene que ver que
                hay un reloj corriendo. */}
            {estado === 'acordada' && dias !== null && (
                <Notice variant={dias <= 0 ? 'warning' : 'neutral'} icon={Clock} compact>
                    {dias > 0
                        ? `Quedan ${dias} día${dias === 1 ? '' : 's'} para que llegue`
                        : 'Se venció el plazo — hay que decidir de nuevo'}
                </Notice>
            )}

            {readOnly ? null : (<>
                {/* ── Me toca contestar ────────────────────────────────────── */}
                {turno === 'yo' && (estado === 'propuesta' || estado === 'contrapropuesta') && (
                    rechazando ? (
                        <div className="flex gap-2">
                            <PortalInput
                                aria-label="Por qué no" className="flex-1" tono="danger" compact autoFocus
                                value={motivoRech} onChange={e => setMotivoRech(e.target.value)}
                                placeholder="Por qué no… (lo lee supervisión)"
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && motivoRech.trim()) decidir('rechazar', null, motivoRech);
                                    if (e.key === 'Escape') setRechazando(false);
                                }}
                            />
                            <Button variant="destructive" disabled={ocupado || !motivoRech.trim()}
                                onClick={() => decidir('rechazar', null, motivoRech)}>
                                {ocupado ? <Loader2 size={10} className="animate-spin" /> : 'No estoy de acuerdo'}
                            </Button>
                            <Button variant="ghost" onClick={() => setRechazando(false)}>✕</Button>
                        </div>
                    ) : (
                        <div className="flex gap-2 flex-wrap">
                            <Button tone="success" icon={Check} loading={ocupado}
                                onClick={() => decidir('aceptar')}>De acuerdo</Button>
                            {/* Contraproponer sólo existe en la primera vuelta:
                                a la segunda, quien no está de acuerdo escala. */}
                            {estado === 'propuesta' && laOtra && (
                                <Button variant="secondary" icon={ArrowLeftRight} disabled={ocupado}
                                    onClick={() => decidir('contraproponer', laOtra.valor, null)}>
                                    Mejor: {laOtra.rotulo}
                                </Button>
                            )}
                            {estado === 'contrapropuesta' && (
                                <Button variant="destructive" icon={X}
                                    onClick={() => setRechazando(true)}>No estoy de acuerdo</Button>
                            )}
                        </div>
                    )
                )}

                {/* ── Supervisión desempata ────────────────────────────────── */}
                {estado === 'escalada' && turno === 'yo' && (
                    <div className="flex gap-2 flex-wrap">
                        {opciones.map(o => (
                            <Button key={o.valor} variant="secondary" disabled={ocupado}
                                onClick={() => decidir('supervisar', o.valor, null)}>
                                {o.rotulo}
                            </Button>
                        ))}
                    </div>
                )}

                {/* ── Acordado y se arregla en FÍSICO: falta que llegue ────── */}
                {estado === 'acordada' && op?.mueve === 'ninguno' && (() => {
                    const meTocaFirmar = op.cierra_con === 'llegada_sala' ? esSala : !esSala;
                    if (!meTocaFirmar && !esSupervision) {
                        return (
                            <p className="text-caption text-content-3 italic">
                                {op.cierra_con === 'llegada_sala'
                                    ? 'Falta que la sala confirme que llegó.'
                                    : 'Falta que bodega confirme que lo tiene.'}
                            </p>
                        );
                    }
                    return (
                        <div className="space-y-1.5">
                            <Button tone="success" icon={Check} loading={ocupado}
                                onClick={() => onConfirmarLlegada?.(item.id)}>
                                Ya lo tengo
                            </Button>
                            <p className="text-micro text-content-3 leading-snug">
                                Confírmalo con el producto en la mano, no antes. No mueve nada en
                                el sistema — es la constancia de que llegó.
                            </p>
                        </div>
                    );
                })()}

                {/* ── Acordado y se arregla en el SISTEMA ──────────────────── */}
                {estado === 'acordada' && op?.mueve === 'traslado_a_sala' && (
                    <Notice variant="warning" icon={ArrowLeftRight} compact>
                        Falta que salga el traslado de bodega a la sala.
                    </Notice>
                )}

                {/* Turnos ajenos: se dice de quién se espera, no se calla. */}
                {turno !== 'yo' && ESPERA[turno] && estado !== 'acordada' && (
                    <p className="text-caption text-content-3 italic">{ESPERA[turno]}</p>
                )}
            </>)}

            {estado === 'confirmada' && quienAcepto && (
                <EmpChip emp={quienAcepto} prefijo="Cerrado por" size="xs" tono="success-text" />
            )}
        </div>
    );
}
