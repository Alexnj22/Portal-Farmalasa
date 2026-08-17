import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, Clock, Loader2, PackageCheck, Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    MOTIVOS_RECHAZO, despacharTraslado, recibirTraslado, rechazarTraslado,
    fetchDisponibilidadTraslado,
} from '../../data/traslados';
import { fmtCuando, fmtFechaLarga, resumenItems, lotesPedidos, piezasDe } from './trasladoTexto';
import { desdeHace, cuantoTardo } from '../solicitudes/movimientoTexto';
import { ChipPersona, FichaPersona } from '../solicitudes/PersonasSolicitud';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';

/* Cuántos lotes entran en la TARJETA. El resto se lee en el detalle: con la
 * rejilla igualando alturas, un traslado de doce lotes estira a todas las demás
 * y empuja el botón fuera de la pantalla. Dos es lo que cabe sin que la tarjeta
 * con lotes y la que no los tiene se vean de dos familias distintas. */
const LOTES_EN_TARJETA = 2;

// Las filas de un traslado, en un solo lugar.
//
// Vivían dentro de `WidgetTransferRequests`. Al nacer la vista `/traslados`
// hacían falta en los dos sitios, y la salida fácil —copiarlas— es la que
// termina con dos filas que se parecen y se comportan distinto: la del widget
// preguntando la disponibilidad antes de despachar y la de la vista no, o al
// revés. El envase cambia (modal angosto contra vista ancha); lo que la fila
// DICE y lo que la fila HACE, no.

/** El recorrido, siempre en el mismo sentido: de dónde sale → a dónde va. */
export function Recorrido({ meta, className = '' }) {
    return (
        <span className={`truncate ${className}`}>
            {meta?.origen_branch_name ?? 'La otra sala'} → {meta?.branch_name ?? 'destino'}
        </span>
    );
}

/* ─── La decisión: confirmar y enviar, o no poder ─────────────────────────────
 *
 * Aparte de la fila desde el 2026-08-15, cuando la decisión del traslado se
 * mudó a Solicitudes —que es donde se contestan las otras cuatro familias— y
 * dejó de tener un solo hogar. Lo que se comparte es esto y no la fila entera:
 * el modal ya dibuja arriba qué se pide, quién lo pide y de dónde a dónde va,
 * así que meterle la fila completa habría repetido esos tres datos dentro de su
 * propio detalle.
 *
 * Lo que este bloque sabe y no se puede perder al copiarlo —por eso no se
 * copia—: que la existencia se relee AL ABRIR y no al apretar, que sin
 * existencia la única salida es rechazar con el motivo ya elegido, que la
 * sugerencia se arma con el dato fresco y viaja en el aviso, y que «Otro» sin
 * texto no es un motivo.
 */
export function DecisionTraslado({ fila, onHecho }) {
    const [modo,     setModo]     = useState(null);   // null | 'rechazo'
    const [motivo,   setMotivo]   = useState(MOTIVOS_RECHAZO[0]);
    const [texto,    setTexto]    = useState('');
    const [ocupado,  setOcupado]  = useState(false);
    const [error,    setError]    = useState('');
    const [disp,     setDisp]     = useState(null);   // null = todavía no se sabe

    // Se pregunta al abrir y no al apretar: entre que alguien pide y alguien
    // contesta, la sala pudo vender lo último que le quedaba —o habérselo
    // enviado a otra sala que pidió antes—. Sin esto, quien confirma se entera
    // recién cuando el sistema le rebota el despacho.
    useEffect(() => {
        let cancelado = false;
        fetchDisponibilidadTraslado(fila.id).then(r => {
            if (cancelado || r.error) return;
            setDisp(r.disponibilidad);
            // Si ya no tiene, la única salida honesta es rechazar — y con el
            // motivo que corresponde ya elegido, para no hacer buscar lo que el
            // portal ya sabe. Se decide acá, donde llega la respuesta, y no en
            // un efecto que vigile `disp`: es la misma decisión y un solo sitio.
            if (r.disponibilidad && !r.disponibilidad?.origen?.puede) {
                setModo('rechazo');
                setMotivo('Sin existencia en físico');
            }
        });
        return () => { cancelado = true; };
    }, [fila.id]);

    const puede = disp === null ? true : Boolean(disp?.origen?.puede);
    const alternativas = disp?.alternativas ?? [];
    // El texto que viaja en el aviso de rechazo. Se arma acá y no en la base
    // porque acá está el dato fresco que se acaba de mirar.
    const sugerencia = alternativas.length > 0
        ? `Sí hay en ${alternativas.slice(0, 3).map(a => `${a.sala} (${a.unidades})`).join(', ')}`
        : '';

    const confirmar = async () => {
        setError(''); setOcupado(true);
        const r = await despacharTraslado(fila.id);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo despachar.'); return; }
        // Con el desenlace: quien lo abrió desde un aviso necesita saber en qué
        // terminó para apagar el botón con el rótulo correcto. Las listas que ya
        // lo usaban recargan entero y lo ignoran.
        onHecho('APPROVED');
    };

    const rechazar = async () => {
        setError(''); setOcupado(true);
        const { error: e } = await rechazarTraslado(fila.id, motivo, texto, sugerencia);
        setOcupado(false);
        if (e) { setError(e.message ?? 'No se pudo rechazar.'); return; }
        onHecho('REJECTED');
    };

    // «Otro» sin texto no explica nada: es el motivo vacío con otro nombre, y la
    // base lo rechaza igual. Se avisa acá para no gastar el viaje.
    const puedeRechazar = motivo !== 'Otro' || texto.trim().length > 0;

    return (
        <div className="flex flex-col gap-2">
            {/* Por qué te aparece un traslado de una sala que no es la tuya.
                Sin esta línea, quien lo ve tiene que adivinar si es un error.

                Lo dice el SERVIDOR —`respaldo` sale de la misma función que
                autoriza el despacho—, no una cuenta del navegador: así el
                aviso no puede prometer algo que después el despacho rebote. Y
                sólo viene cuando de verdad estás cubriendo a esa sala en este
                momento; en el caso normal la clave no existe y acá no se pinta
                nada. */}
            {disp?.respaldo && (
                <p className="text-micro font-semibold text-brand-text leading-snug">
                    {disp.respaldo.sala} está cerrada: lo despachas tú por ellos, y mañana
                    les llega el aviso de lo que salió.
                </p>
            )}

            {/* Lo que la sala tiene AHORA, no cuando se lo pidieron — y ya con
                lo que salió y todavía no aparece en el conteo descontado. */}
            {disp && !puede && (
                <p className="text-micro font-semibold text-danger-text leading-snug">
                    Ya no puedes enviarlo: quedan {disp.origen?.unidades ?? 0}
                    {(disp.origen?.en_vuelo ?? 0) > 0
                        && ` (${disp.origen.en_vuelo} ya salieron y el conteo todavía no lo refleja)`}.
                    {alternativas.length > 0 && ` ${sugerencia}.`}
                </p>
            )}

            {/* El mínimo INFORMA, no impide: que la sala quede en cero es
                decisión de quien despacha. Decisión del usuario, 2026-08-06. */}
            {disp && puede && (disp.origen?.minimo ?? 0) > 0
              && (disp.origen.unidades - disp.pedido) < disp.origen.minimo && (
                <p className="text-micro font-semibold text-warning-text leading-snug">
                    Si lo envías, tu sala queda en {disp.origen.unidades - disp.pedido} y
                    tu mínimo es {disp.origen.minimo}.
                </p>
            )}

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            {modo !== 'rechazo' ? (
                <div className="flex gap-2">
                    <Button size="sm" disabled={ocupado} onClick={confirmar}>
                        {ocupado && <Loader2 size={13} className="animate-spin" />}
                        {ocupado ? 'Enviando...' : 'Confirmar y enviar'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo('rechazo')}>
                        No puedo
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <LiquidSelect
                        value={motivo}
                        onChange={v => setMotivo(v ?? MOTIVOS_RECHAZO[0])}
                        options={MOTIVOS_RECHAZO.map(m => ({ value: m, label: m }))}
                        placeholder="Motivo..."
                        clearable={false}
                    />
                    {/* La sugerencia se muestra acá y además viaja en el aviso:
                        quien pidió no tiene por qué volver a buscar dónde hay. */}
                    {alternativas.length > 0 && (
                        <p className="text-micro text-content-3 leading-snug px-1">
                            Se le va a sugerir: {sugerencia}
                        </p>
                    )}
                    <PortalTextarea
                        value={texto}
                        onChange={e => setTexto(e.target.value)}
                        rows={2}
                        placeholder={motivo === 'Otro' ? 'Escribe el motivo' : 'Algo más que agregar (opcional)'}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={ocupado || !puedeRechazar} onClick={rechazar}>
                            {ocupado && <Loader2 size={13} className="animate-spin" />}
                            Rechazar
                        </Button>
                        {/* Sin «Volver» cuando ya no tiene: no hay a dónde
                            volver — confirmar sería prometer lo que no está. */}
                        {puede && (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo(null)}>
                                Volver
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Una solicitud, con sus dos respuestas ───────────────────────────────────
 *
 * La tarjeta del widget del tablero: qué se pide, quién lo pide, y debajo la
 * decisión. En Solicitudes esos tres primeros datos ya los pinta el detalle, así
 * que allá se usa `DecisionTraslado` a secas.
 */
export function FilaPorConfirmar({ fila, nombrePor, onHecho }) {
    const meta = fila.metadata ?? {};
    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <ArrowLeftRight size={13} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content leading-tight">
                        {resumenItems(meta)}
                    </p>
                    {/* Los lotes que pidieron, cuando el pedido los trae. Van
                        ACÁ —bajo lo que se pide y antes de quién lo pide—
                        porque son parte de qué se pide, no del contexto. */}
                    {lotesPedidos(meta).length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                            {lotesPedidos(meta).map((l, i) => (
                                <p key={i} className="text-micro text-content-2 font-semibold">
                                    <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                    {l.vence && <span className="text-content-3"> · {fmtFechaLarga(l.vence)}</span>}
                                    {' — '}{l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            ))}
                        </div>
                    )}
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {nombrePor(fila.employee_id)} · {meta.branch_name ?? 'otra sala'} · {fmtCuando(fila.created_at)}
                    </p>
                    {fila.note && (
                        <p className="text-micro text-content-2 mt-1 leading-snug">{fila.note}</p>
                    )}
                </div>
            </div>
            <DecisionTraslado fila={fila} onHecho={onHecho} />
        </div>
    );
}

/* ─── Lo que pedí y ya salió ──────────────────────────────────────────────────
 *
 * Rehecha el 2026-08-17 sobre la geometría de `RequestCard` —`px-4 py-3.5`,
 * `gap-2.5`, y el pie separado por su propia línea—, que es la tarjeta canónica
 * del portal para «un asunto y qué hacer con él». Antes era una versión más
 * chica y escrita aparte, y se notaba: la misma cosa contada con otro ritmo.
 *
 * Cuatro cosas que estaban mal y por qué importan:
 *
 *  1. **El botón ocupaba el ancho entero.** No estaba pedido: el contenedor es
 *     `flex-col`, que estira a sus hijos, así que en un monitor el botón medía
 *     1.700 px para una acción de una sala. Hoy va en el pie y sólo se estira en
 *     el teléfono, donde eso SÍ es el canon (§32).
 *  2. **El nombre del producto iba detrás de la cuenta.** «6 UNIDAD · CREMA…»
 *     empieza por el dato que se repite en todas las filas; lo que distingue una
 *     de otra es el nombre, y quedaba desplazado. Se invirtió: el nombre es el
 *     ancla y la cuenta es una insignia.
 *  3. **El recorrido estaba en tinta terciaria, del tamaño más chico y pegado a
 *     la hora.** Es el dato que dice si el traslado es tuyo — con alcance de
 *     todas las salas la lista mezcla siete.
 *  4. **No se veía cuánto llevaba en camino**, sólo la hora de salida. Un
 *     traslado parado tres días se leía igual que uno de hace diez minutos, y
 *     esta lista existe justamente porque había 20 parados, el más viejo de más
 *     de una semana.
 *
 * Y muestra los lotes, que sólo salían del lado de quien despacha. Quien recibe
 * es quien tiene la caja en la mano: es el único que puede comprobar que el lote
 * que llegó es el que se pidió.
 *
 * @param ahora      El reloj de `useNowTick`, para «hace 20 min». Opcional: sin
 *                   él la tarjeta muestra la hora de salida y nada más, en vez
 *                   de un número congelado en el último render.
 * @param personaPor Resuelve un id de empleado a su FILA —con foto y cargo—,
 *                   cayendo al mapa de personas escondidas. Opcional: sin él la
 *                   tarjeta no inventa el circuito, simplemente no lo dibuja.
 */
export function FilaPorRecibir({ fila, onHecho, ahora = null, personaPor = null }) {
    const [ocupado, setOcupado] = useState(false);
    const [error,   setError]   = useState('');
    const [abierto, setAbierto] = useState(false);
    const meta   = fila.metadata ?? {};
    const piezas = piezasDe(meta);
    const lotes  = lotesPedidos(meta);
    const lotesDeMas = Math.max(0, lotes.length - LOTES_EN_TARJETA);

    // Salió cuando se despachó, que es lo que `updated_at` guarda en esta etapa.
    const salio  = fila.updated_at ?? fila.created_at;
    const espera = desdeHace(salio, ahora);
    // Más de un día en camino ya no es «en camino»: es un traslado trabado. Se
    // tiñe solo para que la cola se lea sin contar horas — mismo recurso que la
    // espera larga de `RequestCard`.
    const trabado = Boolean(ahora) && (ahora - new Date(salio).getTime()) > 86400000;

    /* Las PERSONAS, no sus nombres: `ChipPersona` necesita la fila entera para
     * poner la cara. El id se comprueba acá para que una fila vieja sin
     * despachante no dibuje el rótulo «Envió» sobre un vacío. */
    const quienPidio = personaPor ? personaPor(fila.employee_id) : null;
    const quienEnvio = personaPor ? personaPor(fila.approver_id) : null;

    const recibir = async () => {
        setError(''); setOcupado(true);
        const r = await recibirTraslado(fila.id);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo recibir.'); return; }
        onHecho();
    };

    /* `h-full` + el `mt-auto` del pie: en la rejilla de la vista las tarjetas
     * miden lo mismo de alto aunque una traiga lotes y la otra no, y el botón de
     * todas queda a la misma altura. Sin esto cada una se encoge a su contenido
     * y la fila se ve rota — reportado: «las cards deben medir lo mismo de
     * alto». Suelta (en el widget del tablero) `h-full` no hace nada. */
    return (
      <>
        <div data-surface="card" className="group px-4 py-3.5 flex flex-col gap-2.5 h-full">
            {/* La cara de la tarjeta ABRE el detalle, y la acción se queda
                afuera. `data-filo="ceder"` es lo que hace que el destello del
                canto corra el rectángulo de la TARJETA y no el del botón: sin
                él, el filo cortaba la tarjeta justo encima del pie (§5.bis). */}
            <button type="button" data-filo="ceder" onClick={() => setAbierto(true)}
                className="text-left flex items-start gap-3 w-full"
                aria-label={`Ver el detalle de ${piezas?.nombre ?? 'este traslado'}`}>
                {/* El ícono en su disco: a 13px suelto no se leía como estado,
                    y el estado es justo lo que esta lista viene a decir. */}
                <span className={`shrink-0 mt-0.5 w-9 h-9 rounded-full flex items-center justify-center
                                  ring-1 ring-inset ${trabado ? 'bg-danger/12 ring-danger/25' : 'bg-warning/12 ring-warning/25'}`}>
                    <Truck size={16} strokeWidth={2.5}
                        className={trabado ? 'text-danger-text' : 'text-warning-text'} />
                </span>

                <div className="flex-1 min-w-0">
                    {/* El ancla: qué es. `line-clamp-2` y no `truncate` porque
                        los nombres de producto se distinguen por el final
                        —presentación y laboratorio— y cortarlos en una línea
                        deja dos filas idénticas. */}
                    <p className="text-body font-bold text-content leading-snug line-clamp-2"
                        title={piezas?.nombre ?? resumenItems(meta)}>
                        {piezas?.nombre ?? resumenItems(meta)}
                    </p>

                    {/* Cuánto, y de dónde a dónde. El destino va SIEMPRE: quien
                        tiene alcance de todas las sucursales ve traslados que no
                        son suyos, y sin él no hay cómo distinguirlos. */}
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap min-w-0">
                        {piezas && <Badge variant="neutral" size="sm">{piezas.cuenta}</Badge>}
                        {/* Sin envoltorio: `Recorrido` ya es el `span` y ya trae
                            su `truncate`; meterlo dentro de otro flex le quita
                            el ancho contra el que recortar. */}
                        <Recorrido meta={meta} className="text-label font-semibold text-content-2 min-w-0" />
                    </div>

                    {/* Los lotes que se pidieron. Quien recibe tiene la caja en
                        la mano y es el único que puede comprobarlos — pero en
                        la tarjeta van TOPADOS: un traslado de doce lotes
                        empujaba el botón fuera de la pantalla y estiraba a
                        todas las demás, porque la rejilla iguala alturas. El
                        resto se lee entero en el detalle. */}
                    {lotes.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                            {lotes.slice(0, LOTES_EN_TARJETA).map((l, i) => (
                                <p key={i} className="text-micro text-content-2 font-semibold">
                                    <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                    {l.vence && <span className="text-content-3"> · {fmtFechaLarga(l.vence)}</span>}
                                    {' — '}{l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            ))}
                            {lotesDeMas > 0 && (
                                <p className="text-micro font-bold text-brand-text">
                                    +{lotesDeMas} {lotesDeMas === 1 ? 'lote más' : 'lotes más'}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <OjoDeTarjeta className="self-start mt-1" />
            </button>

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            {/* El pie, como en `RequestCard`: a la izquierda cuándo salió y
                cuánto lleva, a la derecha qué se hace con eso. El botón sólo se
                estira en el teléfono. */}
            <div className="mt-auto flex items-center justify-between gap-2 flex-wrap pt-2.5 border-t border-divider">
                <div className="flex flex-col gap-0.5 min-w-0">
                    {/* El circuito: quién lo pidió y quién lo despachó. Faltaba
                        entero —«no sale quién solicitó, quién lo aprobó»— y es
                        lo que convierte una caja anónima en el pedido de
                        alguien a alguien. Los dos nombres llegan por
                        `nombrePor`, que cae al mapa de personas escondidas: el
                        que despacha suele tener un cargo que el maestro de
                        personal no muestra. */}
                    {(quienPidio || quienEnvio) && (
                        <span className="flex items-center gap-x-3 gap-y-1 min-w-0 flex-wrap">
                            {quienPidio && (
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-micro font-black uppercase tracking-widest text-content-3 shrink-0">Pidió</span>
                                    <ChipPersona persona={quienPidio} />
                                </span>
                            )}
                            {quienEnvio && (
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-micro font-black uppercase tracking-widest text-content-3 shrink-0">Envió</span>
                                    <ChipPersona persona={quienEnvio} />
                                </span>
                            )}
                        </span>
                    )}
                    <span className="flex items-center gap-1 min-w-0 text-micro text-content-3">
                        <Clock size={11} strokeWidth={2.5} className="shrink-0" />
                        <span className="truncate">Salió {fmtCuando(salio)}</span>
                        {espera && (
                            <span className={`shrink-0 font-bold ${trabado ? 'text-danger-text' : 'text-content-3'}`}>
                                · {espera}
                            </span>
                        )}
                    </span>
                </div>

                <Button size="sm" icon={PackageCheck} loading={ocupado} disabled={ocupado}
                    onClick={recibir} className="w-full sm:w-auto">
                    {ocupado ? 'Recibiendo…' : 'Ya llegó, recibir'}
                </Button>
            </div>
        </div>

        {abierto && (
            <ModalTraslado fila={fila} piezas={piezas} lotes={lotes} salio={salio}
                quienPidio={quienPidio} quienEnvio={quienEnvio} ahora={ahora}
                ocupado={ocupado} error={error} onRecibir={recibir}
                onCerrar={() => setAbierto(false)} />
        )}
      </>
    );
}

/* ─── El detalle de un traslado en camino ─────────────────────────────────────
 *
 * Existe porque los lotes no caben. La tarjeta los topa en dos —un traslado de
 * doce empujaba el botón fuera de la pantalla, y como la rejilla iguala
 * alturas, estiraba también a todas las demás—; acá van todos, con su
 * vencimiento y sus unidades, que es lo que hay que cotejar contra la caja que
 * uno tiene en la mano.
 *
 * Y de paso contesta lo que la tarjeta sólo insinúa: las horas exactas de las
 * dos puntas del circuito, con `FichaPersona`, que es el mismo bloque con que
 * Solicitudes muestra quién pidió y quién resolvió.
 *
 * Recibir se puede desde acá también. No es una segunda forma de hacerlo: es el
 * MISMO `recibir` de la tarjeta, pasado por prop — copiarlo habría creado dos
 * caminos que se separan en cuanto alguien toque uno.
 */
function ModalTraslado({ fila, piezas, lotes, salio, quienPidio, quienEnvio, ahora,
                         ocupado, error, onRecibir, onCerrar }) {
    const meta = fila.metadata ?? {};
    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-lg"
            zClass="z-toast" closeOnEsc={!ocupado} surface={null}
            ariaLabel={`Traslado de ${piezas?.nombre ?? 'un producto'}`}>
            <CuerpoDialogo
                titulo={piezas?.nombre ?? resumenItems(meta)}
                subtitulo={[piezas?.cuenta, `Salió ${fmtCuando(salio)}`].filter(Boolean).join(' · ')}
                icono={Truck}
                tono="warning"
                anchoEscritorio="max-w-lg"
                pie={<>
                    <Button icon={PackageCheck} loading={ocupado} disabled={ocupado} onClick={onRecibir}>
                        {ocupado ? 'Recibiendo…' : 'Ya llegó, recibir'}
                    </Button>
                    <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                </>}>
                <div className="flex flex-col gap-3 text-left">
                    <div className="flex items-center justify-center gap-2 text-body-sm font-bold text-content-2">
                        <Recorrido meta={meta} />
                    </div>

                    {/* Los lotes, TODOS y en su propia superficie: es la lista
                        que se coteja renglón por renglón contra lo que llegó. */}
                    {lotes.length > 0 && (
                        <div data-surface="card" className="px-3 py-2.5">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-1.5">
                                {lotes.length === 1 ? 'El lote que se pidió' : `Los ${lotes.length} lotes que se pidieron`}
                            </p>
                            <div className="flex flex-col gap-1">
                                {lotes.map((l, i) => (
                                    <p key={i} className="flex items-baseline justify-between gap-2 text-label text-content-2 font-semibold">
                                        <span className="min-w-0 truncate">
                                            <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                            {l.vence && <span className="text-content-3"> · vence {fmtFechaLarga(l.vence)}</span>}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            {l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                        </span>
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {fila.note && (
                        <p className="text-label text-content-2 leading-snug">{fila.note}</p>
                    )}

                    {/* Las dos puntas, con hora. En la tarjeta sólo caben los
                        nombres; acá se ve cuándo pidió y cuándo salió, que es
                        lo que contesta «¿por qué tarda?». */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <FichaPersona rotulo="Pidió" persona={quienPidio} vacio="Sin registro"
                            cuando={fila.created_at} apunte={desdeHace(fila.created_at, ahora)} />
                        <FichaPersona rotulo="Envió" persona={quienEnvio} vacio="Sin registro"
                            cuando={salio} apunte={cuantoTardo(fila.created_at, salio)} tono="warning" />
                    </div>

                    {error && <p className="text-label text-danger-text font-medium">{error}</p>}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}

// La fila de historial vivía acá y se retiró el 2026-08-07: el historial es una
// lista de REGISTROS y va en `DataTable` (§32), que da la tabla en escritorio,
// las fichas en el teléfono y el vacío, los tres de una. Reportado sobre la
// primera versión de la vista: «no es canónico, dónde están las cards».
// Lo que queda acá son las dos filas de ACCIÓN, que sí son tarjetas porque
// llevan un formulario adentro.
