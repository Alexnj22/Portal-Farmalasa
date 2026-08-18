import { useState } from 'react';
import {
    Check, X, Loader2, ArrowLeftRight, Hand, Clock, ShieldQuestion, Scale,
} from 'lucide-react';
import Button from '../../../components/common/Button';
import Notice from '../../../components/common/Notice';
import SegmentedControl from '../../../components/common/SegmentedControl';
import PortalInput from '../../../components/common/PortalInput';
import EmpChip from './EmpChip';
import { opcionesDe, opcionElegida, ayudaPara } from '../../../data/diferencias';
import { turnoDe } from '../../../utils/decisionDiferencia';

// La decisión de una diferencia, dentro de la tarjeta de su renglón.
//
// Regla del usuario (2026-08-17/18): toda diferencia tiene DOS salidas, y lo que
// las separa es **en qué plano se arregla**. La propone la SALA —que es la que
// está revisando—, bodega acepta o contrapropone la otra, y sin acuerdo decide
// SUPERVISIÓN.
//
// ── Por qué esto NO va en una tarjeta propia (2026-08-18) ──────────────────
// La primera versión metía cada estado en su propia caja de color adentro de la
// tarjeta del renglón: dos anillos concéntricos, que es justo lo que §5.1 de
// DESIGN.md prohíbe. El estado lo lleva la tarjeta con `data-tono` y esto vive
// suelto adentro, separado por una línea. Se ganaron ~90px por renglón, que con
// cuatro diferencias abiertas es media pantalla.
//
// ── Y por qué segmentado y no desplegable ─────────────────────────────────
// Son DOS opciones. Un `LiquidSelect` las esconde detrás de un clic, ocupa el
// ancho entero y trae una lupa que promete un buscador que no existe. §15.3: de
// una a tres opciones, segmentado — que además las deja comparar de un vistazo,
// que es exactamente lo que hay que hacer para elegir.

const ESPERA = {
    sala:        'Esperando que la sala decida',
    bodega:      'Esperando la respuesta de bodega',
    supervision: 'Lo está viendo supervisión',
};

const TITULO = {
    propuesta:       'La sala propone',
    contrapropuesta: 'Bodega propone la otra',
    escalada:        'Sin acuerdo',
    acordada:        'Acordado',
    confirmada:      'Resuelto',
};

// Los rótulos del circuito ANTERIOR. Sirven para LEER lo que ya quedó cerrado
// así — no para elegirlos: las salidas de hoy vienen de la tabla.
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

// El ícono dice el plano sin gastar una palabra: dos flechas = se mueve en el
// sistema, una mano = se resuelve con el producto.
const iconoDe = (op) => (op?.mueve === 'ninguno' ? Hand : ArrowLeftRight);

// Cuántos días faltan para que el plazo del «que lo manden» se venza. En días y
// no en horas: el plazo son 3 días corridos, y «en 71 horas» sugiere una
// precisión que la decisión no tiene.
function diasPara(iso) {
    if (!iso) return null;
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function DecisionDiferencia({
    item, catalogo = {}, esSala, esSupervision, empMap = new Map(),
    busyAction, readOnly = false, onDecidir, onConfirmarLlegada, onPedirFoto,
}) {
    const opciones = opcionesDe(catalogo, item.error_tipo);
    // El catálogo llega DESPUÉS del primer dibujo, así que un `useState` con
    // valor inicial se queda vacío para siempre: ninguna opción marcada, ninguna
    // explicación, y «Proponer» apagado sin decir por qué. Se ve en la captura
    // del 2026-08-18. La elección es la del usuario **si eligió**; si no, la
    // primera de la lista — que ya no depende de cuándo llegó.
    const [tocada, setTocada] = useState(null);
    const elegida = (tocada && opciones.some(o => o.valor === tocada))
        ? tocada
        : (opciones[0]?.valor ?? '');
    const [nota, setNota] = useState('');
    const [rechazando, setRechazando] = useState(false);
    const [motivoRech, setMotivoRech] = useState('');

    const estado  = item.resolucion_status ?? null;
    const turno   = turnoDe(estado, { esSala, esSupervision });
    const op      = opcionElegida(catalogo, item.error_tipo, item.resolucion_tipo);
    const ocupado = busyAction === `dif_${item.id}`;

    const quienPropuso = item.resuelto_por       ? empMap.get(item.resuelto_por)       : null;
    const quienAcepto  = item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por) : null;
    const quienRechazo = item.rechazado_por      ? empMap.get(item.rechazado_por)      : null;

    if (!opciones.length) return null;

    // Un renglón resuelto con el circuito ANTERIOR: su `resolucion_tipo` no
    // existe en el catálogo de hoy, así que no se puede decir de quién es el
    // turno ni ofrecer «De acuerdo» — la base lo rechazaría y quien apretara
    // vería un error que no explica nada.
    if (item.resolucion_tipo && !op && estado !== 'confirmada') {
        return (
            <Marco>
                <Notice variant="neutral" icon={Scale} compact>
                    Se propuso con la pantalla anterior. Hay que decidirla de nuevo.
                </Notice>
            </Marco>
        );
    }

    const decidir = (accion, tipo = null, txt = null) => onDecidir?.(item.id, accion, tipo, txt);

    // Proponer devolver un producto DAÑADO exige la foto: es lo único que bodega
    // puede mirar para decidir si amerita la devolución, y la base la rechaza
    // sin ella. Se pide en el modal, que es donde se puede adjuntar.
    const necesitaFoto = (valor) => item.error_tipo === 'danado'
        && opcionElegida(catalogo, item.error_tipo, valor)?.mueve === 'devolucion';

    // ── Nadie propuso todavía ─────────────────────────────────────────────────
    if (estado === null) {
        if (readOnly) return null;
        if (turno !== 'yo') return <Marco><Espera texto={ESPERA.sala} /></Marco>;

        const sel = opciones.find(o => o.valor === elegida);
        return (
            <Marco>
                <p className="text-micro font-black text-content-3 uppercase tracking-widest">
                    Cómo se arregla
                </p>
                <SegmentedControl
                    value={elegida} onChange={setTocada} label="Cómo se arregla"
                    layout="block" columns={2} tone="chart-3"
                    options={opciones.map(o => ({
                        value: o.valor, label: o.rotulo_corto ?? o.rotulo, icon: iconoDe(o),
                    }))}
                />
                {sel && (
                    <p className="text-caption text-content-2 leading-snug">
                        <strong className="font-semibold">{sel.rotulo}</strong>{' — '}
                        <span className="text-content-3">{ayudaPara(sel, { esSala, esSupervision })}</span>
                    </p>
                )}
                <div className="flex gap-2">
                    <PortalInput
                        aria-label="Nota de la decisión" className="flex-1" tono="chart-3" compact
                        value={nota} onChange={e => setNota(e.target.value)}
                        placeholder="Nota (opcional)…"
                    />
                    <Button tone="chart-3" loading={ocupado} disabled={!elegida}
                        onClick={() => (necesitaFoto(elegida)
                            ? onPedirFoto?.(item, elegida, nota || null)
                            : decidir('proponer', elegida, nota || null))}>
                        Proponer
                    </Button>
                </div>
            </Marco>
        );
    }

    const laOtra = opciones.find(o => o.valor !== item.resolucion_tipo);
    const dias   = diasPara(item.resolucion_vence_at);
    const Icono  = estado === 'escalada' ? ShieldQuestion : iconoDe(op);
    const rotulo = op?.rotulo ?? ROTULO_VIEJO[item.resolucion_tipo];

    return (
        <Marco>
            {/* La salida acordada es el dato, así que va primero y en grande —
                no como una etiqueta al lado de un título de estado. El estado lo
                dice el color de la tarjeta y el renglón de abajo. */}
            <div className="flex items-start gap-2">
                <Icono size={14} className="text-content-2 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                    <p className="text-label font-bold text-content leading-snug">{rotulo ?? '—'}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span className="text-caption text-content-3">{TITULO[estado] ?? estado}</span>
                        <EmpChip emp={quienPropuso} size="xs" tono="content-3" />
                    </div>
                </div>
            </div>

            {estado !== 'confirmada' && ayudaPara(op, { esSala, esSupervision }) && (
                <p className="text-caption text-content-3 leading-snug">
                    {ayudaPara(op, { esSala, esSupervision })}
                </p>
            )}
            {item.resolucion_nota && (
                <p className="text-caption text-content-2 italic">«{item.resolucion_nota}»</p>
            )}

            {estado === 'escalada' && item.nota_rechazo && (
                <Notice variant="danger" icon={X} compact
                    action={<EmpChip emp={quienRechazo} size="xs" tono="danger-text" />}>
                    «{item.nota_rechazo}»
                </Notice>
            )}

            {estado === 'acordada' && dias !== null && (
                <Notice variant={dias <= 0 ? 'warning' : 'neutral'} icon={Clock} compact>
                    {dias > 0
                        ? `Quedan ${dias} día${dias === 1 ? '' : 's'} para que llegue`
                        : 'Se venció el plazo. Hay que decidirla de nuevo.'}
                </Notice>
            )}

            {readOnly ? null : (<>
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
                            <Button variant="destructive" loading={ocupado} disabled={!motivoRech.trim()}
                                onClick={() => decidir('rechazar', null, motivoRech)}>Rechazar</Button>
                            <Button variant="ghost" onClick={() => setRechazando(false)}>✕</Button>
                        </div>
                    ) : (
                        <div className="flex gap-2 flex-wrap">
                            <Button tone="success" icon={Check} loading={ocupado}
                                onClick={() => decidir('aceptar')}>Aceptar</Button>
                            {/* Contraproponer sólo en la primera vuelta: a la
                                segunda, quien no está de acuerdo escala. */}
                            {estado === 'propuesta' && laOtra && (
                                <Button variant="secondary" icon={ArrowLeftRight} disabled={ocupado}
                                    onClick={() => decidir('contraproponer', laOtra.valor, null)}>
                                    Proponer {(laOtra.rotulo_corto ?? laOtra.rotulo).toLowerCase()}
                                </Button>
                            )}
                            {estado === 'contrapropuesta' && (
                                <Button variant="destructive" icon={X}
                                    onClick={() => setRechazando(true)}>Rechazar</Button>
                            )}
                        </div>
                    )
                )}

                {estado === 'escalada' && turno === 'yo' && (
                    <SegmentedControl
                        value={item.resolucion_tipo} label="Con cuál se queda" layout="block" columns={2}
                        tone="danger" disabled={ocupado}
                        onChange={v => decidir('supervisar', v, null)}
                        options={opciones.map(o => ({
                            value: o.valor, label: o.rotulo_corto ?? o.rotulo, icon: iconoDe(o),
                        }))}
                    />
                )}

                {estado === 'acordada' && op?.mueve === 'ninguno' && (() => {
                    const meToca = op.cierra_con === 'llegada_sala' ? esSala : !esSala;
                    if (!meToca && !esSupervision) {
                        return <Espera texto={op.cierra_con === 'llegada_sala'
                            ? 'Falta que la sala confirme que llegó'
                            : 'Falta que bodega confirme que lo tiene'} />;
                    }
                    return (
                        <div className="flex items-center gap-2 flex-wrap">
                            <Button tone="success" icon={Check} loading={ocupado}
                                onClick={() => onConfirmarLlegada?.(item.id)}>Confirmar llegada</Button>
                            <span className="text-micro text-content-3">
                                Con el producto en la mano. No sale ningún traslado.
                            </span>
                        </div>
                    );
                })()}

                {estado === 'acordada' && op?.mueve === 'traslado_a_sala' && (
                    <Notice variant="warning" icon={ArrowLeftRight} compact>
                        Falta que salga el traslado de bodega a la sala.
                    </Notice>
                )}

                {turno !== 'yo' && ESPERA[turno] && estado !== 'acordada' && (
                    <Espera texto={ESPERA[turno]} />
                )}
            </>)}

            {estado === 'confirmada' && quienAcepto && (
                <EmpChip emp={quienAcepto} prefijo="Cerrado por" size="xs" tono="success-text" />
            )}
        </Marco>
    );
}

// El bloque no es una tarjeta: es parte de la del renglón, separada por una
// línea. Ver la nota de arriba y §5.1 de DESIGN.md.
function Marco({ children }) {
    return <div className="border-t border-divider pt-2.5 space-y-2">{children}</div>;
}

function Espera({ texto }) {
    return (
        <p className="text-caption text-content-3 italic flex items-center gap-1.5">
            <Clock size={11} className="shrink-0" />{texto}
        </p>
    );
}
