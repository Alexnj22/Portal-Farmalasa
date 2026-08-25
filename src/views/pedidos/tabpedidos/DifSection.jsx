// Extracted from TabPedidos.jsx (Bloque 6.C) — differences (dif) resolution
// section shown inside an expanded pedido card.
import { useState, useEffect, useMemo } from 'react';
import Button from '../../../components/common/Button';
import { AlertCircle, CheckCircle2, X, Loader2, Check, ChevronDown, ChevronUp, ArrowRight, Clock } from 'lucide-react';
import { calcSolicitado, fmtRelative } from './helpers';
import Badge from '../../../components/common/Badge';
import PortalInput from '../../../components/common/PortalInput';
import DevolucionBloque from './DevolucionBloque';
import EmpChip from './EmpChip';
import DecisionDiferencia from './DecisionDiferencia';
import { fetchOpcionesDiferencia, opcionElegida } from '../../../data/diferencias';
import { tengoAlgoQueHacer } from '../../../utils/decisionDiferencia';

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

export default function DifSection({ row, difItems = [], eventos = [], devoluciones = [], isBranch, esSupervision = false, busyAction, empMap = new Map(), onCorregirBodega, onConfirmarCorreccion, onDecidirDiferencia, onConfirmarLlegada, onPedirFoto, onMoverDevolucion, onRecibirDevolucion, onProbarDevolucion, readOnly = false, onNeedItems, itemsLoaded = true }) {
    const [showAll,  setShowAll]  = useState(false);
    const [corrNota, setCorrNota] = useState('');
    const [catalogo, setCatalogo] = useState({});
    const [verResuelta, setVerResuelta] = useState(null);
    const [verActividad, setVerActividad] = useState(false);

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

    // ── Tres grupos, y el corte es «qué me toca» ─────────────────────────────
    //
    // Arriba, con la tarjeta entera, sólo lo que ESTA persona puede resolver
    // ahora. Lo demás —lo acordado esperando que llegue algo, y una propuesta
    // que espera al otro lado— baja a un renglón: no pide nada, y con el mismo
    // peso que lo accionable hace que la lista mienta sobre cuánto falta.
    //
    // Agrupar por ESTADO era el corte obvio y es peor de un lado: una propuesta
    // esperando a bodega no le pide nada a la sala y le seguía ocupando el
    // lugar. La regla vive en `tengoAlgoQueHacer`, probada.
    const clasificar = (r) => {
        if (r.resolucion_status === 'confirmada') return 'resuelta';
        const op  = opcionElegida(catalogo, r.error_tipo, r.resolucion_tipo);
        const dev = devPorItem.get(r.id) ?? null;
        return tengoAlgoQueHacer({
            estado: r.resolucion_status ?? null, op, dev,
            esSala: isBranch, esSupervision,
        }) ? 'mia' : 'esperando';
    };
    const mias      = difItems.filter(r => clasificar(r) === 'mia');
    const esperando = difItems.filter(r => clasificar(r) === 'esperando');
    const resueltas = difItems.filter(r => r.resolucion_status === 'confirmada');
    const allConfirmed = difItems.length > 0 && resueltas.length === difItems.length;
    const visibleItems = showAll ? mias : mias.slice(0, DIF_MAX);
    const hiddenCount  = mias.length - DIF_MAX;

    // Cierre a nivel sucursal (7A.1): backend listo desde 2026-06-21
    // (pedido_sucursal_status.corregido_bodega_*/confirmado_correccion_*),
    // solo faltaba este bloque de UI. Aparece tras confirmar cada item
    // individual — bodega marca la corrección global, sucursal la confirma.
    const corrBodegaEmp = row?.corregido_bodega_por      ? empMap.get(row.corregido_bodega_por)      : null;
    const corrConfEmp   = row?.confirmado_correccion_por ? empMap.get(row.confirmado_correccion_por) : null;

    return (
        <div className="border-t border-warning/30 px-4 py-3 space-y-3">
            {/* El ícono ya dice el estado: llevaba además un ✓ de texto pegado
                al final del rótulo, que en versalitas queda a otra altura. */}
            <div className="flex items-center gap-1.5">
                {allConfirmed
                    ? <CheckCircle2 size={12} className="text-success shrink-0" />
                    : <AlertCircle size={12} className="text-warning shrink-0" />}
                {/* El número cuenta lo que FALTA. Decía «pendiente resolución
                    (4)» con una ya resuelta adentro: un contador que incluye lo
                    hecho no sirve para saber cuánto queda, que es para lo único
                    que se mira. */}
                <span className={`text-caption font-semibold uppercase tracking-wide ${allConfirmed ? 'text-success-text' : 'text-warning-text'}`}>
                    {allConfirmed
                        ? `Diferencias resueltas${resueltas.length > 1 ? ` (${resueltas.length})` : ''}`
                        : `Diferencias — te toca resolver (${mias.length})`}
                </span>
                {!allConfirmed && (esperando.length > 0 || resueltas.length > 0) && (
                    <span className="text-caption text-content-3">
                        {[esperando.length && `${esperando.length} esperando`,
                          resueltas.length && `${resueltas.length} resuelta${resueltas.length > 1 ? 's' : ''}`]
                            .filter(Boolean).join(' · ')}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 items-start">
            {visibleItems.map(item => {
                const et      = ERROR_TIPO_LABEL[item.error_tipo];
                const res     = item.resolucion_status;
                const dev     = devPorItem.get(item.id) ?? null;

                // El estado lo lleva la TARJETA, con `data-tono` (§5.1). Antes
                // era un par borde+relleno a mano, y adentro cada estado ponía
                // OTRA caja de color: dos anillos concéntricos, que es
                // exactamente lo que ese canónico existe para evitar.
                const tono = res === 'escalada'        ? 'danger'
                           : res === 'acordada'        ? 'warning'
                           : res === 'contrapropuesta' ? 'chart-3'
                           : undefined;

                return (
                    <div key={item.id} data-surface="card" data-tono={tono}
                        className="rounded-card overflow-hidden px-3 py-2.5 space-y-1.5">
                        {/* Encabezado */}
                        <div className="flex items-center gap-2">
                            <span className="flex-1 text-label font-bold text-content truncate">{item.products?.nombre}</span>
                            {et && <Badge variant={et.variante} size="sm" className="shrink-0" uppercase={false}>{et.label}</Badge>}
                        </div>

                        {/* Las cifras son la EVIDENCIA del problema: de ahí sale
                            qué se decide y por cuánto. Estaban en el tamaño más
                            chico de la escala y en el tono más tenue, o sea al
                            pie de la tarjeta que existe por ellas. */}
                        <Cifras item={item} />

                        <div className="space-y-2">

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
                                onProbar={onProbarDevolucion}
                                onRecibir={onRecibirDevolucion}
                            />

                        </div>
                    </div>
                );
            })}
            </div>

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

            {hiddenCount > 0 && (
                <Button tone="warning" onClick={() => setShowAll(s => !s)}>
                    {showAll ? 'Ver menos ↑' : `Ver las ${mias.length} que te tocan ↓`}
                </Button>
            )}

            {/* ── Lo acordado o propuesto que espera al otro lado ──
                No pide nada a quien mira, pero tampoco está cerrado: el renglón
                dice de qué se está esperando, y se abre si alguien quiere el
                detalle o quiere adelantarse. */}
            {esperando.length > 0 && (
                <div className="space-y-1.5 pt-1">
                    <p className="text-micro font-black text-content-3 uppercase tracking-widest">
                        Esperando ({esperando.length})
                    </p>
                    {esperando.map(item => (
                        <FilaCompacta key={item.id} item={item} tono="warning" Icono={Clock}
                            abierta={verResuelta === item.id}
                            onToggle={() => setVerResuelta(v => (v === item.id ? null : item.id))}
                            derecha={<EsperandoA item={item} catalogo={catalogo} isBranch={isBranch} />}
                            catalogo={catalogo} empMap={empMap} dev={devPorItem.get(item.id) ?? null}
                            isBranch={isBranch} esSupervision={esSupervision}
                            onDecidirDiferencia={onDecidirDiferencia}
                            onConfirmarLlegada={onConfirmarLlegada}
                            onMoverDevolucion={onMoverDevolucion}
                            onProbarDevolucion={onProbarDevolucion}
                            onRecibirDevolucion={onRecibirDevolucion} />
                    ))}
                </div>
            )}

            {/* ── Las resueltas, plegadas ──
                Ocupaban lo mismo que una abierta y con una caja de color adentro
                de otra. Una diferencia cerrada no pide nada: se dice en un
                renglón —qué se hizo y quién lo cerró— y el detalle se abre si
                alguien lo busca. El chevron es la afordancia de plegar (§5.3);
                el ojo prometería «hay más para ver», que no es lo que hace. */}
            {!allConfirmed && resueltas.length > 0 && (
                <div className="space-y-1.5 pt-1">
                    <p className="text-micro font-black text-content-3 uppercase tracking-widest">
                        Ya resueltas ({resueltas.length})
                    </p>
                    {resueltas.map(item => (
                        <FilaCompacta key={item.id} item={item} tono="success" Icono={CheckCircle2}
                            abierta={verResuelta === item.id}
                            onToggle={() => setVerResuelta(v => (v === item.id ? null : item.id))}
                            derecha={<EmpChip emp={item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por) : null}
                                              size="xs" tono="success-text" />}
                            catalogo={catalogo} empMap={empMap} dev={devPorItem.get(item.id) ?? null}
                            isBranch={isBranch} esSupervision={esSupervision} readOnly />
                    ))}
                </div>
            )}

            {/* ── El historial, plegado ──
                Once renglones de bitácora en medio de lo que hay que decidir.
                Se consulta cuando algo no cuadra, no cada vez que se abre el
                pedido: va al final y cerrado, con el chevron que dice que
                pliega (§5.3). */}
            {eventos.length > 0 && (
                <div className="pt-1">
                    <button type="button" onClick={() => setVerActividad(v => !v)}
                        aria-expanded={verActividad}
                        className="flex items-center gap-1.5 text-micro font-black text-content-3 uppercase tracking-widest hover:text-content-2 transition-colors">
                        {verActividad ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        Actividad ({eventos.length})
                    </button>
                    {verActividad && (
                        <div className="space-y-1.5 pt-2">
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
                </div>
            )}

        </div>
    );
}


// Un renglón que no pide nada AHORA: lo acordado esperando que llegue algo, y
// lo ya cerrado. Lo que hay que poder leer sin abrir es qué se decidió y de qué
// se está esperando; el resto vive adentro.
//
// El chevron y no el ojo: acá se PLIEGA un grupo, y el ojo prometería «hay más
// para ver» (§5.3).
function FilaCompacta({
    item, tono, Icono, abierta, onToggle, derecha, catalogo, empMap, dev,
    isBranch, esSupervision, readOnly = false,
    onDecidirDiferencia, onConfirmarLlegada, onMoverDevolucion, onRecibirDevolucion, onProbarDevolucion,
}) {
    const et = ERROR_TIPO_LABEL[item.error_tipo];
    const hover = tono === 'success' ? 'hover:bg-success/5' : 'hover:bg-warning/5';
    const tinta = tono === 'success' ? 'text-success' : 'text-warning';
    return (
        <div data-surface="card" data-tono={tono} className="rounded-card overflow-hidden">
            <button type="button" onClick={onToggle} aria-expanded={abierta}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${hover}`}>
                <Icono size={13} className={`${tinta} shrink-0`} />
                <span className="flex-1 text-label font-semibold text-content-2 truncate">
                    {item.products?.nombre}
                </span>
                {et && <Badge variant={et.variante} size="sm" className="shrink-0 hidden sm:inline-flex" uppercase={false}>{et.label}</Badge>}
                {derecha}
                {abierta
                    ? <ChevronUp   size={14} className="text-content-3 shrink-0" />
                    : <ChevronDown size={14} className="text-content-3 shrink-0" />}
            </button>
            {abierta && (
                <div className="px-3 pb-2.5 space-y-2">
                    <Cifras item={item} />
                    <DecisionDiferencia item={item} catalogo={catalogo} esSala={isBranch}
                        esSupervision={esSupervision} empMap={empMap} readOnly={readOnly}
                        onDecidir={onDecidirDiferencia} onConfirmarLlegada={onConfirmarLlegada} />
                    <DevolucionBloque dev={dev} isBranch={isBranch} empMap={empMap} readOnly={readOnly}
                        onMover={onMoverDevolucion} onRecibir={onRecibirDevolucion}
                        onProbar={onProbarDevolucion} />
                </div>
            )}
        </div>
    );
}

// De qué se está esperando, en tres palabras. Es lo único que justifica que el
// renglón siga a la vista en vez de estar con los cerrados.
function EsperandoA({ item, catalogo, isBranch }) {
    const op = opcionElegida(catalogo, item.error_tipo, item.resolucion_tipo);
    const texto = item.resolucion_status === 'propuesta'      ? 'Contesta bodega'
                : item.resolucion_status === 'contrapropuesta' ? 'Contesta la sala'
                : item.resolucion_status === 'escalada'        ? 'Lo ve supervisión'
                : op?.mueve === 'traslado_a_sala'              ? 'Falta el traslado'
                : op?.mueve === 'devolucion'                   ? 'Falta el traslado'
                : op?.cierra_con === 'llegada_sala'            ? (isBranch ? 'Falta que llegue' : 'Lo confirma la sala')
                : op?.cierra_con === 'llegada_bodega'          ? (isBranch ? 'Lo confirma bodega' : 'Falta que llegue')
                : null;
    if (!texto) return null;
    return <span className="text-caption text-warning-text shrink-0 hidden sm:inline">{texto}</span>;
}

// Las tres cifras del renglón, que son de lo que trata la tarjeta.
//
// «Solicitado» y «Enviado» pueden no coincidir y eso NO es un error: el
// despacho redondea a la unidad en que se empaca (9 pedidos salen como 20
// frascos). Verlas juntas es lo que hace entendible el número de abajo.
function Cifra({ rotulo, valor, tono = 'text-content' }) {
    return (
        <div>
            <p className="text-micro font-black text-content-3 uppercase tracking-widest leading-none">{rotulo}</p>
            <p className={`text-body-xl font-black tabular-nums leading-tight ${tono}`}>{valor ?? '—'}</p>
        </div>
    );
}

function Cifras({ item }) {
    const sol      = calcSolicitado(item);
    const enviado  = item.cantidad_enviada ?? item.cantidad_asignada;
    const fisico   = item.cantidad_recibida;
    const delta    = (fisico == null || enviado == null) ? null : fisico - enviado;
    const tonoFis  = delta == null || delta === 0 ? 'text-content'
                   : delta < 0 ? 'text-danger-text' : 'text-success-text';
    return (
        <div className="flex items-end gap-4 flex-wrap">
            {sol != null && <Cifra rotulo="Solicitado" valor={sol} tono="text-content-2" />}
            <Cifra rotulo="Enviado" valor={enviado} tono="text-content-2" />
            <ArrowRight size={13} className="text-content-3 mb-1.5 shrink-0" />
            <Cifra rotulo="Físico" valor={fisico} tono={tonoFis} />
            {delta != null && delta !== 0 && (
                <Badge variant={delta < 0 ? 'danger' : 'success'} size="sm" uppercase={false} className="mb-1">
                    {delta < 0 ? `Faltan ${-delta}` : `${delta} de más`}
                </Badge>
            )}
        </div>
    );
}
