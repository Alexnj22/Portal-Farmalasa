// Extracted from TabPedidos.jsx (Bloque 6.C) — differences (dif) resolution
// section shown inside an expanded pedido card.
import { useState, useEffect, useMemo } from 'react';
import Button from '../../../components/common/Button';
import { AlertCircle, CheckCircle2, X, Loader2, Check, ChevronDown, ChevronUp, ArrowRight, Clock } from 'lucide-react';
import { calcSolicitado, fmtRelative, fmtDia, fmtHM } from './helpers';
import { ERP_NAMES } from '../../../constants/erp';
import Badge from '../../../components/common/Badge';
import Notice from '../../../components/common/Notice';
import PortalInput from '../../../components/common/PortalInput';
import DevolucionBloque from './DevolucionBloque';
import EvidenciaFotos from '../../../components/common/EvidenciaFotos';
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
    // Cortos, pero que digan qué pasó. «propuso cómo se arregla» y «estuvo de
    // acuerdo» no decían con QUÉ, y el paso siguiente quedaba colgado del
    // anterior para entenderse.
    diferencia_proponer:     'propuso qué hacer',
    diferencia_contraproponer:'propuso la otra salida',
    diferencia_aceptar:      'aceptó la propuesta',
    diferencia_escalada:     'no estuvo de acuerdo — pasó a supervisión',
    diferencia_supervisar:   'lo decidió supervisión',
    diferencia_llegada:      'confirmó que lo tiene',
    devolucion_solicitada:   'pidió la devolución',
    devolucion_aceptada:     'aceptó la devolución',
    devolucion_rechazada:    'no aceptó la devolución',
    devolucion_recibida:     'recibió la devolución en bodega',
    correccion_conteo:       'corrigió lo contado',
    // Los tres de abajo faltaban y salían CRUDOS a la pantalla: la actividad
    // del pedido #150 mostraba «traslado_recibido» tal cual, que además nombra
    // la tubería y no el negocio. Un rótulo que falta no da error: imprime la
    // clave interna y parece un dato.
    traslado_recibido:       'confirmó la entrada al inventario',
    extra_anotado:           'anotó un producto que llegó de más',
    extra_quitado:           'quitó lo que había anotado de más',
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

    // La bitácora de abajo, sólo si dice algo que los carriles no.
    //
    // Cada diferencia cerrada cuenta sus pasos adentro de su propio renglón, con
    // el mismo vocabulario y en el mismo orden. Con una sola diferencia, la
    // «Actividad» del pie eran los MISMOS cuatro renglones bajo un segundo
    // título — que es justo lo que hace que una pantalla se lea desordenada.
    // Con dos o más sigue apareciendo: ahí la cronología cruzada no es una
    // repetición, es la única vista que las entrelaza.
    const idsConCarril = new Set(resueltas.map(r => r.id));
    const eventosFueraDeUnCarril = eventos.filter(e => !idsConCarril.has(e.pedido_item_id));
    const visibleItems = showAll ? mias : mias.slice(0, DIF_MAX);
    const hiddenCount  = mias.length - DIF_MAX;

    // Cierre a nivel sucursal (7A.1): backend listo desde 2026-06-21
    // (pedido_sucursal_status.corregido_bodega_*/confirmado_correccion_*),
    // solo faltaba este bloque de UI. Aparece tras confirmar cada item
    // individual — bodega marca la corrección global, sucursal la confirma.
    const corrBodegaEmp = row?.corregido_bodega_por      ? empMap.get(row.corregido_bodega_por)      : null;
    const corrConfEmp   = row?.confirmado_correccion_por ? empMap.get(row.confirmado_correccion_por) : null;
    // «la sucursal» no le dice a nadie CUÁL. La tarjeta es de una sala concreta
    // y su nombre ya está a mano.
    const nombreSala    = ERP_NAMES[row?.erp_sucursal_id] ?? 'la sala';

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
                            catalogo={catalogo} empMap={empMap} dev={devPorItem.get(item.id) ?? null} eventos={eventos}
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
                el ojo prometería «hay más para ver», que no es lo que hace.

                Se pintan SIEMPRE. Llevaban un `!allConfirmed` delante, o sea que
                desaparecían justo cuando TODAS estaban resueltas — el único
                estado donde el encabezado dice «Diferencias resueltas» en verde
                y debajo no quedaba una sola fila. Reportado el 2026-09-02:
                «¿cómo veo las diferencias resueltas? por trazabilidad, para ver
                qué pasó». El detalle ya existía entero —Enviado → Físico con su
                diferencia, la salida acordada, quién propuso, quién cerró y el
                traslado con su clave—: lo único que faltaba era poder llegar.

                El rótulo del grupo sólo aparece cuando hay otra cosa al lado.
                Con todas resueltas, el encabezado de la sección ya lo dijo. */}
            {/* Dos columnas mientras están PLEGADAS. Tres cerradas pasan de
                190 a 130 px de alto y se leen de un vistazo, que es para lo que
                se miran.
                Con una abierta vuelve a UNA columna: la abierta mide 390 px y
                su vecina 40, así que la grilla dejaba media pantalla en blanco
                al lado de una fila corta — y encima le daba al carril la mitad
                del ancho justo cuando es lo que hay que leer. Medido en 1440. */}
            {resueltas.length > 0 && (
                <div className={`pt-1 ${resueltas.length > 1 && !resueltas.some(r => r.id === verResuelta)
                    ? 'grid grid-cols-1 xl:grid-cols-2 gap-2 items-start'
                    : 'space-y-1.5'}`}>
                    {!allConfirmed && (
                        <p className="text-micro font-black text-content-3 uppercase tracking-widest">
                            Ya resueltas ({resueltas.length})
                        </p>
                    )}
                    {resueltas.map(item => (
                        <FilaCompacta key={item.id} item={item} tono="success" Icono={CheckCircle2}
                            abierta={verResuelta === item.id}
                            onToggle={() => setVerResuelta(v => (v === item.id ? null : item.id))}
                            derecha={<EmpChip emp={item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por) : null}
                                              size="xs" tono="success-text" />}
                            catalogo={catalogo} empMap={empMap} dev={devPorItem.get(item.id) ?? null} eventos={eventos}
                            isBranch={isBranch} esSupervision={esSupervision} readOnly />
                    ))}
                </div>
            )}

            {/* ── Para cerrar — el último paso, y ya no en letra chica ──────
                Era un renglón en gris itálico de 11 px al pie: «Esperando
                confirmación de sucursal…». Reportado el 2026-09-02 mirando
                justo ese estado: *«no dice que ya fue finalizado todo, sigue
                pendiente que lo acepten en Salud 5»*. La tarjeta se leía
                terminada —encabezado verde, cuatro pasos con su punto verde— y
                lo único que decía que faltaba algo era la línea que menos pesa
                de toda la pantalla.

                Ahora es un `Notice`, dice QUIÉN tiene que hacerlo con el nombre
                de la sala, y trae la fecha y la hora del paso que ya se dio. Se
                pinta también sin permiso de edición: ver en qué quedó el pedido
                no es lo mismo que poder cerrarlo, y ocultarlo dejaba a media
                empresa leyendo una tarjeta que parecía terminada. */}
            {allConfirmed && (
                <div className="border-t border-divider pt-2.5 space-y-2">
                    <p className="text-micro font-black text-content-3 uppercase tracking-widest">
                        Para cerrar
                    </p>

                    {row?.confirmado_correccion_at ? (
                        <Notice variant="success" icon={CheckCircle2}
                            action={<EmpChip emp={corrConfEmp} size="xs" tono="success-text" />}>
                            Cerrado. La sala confirmó que recibió la corrección
                            {' · '}{fmtDia(row.confirmado_correccion_at)} {fmtHM(row.confirmado_correccion_at)}
                        </Notice>
                    ) : row?.corregido_bodega_at ? (
                        isBranch ? (
                            <Notice variant="warning" icon={Clock}
                                action={readOnly ? null : (
                                    <Button tone="success" icon={Check} loading={busyAction === 'confirmar_corr'}
                                        onClick={() => onConfirmarCorreccion?.()}>Confirmar corrección recibida</Button>
                                )}>
                                Bodega ya marcó la corrección
                                {' · '}{fmtDia(row.corregido_bodega_at)} {fmtHM(row.corregido_bodega_at)}
                                {' — '}falta que confirmes que la recibiste.
                                {row.corregido_bodega_nota && <em className="block not-italic opacity-80">«{row.corregido_bodega_nota}»</em>}
                            </Notice>
                        ) : (
                            <Notice variant="warning" icon={Clock}
                                action={<EmpChip emp={corrBodegaEmp} size="xs" tono="warning-text" />}>
                                Falta que <strong>{nombreSala}</strong> confirme que recibió la corrección.
                                {' '}Bodega la marcó el {fmtDia(row.corregido_bodega_at)} a las {fmtHM(row.corregido_bodega_at)}
                            </Notice>
                        )
                    ) : (isBranch || readOnly) ? (
                        <Notice variant="warning" icon={Clock}>
                            Falta que <strong>bodega</strong> marque la corrección como completa.
                        </Notice>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-caption text-content-2">
                                {resueltas.length === 1
                                    ? 'La diferencia está resuelta.'
                                    : `Las ${resueltas.length} diferencias están resueltas.`}
                                {' '}Marca la corrección como completa y {nombreSala} tendrá que confirmar que la recibió.
                            </p>
                            <div className="flex gap-2">
                                <PortalInput
                                    aria-label="Nota de la corrección" className="flex-1" tono="success" compact
                                    value={corrNota} onChange={e => setCorrNota(e.target.value)}
                                    placeholder="Nota (opcional)…"
                                />
                                <Button tone="success" disabled={busyAction === 'corr_bodega'} onClick={() => onCorregirBodega?.(corrNota || null)}>{busyAction === 'corr_bodega' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar corregido'}</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── El historial, plegado ──
                Once renglones de bitácora en medio de lo que hay que decidir.
                Se consulta cuando algo no cuadra, no cada vez que se abre el
                pedido: va al final y cerrado, con el chevron que dice que
                pliega (§5.3). */}
            {eventosFueraDeUnCarril.length > 0 && (
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
    item, tono, Icono, abierta, onToggle, derecha, catalogo, empMap, dev, eventos = [],
    isBranch, esSupervision, readOnly = false,
    onDecidirDiferencia, onConfirmarLlegada, onMoverDevolucion, onRecibirDevolucion, onProbarDevolucion,
}) {
    // Cerrada = ya no hay nada que decidir, así que lo que queda es CONTAR qué
    // pasó. `DecisionDiferencia` y `DevolucionBloque` existen para actuar y
    // sobre una cerrada repetían el mismo hecho desde dos lados.
    //
    // Pero sólo si hay pasos que contar: una diferencia vieja, cerrada antes de
    // que existiera la bitácora del renglón, no tiene ni un evento. Ahí el
    // carril quedaría vacío y se perdería lo único que se sabe de ella —la
    // salida acordada y quién la cerró—, así que se muestra como antes.
    const hayPasos = eventos.some(e => e.pedido_item_id === item.id);
    const cerrada  = item.resolucion_status === 'confirmada' && hayPasos;
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
                    {cerrada ? (
                        <ProcesoDeLaDiferencia item={item} eventos={eventos}
                            empMap={empMap} catalogo={catalogo} dev={dev} />
                    ) : (
                        <>
                            <DecisionDiferencia item={item} catalogo={catalogo} esSala={isBranch}
                                esSupervision={esSupervision} empMap={empMap} readOnly={readOnly}
                                onDecidir={onDecidirDiferencia} onConfirmarLlegada={onConfirmarLlegada} />
                            <DevolucionBloque dev={dev} isBranch={isBranch} empMap={empMap} readOnly={readOnly}
                                onMover={onMoverDevolucion} onRecibir={onRecibirDevolucion}
                                onProbar={onProbarDevolucion} />
                        </>
                    )}
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

/**
 * Cómo se resolvió una diferencia, leído como lo que es: una secuencia.
 *
 * Antes eran tres bloques apilados —las cifras, la decisión, el movimiento— sin
 * nada que dijera que son PASOS. Los nombres aparecían cuatro veces sin decir
 * qué hizo cada uno, no había una sola hora, y el mismo hecho se contaba dos
 * veces («Entró en la sala» arriba y «Pedida por» abajo). Reportado el
 * 2026-09-02: «que se entienda más cómo fue el proceso, más ordenado».
 *
 * No inventa nada: son los eventos del renglón, que ya traen el verbo, quién y
 * cuándo, en orden. Y el vocabulario es el MISMO `EVENTO_LABEL` de la actividad
 * de abajo — dos listas de rótulos para los mismos hechos es cómo se
 * desincronizan.
 *
 * El hilo se dibuja por tramo, de un punto al siguiente, y no como una línea
 * detrás de todos: así el punto no necesita un aro del color del fondo para
 * taparla, y el fondo de esta tarjeta cambia con el tono.
 */
function ProcesoDeLaDiferencia({ item, eventos = [], empMap, catalogo, dev }) {
    const pasos = useMemo(() => eventos
        .filter(e => e.pedido_item_id === item.id)
        .slice()
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    [eventos, item.id]);

    if (!pasos.length) return null;

    return (
        <div className="border-t border-divider pt-2.5">
            <p className="text-micro font-black text-content-3 uppercase tracking-widest mb-2">
                Cómo se resolvió
            </p>
            {/* Con el tope, la hora queda a la derecha DEL PASO. Sin él, en una
                tarjeta de 1900 px el verbo y su hora terminan a 1.500 px de
                distancia y dejan de leerse como el mismo renglón. */}
            <ol className="space-y-2 max-w-2xl">
                {pasos.map((ev, i) => {
                    const ultimo  = i === pasos.length - 1;
                    const emp     = ev.hecho_por ? empMap.get(ev.hecho_por) : null;
                    // La salida acordada viaja pegada a TODOS los eventos desde
                    // que alguien la propone, así que decirla en cada paso la
                    // repetía tres veces. Se dice cuando CAMBIA — que además es
                    // justo lo que hay que ver en una contrapropuesta, donde el
                    // segundo turno elige la otra.
                    const previa  = i > 0 ? pasos[i - 1].resolucion_tipo : null;
                    const salida  = (ev.resolucion_tipo && ev.resolucion_tipo !== previa)
                        ? (opcionElegida(catalogo, item.error_tipo, ev.resolucion_tipo)?.rotulo
                            ?? RESOLUCION_LABEL[ev.resolucion_tipo] ?? ev.resolucion_tipo)
                        : null;
                    return (
                        // Dos columnas y no un `flex-wrap` con `ms-auto`: en un
                        // teléfono de 390 el paso más largo empujaba la hora a un
                        // renglón propio, alineada a la derecha y sola. Con la
                        // hora en su columna, el verbo envuelve y la hora se
                        // queda arriba a la derecha, que es donde se la busca.
                        <li key={ev.id}
                            className="relative ps-5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-baseline">
                            <span aria-hidden
                                className={`absolute left-0 top-[5px] w-2 h-2 rounded-full ${
                                    ultimo ? 'bg-success' : 'bg-content-3'}`} />
                            {/* El hilo va de este punto al siguiente. `--divider`
                                a 1px es casi invisible sobre la tarjeta teñida y
                                sin él la lista deja de leerse como una secuencia,
                                que es lo único que este bloque tiene que decir. */}
                            {!ultimo && (
                                <span aria-hidden
                                    className="absolute left-[3.5px] top-[15px] -bottom-2 w-px bg-content-3/40" />
                            )}
                            <span className="text-label font-semibold text-content-2 min-w-0">
                                {EVENTO_LABEL[ev.tipo] ?? ev.tipo}
                                {emp && <span className="ms-1.5"><EmpChip emp={emp} size="xs" /></span>}
                            </span>
                            {/* Fecha Y hora, en dos renglones. Sólo la hora se
                                lee bien el mismo día y deja de decir nada la
                                semana siguiente, que es cuando alguien viene a
                                ver qué pasó. En dos renglones entra en 390 sin
                                empujar al verbo. */}
                            <span className="text-micro text-content-3 tabular-nums whitespace-nowrap text-right leading-tight">
                                <span className="block text-content-3/70">{fmtDia(ev.created_at)}</span>
                                {fmtHM(ev.created_at)}
                            </span>
                            {(salida || ev.nota) && (
                                <div className="col-span-2">
                                    {salida && (
                                        <p className="text-caption text-content-2 leading-snug">{salida}</p>
                                    )}
                                    {ev.nota && (
                                        <p className="text-caption text-content-3 leading-snug">{ev.nota}</p>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ol>

            {/* Lo que el carril no puede contar: la foto del daño y el aviso de
                un movimiento que salió mal. El resto del bloque de movimiento
                —el rótulo, quién lo pidió— ya está arriba, paso por paso. */}
            <div className="mt-2 space-y-2 empty:mt-0">
                <EvidenciaFotos urls={dev?.evidencia_urls} titulo="Foto del producto" />
                {dev?.error_msg && (
                    <p className="text-caption text-danger flex items-start gap-1.5">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />{dev.error_msg}
                    </p>
                )}
            </div>
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
            {/* «Contado» y no «Físico»: es el mismo número que la pantalla de
                recepción pide como «¿cuántos contaste?» y que el carril de abajo
                llama «corrigió lo contado». Tres nombres para un dato hacen
                dudar de si son el mismo. */}
            <Cifra rotulo="Contado" valor={fisico} tono={tonoFis} />
            {delta != null && delta !== 0 && (
                <Badge variant={delta < 0 ? 'danger' : 'success'} size="sm" uppercase={false} className="mb-1">
                    {delta < 0 ? `Faltan ${-delta}` : `${delta} de más`}
                </Badge>
            )}
        </div>
    );
}
