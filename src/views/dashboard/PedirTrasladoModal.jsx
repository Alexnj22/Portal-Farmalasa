import React, { useState } from 'react';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { claveOrigen, diasHasta, fmtVence } from '@nucleo/utils/pedirTraslado';
import { opcionesDePresentacion } from '@nucleo/utils/presentacion';
import { ArrowLeft, ArrowLeftRight, Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';

// Pedirle un producto a otra sala.
//
// Se abre desde la consulta de inventario, y lo normal es que `producto` venga
// puesto: la lista ya sabe qué producto, qué salas lo tienen, cuántas unidades
// y con qué lotes. Quedan tres decisiones: a cuál pedirle, cuánto, y para qué.
//
// ── SIEMPRE sale con lotes, venga como venga (2026-08-18) ─────────────────
// Lo que falte se pregunta acá: las salas con `fetchDondeHay` y los lotes con
// `fetchInventoryByProductIds`. Las dos consultas corren SÓLO cuando el dato no
// vino, nunca encima del que vino — si la pantalla mostró una lista, se elige
// sobre ESA y no sobre otra que podría no coincidir con lo que la persona miró.
//
// Antes los lotes no se preguntaban, y por eso había puertas que producían
// solicitudes a medias: la que vivió en «Nueva solicitud» entre el 15 y el 18
// de agosto (arrancaba en un buscador de catálogo) y la lista de faltantes
// —«Sin existencia, puedes solicitar en estas sucursales»—, que abre con la
// fila del RPC y ésa no trae lotes. Por ahí la solicitud salía sin decir de qué
// lote tenía que salir el producto y quien despacha lo elegía por su cuenta,
// cuando esa elección es de quien pide («los lotes MANDAN», 2026-08-07).
//
// O sea que el modal ya no depende de con cuánto lo abrieron. Es la condición
// para que las dos puertas produzcan la misma solicitud.
//
// El «para qué» es obligatorio en los dos casos: es lo único que queda escrito
// en el movimiento de las dos salas.
//
// ── Lo que NO se elige acá ────────────────────────────────────────────────
// Ni el aprobador ni la ubicación de la sala de origen. Los dos los resuelve la
// base: el primero con la cascada turno → jefatura → Supervisión, el segundo
// desde el mapa de salas. Un navegador que eligiera de dónde sale el producto o
// quién lo autoriza no sería una pantalla, sería un permiso.
//
// Desde el 2026-08-19 sí se elige el ÁREA —el estante de operación de Bodega o
// el de próximos a vencer—, y la diferencia con lo anterior es exacta: la
// pantalla nombra un estante que ya vio en la lista, y qué número tiene ese
// estante en el sistema lo sigue contestando el mapa. Elegir entre dos opciones
// que la base ofreció no es lo mismo que dictarle una ubicación.



// Un aviso del formulario: el texto y el tono salen del núcleo
// (`avisosDelPedido`), así que la web y la app dicen lo mismo.
const TONO_AVISO = { danger: 'text-danger-text', warning: 'text-warning-text', neutral: 'text-content-3' };
function AvisoPedido({ aviso }) {
    if (!aviso) return null;
    return (
        <p className={`text-micro font-semibold px-1 leading-snug ${TONO_AVISO[aviso.tono] || TONO_AVISO.neutral}`}>
            {aviso.texto}
        </p>
    );
}

export default function PedirTrasladoModal({ producto: productoInicial = null, onClose, onListo }) {
    // Todo el estado y las reglas viven en el núcleo (`hooks/usePedirTraslado`),
    // que usa también la app del teléfono: las dos arman la misma solicitud.
    // Acá queda sólo la forma de la pantalla.
    const {
        avisos,
        producto,
        donde, origenId, setOrigenId, sala,
        presIdx, setPresIdx, opcionesPres,
        cantidad, setCantidad, unidades,
        esAntibiotico, avisoVence,
        descartados, setDescartados, lotesDeSala, reparto, hayLotes,
        lineaLista, lineaActual, yaEstaEnLaLista, salasDestino,
        puedeEnviar, faltaElParaQue,
        renglones, causa, setCausa, agregar, quitarDelStore, editarRenglon, limpiarStore,
        enviar, enviando, listo, error, resumen,
    } = usePedirTraslado({ productoInicial, alCerrar: onClose, alTerminar: onListo });

    /* Abre en «Agregar» cuando viene con un producto, y en la lista cuando no:
     * abrirlo sin producto es lo que hace la consulta al apretar «terminar la
     * solicitud», y ahí lo que se viene a hacer es revisar y mandar. */
    const [pestana, setPestana] = useState(productoInicial ? 'agregar' : 'lista');
    /* Qué renglón de la lista está abierto para corregir. Uno a la vez: dos
     * abiertos serían dos formularios en una lista, que es lo que la tarjeta
     * cerrada vino a evitar. */
    const [editando, setEditando] = useState(null);

    /* ── El atajo de un solo producto ──────────────────────────────────────
     *
     * Pedido del usuario, 2026-08-20: «si solo quiero pedir un producto, en el
     * primero que me salga solicitar el producto, y agregar otro producto».
     * Es sólo cuando la lista está VACÍA. Con algo ya agregado, mandar desde
     * acá mandaría también lo de la lista sin que se vea. */
    const soloUno = pestana === 'agregar' && lineaLista && renglones.length === 0;

    /* Cambiar de pestaña con un renglón terminado a la vista lo AGREGA: ir a
     * mandar con el formulario lleno es exactamente lo que alguien hace después
     * de completar el último producto. Y «Agregar» sin un producto a la vista
     * NO es una pestaña: es volver a la consulta de inventario. */
    const irA = (destino) => {
        if (destino === 'agregar' && !producto) { onClose?.(); return; }
        if (destino === 'lista' && lineaActual && !yaEstaEnLaLista) agregar({ cerrar: false });
        setPestana(destino);
    };

    const quitar = (i) => { quitarDelStore(i); setEditando(null); };


    /* `max-w-lg` y no `max-w-md`: desde el atajo del producto suelto el pie lleva
     * TRES botones —cancelar, agregar otro y solicitar— y en 28rem se tocaban
     * entre sí. Reportado el 2026-08-20: «los botones están muy juntos abajo,
     * dale más espacio al modal». */
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Solicitar a otra sala">
            {/* Las tres ranuras del canónico. Antes era un `<div>` suelto con el
                título a mano, sin botón de cerrar y con la acción al final del
                cuerpo que scrollea. */}
            <LiquidModal.Header>
                <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                        <ArrowLeftRight size={15} className="text-brand-text" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-black text-content leading-tight">
                            {producto?.descripcion ?? 'Pedir a otra sala'}
                        </p>
                        <p className="text-label text-content-3 mt-0.5">
                            {producto ? 'Solicitar a otra sala' : 'Elige el producto'}
                        </p>
                    </div>
                    {/* Volver al buscador.
                        Antes sólo aparecía cuando el producto había salido del
                        buscador —«si llegó puesto desde la consulta de
                        inventario, atrás no es acá»—. Con el compositor sí es
                        acá: soltar el producto es cómo se elige el siguiente,
                        venga de donde venga. */}
                    {producto && !listo && pestana === 'agregar' && (
                        <Button variant="ghost" size="xs" icon={ArrowLeft} iconOnly
                            onClick={() => onClose?.()}
                            aria-label="Elegir otro producto" />
                    )}
                    <Button variant="ghost" size="xs" icon={X} iconOnly
                        onClick={onClose} aria-label="Cerrar" />
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                {/* ── Las dos mitades, como en Ajuste de Inventario ─────────
                    «Agregar» y «En la solicitud · N». Los rótulos son los
                    mismos de allá a propósito: dos compositores que hacen lo
                    mismo con dos nombres distintos obligan a aprender dos veces.

                    El contador en la pestaña es lo que dice que la lista existe
                    sin tener que ir a mirarla — y por eso la lista pudo salir de
                    encima del formulario, que es lo que hacía que agregar se
                    sintiera como volver al principio. */}
                {!listo && (
                    <div className="shrink-0">
                        <SegmentedControl
                            value={pestana}
                            onChange={irA}
                            options={[
                                { value: 'agregar', label: 'Agregar' },
                                { value: 'lista',   label: `En la solicitud${renglones.length ? ` · ${renglones.length}` : ''}` },
                            ]}
                        />
                    </div>
                )}

                {/* ── Lo que ya lleva la solicitud ──────────────────────────
                    Se agrupa por sala porque así es como va a salir: cada
                    encabezado es una solicitud, y lo que cuelga de él es lo que
                    ESA sala va a ver. Verlo antes de mandar es lo que hace que
                    «se dividen en solicitudes separadas» no sea una sorpresa.

                    Vivía encima del formulario, y ahí es donde molestaba: cada
                    producto agregado empujaba el formulario más abajo, y al
                    agregar el último la pantalla volvía a la invitación del
                    primer paso. Acá tiene su propio lugar y su contador. */}
                {!listo && pestana === 'lista' && (
                    renglones.length === 0 ? (
                        <p className="text-label text-content-3 font-medium py-8 text-center leading-snug">
                            Todavía no agregaste nada.<br />
                            <span className="text-micro">
                                Elige el producto en «Agregar», ponle la cantidad y aprieta «Agregar».
                            </span>
                        </p>
                    ) : (
                    <div className="flex flex-col gap-2">
                        {[...new Map(renglones.map(r => [r.clave, r.origen])).entries()].map(([clave, origen]) => (
                            <div key={clave} className="flex flex-col gap-1">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1">
                                    {origen.sala}{origen.vencidos ? ' · próximos a vencer' : ''}
                                </p>
                                {/* ── La tarjeta nace CERRADA, como en el ajuste ──
                                    Muestra lo que hace falta para reconocer el
                                    renglón —cuánto, de qué y en qué presentación—
                                    y dos botones: lápiz y papelera. Abierta,
                                    aparece la cantidad para corregirla.

                                    Una con problema se abre sola: cerrada
                                    mostraría el aviso de lo que le falta y ningún
                                    campo donde arreglarlo, que es un callejón sin
                                    salida. Mismo criterio que allá. */}
                                {renglones.map((r, i) => {
                                    if (r.clave !== clave) return null;
                                    const abierta = editando === i || Boolean(r.problema);
                                    return (
                                        <div key={i} data-surface="card" className="px-3 py-2.5">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-body-sm font-black text-content truncate">
                                                        {r.item.descripcion}
                                                    </p>
                                                    {!abierta && (
                                                        <p className="text-micro font-semibold text-content-2 mt-0.5 truncate">
                                                            {r.item.cantidad} × {r.item.presentacion_tipo}
                                                            {' · '}{r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                        </p>
                                                    )}
                                                </div>
                                                {/* El de editar pasa a «listo» con la
                                                    tarjeta abierta: es el mismo control,
                                                    y mandar el foco a otro botón para
                                                    cerrarla sería un salto de más.
                                                    Apagado mientras el renglón tenga un
                                                    problema — cerrarlo ahí sólo lo
                                                    escondería. */}
                                                <Button variant="ghost" size="xs" iconOnly
                                                    icon={abierta ? Check : Pencil}
                                                    aria-label={abierta ? 'Listo' : `Corregir ${r.item.descripcion}`}
                                                    disabled={abierta && Boolean(r.problema)}
                                                    onClick={() => setEditando(abierta ? null : i)} />
                                                <Button variant="ghost" size="xs" icon={Trash2} iconOnly
                                                    aria-label={`Quitar ${r.item.descripcion}`}
                                                    onClick={() => quitar(i)} />
                                            </div>

                                            {abierta && (
                                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                                    <div className="w-20">
                                                        <PortalInput
                                                            type="number" min="1"
                                                            value={String(r.item.cantidad)}
                                                            onChange={e => editarRenglon(i, { cantidad: e.target.value })}
                                                            aria-label={`Cantidad de ${r.item.descripcion}`}
                                                        />
                                                    </div>
                                                    {/* La presentación también se corrige acá. Sólo
                                                        cuando hay más de una: con una sola, un
                                                        desplegable de un elemento es un control que
                                                        no decide nada. Mismo criterio que el ajuste. */}
                                                    {(r.presentaciones ?? []).length > 1 ? (
                                                        <div className="min-w-[9rem] flex-1">
                                                            <LiquidSelect
                                                                nano clearable={false}
                                                                value={`${r.item.presentacion_tipo}|${r.item.factor}`}
                                                                onChange={v => {
                                                                    const [tipo, factor] = String(v).split('|');
                                                                    editarRenglon(i, { presentacion_tipo: tipo, factor: Number(factor) });
                                                                }}
                                                                options={opcionesDePresentacion(
                                                                    r.presentaciones, r.origen.unidades,
                                                                ).map((o, k) => ({
                                                                    // El valor viaja por SIGNIFICADO —tipo + factor— y no
                                                                    // por índice: acá el índice no significa nada fuera de
                                                                    // la lista que lo produjo.
                                                                    value: `${r.presentaciones[k].tipo}|${r.presentaciones[k].factor}`,
                                                                    label: o.label,
                                                                    disabled: o.disabled,
                                                                }))}
                                                                ariaLabel={`Presentación de ${r.item.descripcion}`}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="text-micro font-semibold text-content-2">
                                                            {r.item.presentacion_tipo}
                                                        </span>
                                                    )}
                                                    <span className="text-micro font-semibold text-content-2">
                                                        {r.unidades} {r.unidades === 1 ? 'unidad' : 'unidades'}
                                                    </span>
                                                </div>
                                            )}

                                            {r.problema && (
                                                <p className="text-micro font-semibold text-danger-text mt-1 leading-snug">
                                                    No se puede mandar así: {r.problema}.
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    )
                )}

                {/* El desenlace manda sobre las pestañas: cuando la solicitud
                    ya salió no hay nada que agregar ni que revisar. */}
                {listo ? (
                    <p className="text-label font-semibold text-success-text py-6 text-center leading-snug">
                        {resumen?.solicitudes > 1
                            ? `${resumen.solicitudes} solicitudes enviadas.`
                            : 'Solicitud enviada.'}<br />
                        <span className="text-content-3 font-medium">
                            {/* Se nombran las salas: quien pidió tiene que saber
                                a quiénes les llegó, porque cada una decide por
                                su cuenta y cada una le va a contestar aparte. */}
                            {(resumen?.salas ?? []).join(', ')} {resumen?.solicitudes > 1 ? 'deciden' : 'decide'} y
                            el producto sale de ahí.
                        </span>
                    </p>
                ) : pestana === 'lista' || !producto ? null : (

                    <>
                        <LiquidSelect
                            value={origenId}
                            onChange={v => setOrigenId(v)}
                            options={donde.map(d => ({
                                value: claveOrigen(d),
                                // La fecha va en la etiqueta —y no solo en el
                                // aviso— para verla AL elegir y no después de
                                // haber elegido mal. Solo en los que llevan
                                // receta, que hoy son los únicos donde importa.
                                label: `${d.sala} — ${d.unidades} ${d.unidades === 1 ? 'unidad' : 'unidades'}`
                                     + (esAntibiotico && d.vence ? ` · vence ${fmtVence(d.vence)}` : ''),
                            }))}
                            placeholder="A qué sala..."
                            clearable={false}
                        />

                        <div className="flex gap-2">
                            <div className="flex-1">
                                <LiquidSelect
                                    value={presIdx}
                                    onChange={v => setPresIdx(v ?? '0')}
                                    options={opcionesPres}
                                    placeholder="Presentación..."
                                    clearable={false}
                                />
                            </div>
                            <div className="w-24">
                                <PortalInput
                                    type="number"
                                    min="1"
                                    value={cantidad}
                                    onChange={e => setCantidad(e.target.value)}
                                    placeholder="Cant."
                                />
                            </div>
                        </div>

                        {/* El número que importa es el de UNIDADES: la sala tiene
                            su existencia contada así, y una cantidad en cajas
                            contra una existencia en unidades deja pasar
                            imposibles sin que nada avise.
                            La existencia ya viene con lo que salió y todavía no
                            volvió del conteo descontado. */}
                        {/* «Bajo Receta», nunca «Abx» — el canon de la casa. Se
                            dice al PEDIR y no al recibir: un regulado se mueve
                            con su lote y quien lo pide tiene que saberlo antes
                            de que la caja esté en camino. */}
                        {esAntibiotico && (
                            <p className="text-micro font-semibold text-content-2 px-1 leading-snug">
                                Bajo Receta — se traslada con su lote.
                            </p>
                        )}

                        {/* ── De qué estante sale, cuando no es el de siempre ──
                            El rótulo del desplegable ya lo dice, pero se lee al
                            elegir y después se deja de mirar. Acá abajo queda a
                            la vista mientras se decide la cantidad — que es el
                            momento en que importa.

                            Dice lo que hay que saber y no opina: en esa área
                            Bodega aparta lo próximo a vencer, así que hay lotes
                            con poca vida y también los hay ya vencidos. Cuál es
                            cuál se ve renglón por renglón en «Saldría de», con
                            su fecha, y ahí se puede descartar el que no sirva.
                            Frenar el pedido no es de esta pantalla: quien
                            confirma es Bodega, que tiene la caja delante. */}
                        {sala?.vencidos && (
                            <p className="text-micro font-semibold text-warning-text px-1 leading-snug">
                                Sale del área donde se aparta lo próximo a vencer. Revisa abajo la
                                fecha de cada lote antes de pedirlo.
                            </p>
                        )}

                        {/* El vencimiento, solo cuando importa. Un aviso que
                            aparece siempre deja de leerse. */}
                        {avisoVence && (
                            <p className={`text-micro font-semibold px-1 leading-snug ${
                                avisoVence.grave ? 'text-danger-text' : 'text-warning-text'
                            }`}>
                                {avisoVence.texto}
                            </p>
                        )}

                        {/* ── Un aviso a la vez, y el que corresponde ───────────
                            Antes era UNA frase que iba sumando cláusulas, y con
                            un pedido que no alcanzaba salía así:

                              «50 unidades · La Popular tiene 27 y quedaría en 0,
                               bajo su mínimo de 62»

                            Dos cosas mal. **«Quedaría en 0» no es cierto**: 27
                            menos 50 no da 0, da que no se puede — el `Math.max`
                            lo redondeaba a un número que se lee como un
                            resultado. Y **el mínimo ahí no viene al caso**: si
                            no alcanza, que además quede bajo el mínimo es una
                            preocupación de un escenario que no va a ocurrir.

                            Ahora son tres estados excluyentes, cada uno con su
                            color: no alcanza (rojo, frena), alcanza pero deja a
                            la sala corta (ámbar, INFORMA y no impide —decisión
                            del usuario 2026-08-06—), y alcanza sin más (gris). */}
                        <AvisoPedido aviso={avisos.existencia} />

                        {/* Ninguna presentación entra ni una vez en lo que la
                            sala tiene. El desplegable lo dice opción por opción;
                            esto lo dice una vez y cierra: acá no hay cantidad
                            que ajustar, hay que pedirle a otra sala. */}
                        <AvisoPedido aviso={avisos.ningunaAlcanza} />

                        {/* ── De qué lotes saldría ──────────────────────────
                            Sólo con cantidad puesta: antes de eso no hay nada
                            que repartir y la lista sería ruido. */}
                        {hayLotes && unidades > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest px-1">
                                    Saldría de
                                </p>
                                {lotesDeSala.map(l => {
                                    const fuera = descartados.has(l.clave);
                                    const enviado = reparto.find(r => r.clave === l.clave);
                                    const dias = diasHasta(l.vence);
                                    const corto = dias != null && dias <= 180;
                                    return (
                                        <div key={l.clave}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border-card ${fuera ? 'opacity-45' : ''}`}
                                            style={{ background: 'var(--surface-card-hover)' }}>
                                            <span className="text-micro font-mono text-content-3 truncate min-w-0 flex-1">
                                                {l.lote || 'sin lote'}
                                            </span>
                                            <span className={`text-micro font-semibold shrink-0 ${corto ? 'text-warning-text' : 'text-content-3'}`}>
                                                {l.vence ? fmtVence(l.vence) : 'sin fecha'}
                                            </span>
                                            {/* El número que se lleva de ESE lote, no lo que
                                                el lote tiene: es lo que hay que poder revisar. */}
                                            <span className="text-caption font-black text-content shrink-0 tabular-nums w-16 text-right">
                                                {fuera ? '—' : `${enviado?.toma ?? 0} uds`}
                                            </span>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => setDescartados(prev => {
                                                    const s = new Set(prev);
                                                    if (s.has(l.clave)) s.delete(l.clave); else s.add(l.clave);
                                                    return s;
                                                })}
                                            >
                                                {fuera ? 'Incluir' : 'No este'}
                                            </Button>
                                        </div>
                                    );
                                })}
                                {/* ── Faltan unidades, pero NO siempre por lo mismo ──
                                    Decía «con los lotes que dejaste faltan 23» aunque
                                    no se hubiera dejado ninguno fuera: le echaba la
                                    culpa a una decisión que la persona no tomó y la
                                    mandaba a «volver a incluir alguno» cuando no había
                                    nada que volver a incluir. Visto en la captura del
                                    2026-08-20, con el único lote incluido.

                                    Son dos causas distintas y cada una tiene su salida:
                                    o descartaste lotes —y se vuelven a incluir— o la
                                    sala no tiene tanto, y entonces lo único que se
                                    puede hacer es pedir menos.

                                    Y cuando la existencia tampoco alcanzaba, el aviso
                                    de arriba ya lo dijo: repetirlo con otras palabras
                                    hace dudar de si son dos problemas. */}
                                <AvisoPedido aviso={avisos.lotes} />
                            </div>
                        )}

                    </>
                )}

                {/* ── El «para qué»: UNA vez, y en la pestaña donde se manda ──
                    Reportado el 2026-08-20: «al agregar cada producto pide un
                    comentario, y luego en el de "en la solicitud" pide otro, son
                    un montón de comentarios los que pide».

                    Era UN solo campo —el mismo estado— pintado en las dos
                    pestañas, y por eso se leía como dos: nadie tiene por qué
                    adivinar que dos casillas iguales en dos pantallas guardan lo
                    mismo. Ahora vive donde vive el de Ajuste de Inventario: en la
                    pestaña de la lista, junto al botón de mandar. Se escribe una
                    vez aunque la composición lleve seis renglones a tres salas.

                    Nunca fue por producto: el «para qué» es de la solicitud.

                    ── Y por eso viaja al único sitio donde se puede mandar ──
                    Con un solo producto se manda desde «Agregar» sin pasar por
                    la lista (2026-08-20: «si solo quiero pedir un producto, en
                    el primero que me salga solicitar el producto»), así que el
                    campo aparece ahí. No son dos: es el mismo, y está donde está
                    el botón que lo necesita. */}
                {!listo && !soloUno && pestana === 'lista' && renglones.length > 0 && (
                    <PortalTextarea
                        value={causa}
                        onChange={e => setCausa(e.target.value)}
                        rows={2}
                        placeholder="Para qué se pide — queda escrito en el movimiento"
                    />
                )}

                {!listo && !soloUno && pestana === 'lista' && faltaElParaQue && (
                    <p className="text-micro font-semibold text-warning-text px-1 leading-snug">
                        Falta decir para qué se pide: es lo único que queda escrito en el
                        movimiento de las dos salas.
                    </p>
                )}

                {!listo && (
                    <>
                        {/* Un producto a medias no se pierde en silencio: se
                            dice cuál es y el botón no deja mandar hasta que se
                            complete o se suelte. */}
                        <AvisoPedido aviso={avisos.aMedias} />

                        {/* El mismo producto al mismo estante dos veces es una
                            sola línea con la cantidad sumada, no dos pedidos. */}
                        <AvisoPedido aviso={avisos.repetido} />

                        {/* Un renglón marcado en rojo tiene que frenar el envío
                            desde la otra pestaña también, o el botón se apaga sin
                            que nada explique por qué. */}
                        {pestana === 'agregar' && <AvisoPedido aviso={avisos.conProblema} />}

                        {/* El «para qué» del atajo de un solo producto. Ver la
                            nota de arriba: acompaña al botón que manda. */}
                        {soloUno && (
                            <PortalTextarea
                                value={causa}
                                onChange={e => setCausa(e.target.value)}
                                rows={2}
                                placeholder="Para qué se pide — queda escrito en el movimiento"
                            />
                        )}

                        <AvisoPedido aviso={avisos.paraQue} />

                        {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
                    </>
                )}
            </LiquidModal.Body>

            {/* Sin producto y sin nada agregado todavía no hay qué solicitar: el
                pie sería un botón apagado sin ninguna pista de qué lo enciende.
                La salida en ese paso es la X del encabezado. */}
            {!listo && (producto || renglones.length > 0) && (
                <LiquidModal.Footer>
                    {/* Con algo armado, cerrar y DESCARTAR son dos cosas
                        distintas: la equis del encabezado sale un momento —es
                        cómo se va a buscar el siguiente producto— y esto tira lo
                        que llevás. Con la lista vacía son lo mismo y el botón se
                        llama como siempre. */}
                    <Button
                        variant="secondary"
                        onClick={() => { if (renglones.length > 0) limpiarStore(); onClose?.(); }}
                    >
                        {renglones.length > 0 ? 'Descartar todo' : 'Cancelar'}
                    </Button>

                    {/* ── Un botón por pestaña, como en Ajuste de Inventario ───
                        En «Agregar» se agrega; en «En la solicitud» se manda.
                        Los dos a la vez era lo que hacía que el «para qué»
                        tuviera que estar en las dos pantallas, y de ahí venía la
                        sensación de que el portal pedía comentarios de más.

                        «Agregar» sólo cuando el renglón está completo: un botón
                        apagado al lado de otro apagado no dice cuál de los dos se
                        está esperando. */}
                    {pestana === 'agregar' ? (
                        lineaLista && !yaEstaEnLaLista && (
                            soloUno ? (
                                <>
                                    {/* Agregar otro es la salida al compositor:
                                        guarda éste y devuelve a la consulta. */}
                                    <Button variant="secondary" disabled={enviando} onClick={agregar}>
                                        Agregar otro
                                    </Button>
                                    <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                                        {enviando && <Loader2 size={14} className="animate-spin" />}
                                        {enviando ? 'Enviando...' : 'Solicitar'}
                                    </Button>
                                </>
                            ) : (
                                <Button disabled={enviando} onClick={agregar}>Agregar</Button>
                            )
                        )
                    ) : (
                        <Button disabled={!puedeEnviar || enviando} onClick={enviar}>
                            {enviando && <Loader2 size={14} className="animate-spin" />}
                            {enviando
                                ? 'Enviando...'
                                // Se dice cuántas van a salir ANTES de apretar: que
                                // una composición se parta en tres solicitudes es
                                // exactamente lo que no puede ser una sorpresa.
                                : salasDestino > 1 ? `Solicitar a ${salasDestino} salas` : 'Solicitar'}
                        </Button>
                    )}
                </LiquidModal.Footer>
            )}
        </LiquidModal>
    );
}
