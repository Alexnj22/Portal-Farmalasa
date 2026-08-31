import React, { useState, useEffect, memo } from 'react';
import {
    ArrowLeftRight, Stethoscope, FileImage, AlertTriangle, CalendarDays,
    Banknote, FileCheck2, Ban, CreditCard, Receipt, CheckCircle2,
    PackagePlus, Trash2, Minus, Plus, BarChart2, Clock,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Checkbox from '../../components/common/Checkbox';
// Las fotos guardadas viven en `components/common/EvidenciaFotos`: el envío por
// avería necesita las mismas, y una segunda copia se habría separado de ésta.
import EvidenciaFotos from '../../components/common/EvidenciaFotos';
import { formatMoney } from '../../utils/formatNumber';
import { getSignedFileUrl } from '../../utils/storageFiles';
import {
    lineasDe, rechazadasDe, ajustadasDe, contextoMovimiento, fmtFechaHora,
    motivoDeRechazo, cuantoTardo,
} from './movimientoTexto';
import { CaraPersona, ChipPersona, BloquePersonas } from './PersonasSolicitud';
import LaVenta from './VentaDeSolicitud';
import { shortEmployeeName } from '../../utils/nameUtils';
import { ajusteSinCambio, fmtUltimaVenta } from '../../utils/minmaxSolicitud';

// El detalle de una solicitud, en UN solo lugar.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// Estaba escrito dos veces y las dos copias ya se habían separado: `RequestsView`
// (quien aprueba) tenía bloque para 10 tipos y `EmployeeRequestsView` (quien
// pide) sólo para 2. Y a NINGUNA de las dos le habían agregado los tres tipos
// que mueven producto — carga, descarte y traslado—, así que la solicitud
// llegaba con el producto, la cantidad, la existencia, el lote, el motivo con
// nombre y hasta las fotos guardadas, y lo único que se pintaba era el texto
// libre. Quien aprobaba un descarte veía «inyectorio» y decidía a ciegas sobre
// existencias que no se devuelven con un clic.
//
// Con un solo archivo, agregar un tipo nuevo lo agrega en los dos lados. Que es
// justo lo que no pasó las últimas tres veces.

// `DE_LEGAJO_AJENO` vivía acá: la lista de solicitudes que no hablan del
// expediente de quien las manda —una factura, una existencia— y a las que por
// eso no se les mostraba el código de empleado. Se fue con esa línea el
// 2026-08-17, cuando el código dejó de poder leerse desde el navegador; sin el
// único `if` que la consultaba era una lista que no decidía nada.

const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
// `fmtDateFull` vivía acá y lo usaba el recuadro de la factura que reemplazó
// `LaVenta`, que trae su propio formato con hora.

// El ID con el que se ubica la venta. Sale de la solicitud (`erp_invoice_id`) o
// de lo que quedó registrado al aplicarla. NUNCA cae al id interno del portal:
// son dos numeraciones distintas y mostrarlas bajo la misma etiqueta manda a
// buscar la venta equivocada.
const idDeVenta = (meta) => meta?.erp_invoice_id ?? meta?.erp_aplicado?.erp_invoice_id ?? null;

const IdVenta = ({ meta }) => {
    const id = idDeVenta(meta);
    if (!id) return null;
    return <p className="text-caption text-content-3 font-mono mt-0.5">ID de venta {id}</p>;
};

/* ─── La cara de una persona ──────────────────────────────────────────────── */
/**
 * Foto y nombre. **El código no se muestra** — decisión del usuario, 2026-08-10:
 * «con el cambio de vendedor no quiero el código, quiero las fotos y nombre».
 * Un `#140` no le dice a nadie quién atendió; la cara sí.
 *
 * La URL guardada es `photo_url`, o sea la CRUDA de un bucket privado, así que
 * hay que firmarla — pintarla directo daba una imagen rota, que es exactamente
 * lo que hacía este bloque hasta hoy. Sin foto se cae a la inicial, nunca a un
 * hueco.
 */
const Avatar = memo(({ photo, nombre, size = 40 }) => {
    // Se guarda la foto JUNTO a su firma, no la firma sola: si el componente se
    // reusa para otra persona, una firma suelta pintaría la cara anterior hasta
    // que llegue la nueva. Comparar contra `photo` hace imposible ese cruce.
    const [firmada, setFirmada] = useState({ photo: null, url: null });

    useEffect(() => {
        if (!photo) return;
        let vivo = true;
        getSignedFileUrl(photo)
            .then(url => { if (vivo) setFirmada({ photo, url }); })
            .catch(() => {});
        return () => { vivo = false; };
    }, [photo]);

    const src = firmada.photo === photo ? firmada.url : null;
    const inicial = (nombre || '?').trim().charAt(0).toUpperCase();
    return (
        <div className="rounded-full overflow-hidden border border-border-card bg-surface-card-hover
                        flex items-center justify-center shrink-0"
            style={{ width: size, height: size }}>
            {src
                ? <img src={src} alt="" className="w-full h-full object-cover" />
                : <span className="text-content-2 font-black text-body">{inicial}</span>}
        </div>
    );
});
Avatar.displayName = 'Avatar';

/** Una persona en una tarjeta de «antes → después». */
const Persona = ({ photo, nombre, vacio = 'Sin asignar' }) => (
    <div className="flex items-center gap-2 mt-1">
        <Avatar photo={photo} nombre={nombre} size={36} />
        <p className="text-label font-black text-content-2 leading-tight min-w-0 break-words">
            {nombre || vacio}
        </p>
    </div>
);

/* ─── Rótulo de sección ───────────────────────────────────────────────────── */
const Rotulo = ({ children }) => (
    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">{children}</p>
);

const Caja = ({ children, tono = 'card', className = '' }) => {
    const fondo = tono === 'card'
        ? 'bg-surface-card border-border-card'
        : 'bg-surface-card-hover border-divider';
    return <div className={`px-3 py-2.5 rounded-2xl border ${fondo} ${className}`}>{children}</div>;
};

/* ─── Las líneas de un movimiento ─────────────────────────────────────────── */
/**
 * Producto, cantidad, existencia, lote y vencimiento — una fila por línea.
 *
 * En modo decisión cada fila lleva su casilla: es lo que permite aprobar unas y
 * rechazar otras sin obligar a quien pidió a mandar todo de nuevo.
 *
 * `existencia` es la que HABÍA cuando se pidió, no la de ahora, y por eso se
 * rotula «había». Decir «quedan» sería prometer un número que el sistema no
 * volvió a mirar.
 */
/* El SIGNO del renglón, que no es lo mismo que el tipo de solicitud.
 *
 * Era `esCarga`, un booleano: `+` para la carga y `−` para todo lo demás. En un
 * TRASLADO ese `−` es falso —reportado por el usuario: «los montos tienen una
 * `-` antes, parece como que si es `-` el producto»—: un traslado no descuenta
 * nada, mueve. Las 24 unidades que salen de Salud 3 son las mismas 24 que
 * entran a Salud 5, y el encabezado de arriba ya dice el recorrido.
 *
 * El signo se reserva para lo que de verdad cambia el total del inventario: `+`
 * la carga, `−` el descarte. Cuando no hay signo, el número queda igual — es la
 * cantidad, no un saldo. */
const SIGNO_POR_TIPO = {
    INVENTORY_LOAD_REQUEST:     '+',
    INVENTORY_DISCARD_REQUEST:  '−',
    INVENTORY_TRANSFER_REQUEST: '',
};

export const LineasMovimiento = memo(({
    meta, seleccion, onToggle, onCantidad, cantidades, rechazadas, ajustadas, signo = '',
}) => {
    const items = lineasDe(meta);
    if (items.length === 0) {
        return (
            <Caja tono="hover">
                <p className="text-caption text-content-2 font-medium">Esta solicitud no trae detalle de productos.</p>
            </Caja>
        );
    }

    const decidiendo = typeof onToggle === 'function';

    return (
        /* SIN `overflow-hidden` (2026-08-28). No había nada que recortar —los
           renglones no tienen fondo propio, sólo un filete entre ellos— y en
           cambio recortaba lo que la tarjeta dibuja FUERA de su caja de relleno:
           el bloom del canto vivo (`::after` con tres `drop-shadow`) y el halo
           de su sombra. Lo que quedaba era una línea blanca dura al pasar el
           mouse, sin resplandor, que se lee como un borde cortado.
           Reportado con captura: «corrige las sombras, parece hidden». */
        <div data-surface="card">
            {items.map((it, i) => {
                const motivoRechazo = rechazadas?.get(i);
                const marcada  = decidiendo ? seleccion?.has(i) : !motivoRechazo;
                const pedida   = Number(it.cantidad) || 0;
                // La cantidad que se va a aplicar: la que el aprobador dejó, o
                // la pedida. Nunca puede superar a la pedida — aprobar MÁS de lo
                // que alguien pidió no es aprobar, es otra solicitud.
                const actual   = decidiendo ? (cantidades?.get(i) ?? pedida) : (ajustadas?.get(i) ?? pedida);
                const recortada = actual !== pedida;
                const unidad   = it.presentacion_tipo ?? 'u';

                return (
                    <div key={i}
                        className={`px-3 py-2.5 ${i > 0 ? 'border-t border-divider' : ''}
                                    ${motivoRechazo || (decidiendo && !marcada) ? 'opacity-55' : ''}`}>
                        <div className="flex items-start gap-2.5">
                            {decidiendo && (
                                <div className="pt-0.5 shrink-0">
                                    <Checkbox size="sm" checked={Boolean(marcada)}
                                        onChange={() => onToggle(i)} name={`linea-${i}`} />
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                <p className={`text-label font-bold text-content-2 leading-tight
                                               ${motivoRechazo ? 'line-through' : ''}`}>
                                    {it.descripcion ?? `Producto #${it.erp_product_id}`}
                                </p>
                                <p className="text-micro text-content-3 mt-0.5">
                                    {!decidiendo && `${actual} ${unidad}`}
                                    {!decidiendo && Number.isFinite(Number(it.existencia)) && ' · '}
                                    {Number.isFinite(Number(it.existencia)) && `había ${it.existencia}`}
                                </p>
                                {(it.lote || it.numero_lote || it.vence) && (
                                    <p className="text-micro text-content-3 mt-0.5">
                                        <span className="font-mono">{it.lote || it.numero_lote || 'sin lote'}</span>
                                        {it.vence && ` · vence ${fmtDate(it.vence)}`}
                                    </p>
                                )}
                                {motivoRechazo && (
                                    <p className="text-micro font-semibold text-danger-text mt-1">
                                        No entró — {motivoRechazo}
                                    </p>
                                )}
                                {!decidiendo && recortada && !motivoRechazo && (
                                    <p className="text-micro font-semibold text-warning-text mt-1">
                                        Entraron {actual} de las {pedida} que se pidieron
                                    </p>
                                )}
                            </div>

                            {!decidiendo && (
                                <Badge variant={signo === '+' ? 'success' : 'neutral'} size="sm" uppercase={false}
                                    className="shrink-0 mt-0.5">
                                    {motivoRechazo ? '—' : `${signo}${actual}`}
                                </Badge>
                            )}
                        </div>

                        {/* Cuánto de esa línea entra. Pedido del usuario: no
                            alcanzaba con quitar renglones enteros —«quitar unos,
                            o modificar unos»—, porque lo normal es que de las 4
                            que se pidieron entren 2. El tope es lo pedido. */}
                        {decidiendo && marcada && typeof onCantidad === 'function' && (
                            <div className="flex items-center gap-2 mt-2 ml-7">
                                <button type="button" aria-label="Quitar uno"
                                    disabled={actual <= 1}
                                    onClick={() => onCantidad(i, actual - 1)}
                                    className="w-11 h-11 rounded-xl border border-border-card bg-surface-card
                                               flex items-center justify-center text-content-2
                                               disabled:opacity-40 active:scale-[0.97]
                                               transition-transform duration-[var(--dur-fast)]">
                                    <Minus size={15} strokeWidth={2.5} />
                                </button>
                                <div className="min-w-[92px] text-center">
                                    <p className="text-body font-black text-content leading-none">{actual}</p>
                                    <p className="text-micro text-content-3 mt-0.5">{unidad}</p>
                                </div>
                                <button type="button" aria-label="Agregar uno"
                                    disabled={actual >= pedida}
                                    onClick={() => onCantidad(i, actual + 1)}
                                    className="w-11 h-11 rounded-xl border border-border-card bg-surface-card
                                               flex items-center justify-center text-content-2
                                               disabled:opacity-40 active:scale-[0.97]
                                               transition-transform duration-[var(--dur-fast)]">
                                    <Plus size={15} strokeWidth={2.5} />
                                </button>
                                {recortada && (
                                    <span className="text-micro text-warning-text font-semibold">
                                        pidió {pedida}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});
LineasMovimiento.displayName = 'LineasMovimiento';

/* ─── Encabezado de un movimiento: por qué y dónde ────────────────────────── */
const CabeceraMovimiento = ({ req, meta, unidadesAplicadas = null }) => {
    const { motivo, sala, origen, unidades } = contextoMovimiento(meta);
    const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
    const esCarga    = req.type === 'INVENTORY_LOAD_REQUEST';
    const Icono      = esTraslado ? ArrowLeftRight : esCarga ? PackagePlus : Trash2;

    // El total de arriba tiene que seguir a lo que se está decidiendo. Si dice
    // «9 unidades» mientras abajo se dejaron 5, el número más grande de la
    // pantalla es el único que miente.
    const vivo    = unidadesAplicadas ?? unidades;
    const cambió  = unidadesAplicadas !== null && unidadesAplicadas !== unidades;

    return (
        <Caja tono="hover">
            <div className="flex items-start gap-2">
                <Icono size={14} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                    <Rotulo>{esTraslado ? 'Recorrido' : esCarga ? 'Se carga en' : 'Se descarga de'}</Rotulo>
                    <p className="text-body-sm font-bold text-content-2">
                        {esTraslado ? `${origen ?? 'Otra sala'} → ${sala ?? 'destino'}` : (sala ?? 'Sin sala')}
                    </p>
                    {motivo && <p className="text-caption text-content-2 mt-0.5">{motivo}</p>}
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-body font-black ${cambió ? 'text-warning-text' : 'text-content-2'}`}>{vivo}</p>
                    <p className="text-micro text-content-3">
                        {cambió ? `de ${unidades}` : (vivo === 1 ? 'unidad' : 'unidades')}
                    </p>
                </div>
            </div>
        </Caja>
    );
};

/* ─── Quién firmó un acto guardado en `metadata` ──────────────────────────── */
/**
 * Cara y nombre. **Nunca el nombre solo.**
 *
 * Regla del usuario, dicha mirando este mismo modal: *«no veo aplicada la regla
 * de siempre poner foto a la par del nombre»*. Las dos fichas de arriba la
 * cumplían; los bloques del despacho y la recepción escribían el `by_name`
 * guardado como texto plano, porque es lo único que se lee de un vistazo en el
 * `metadata`. Es la misma regla que trajo `BloquePersonas` al detalle: un nombre
 * sin cara obliga a leer, y una cara se reconoce.
 *
 * **La foto sale del `by`, que es un id, NO del `by_name`.** Cruzar por texto
 * acá sería el error de [[un rótulo no es una clave]] con la excusa de que
 * «total, es sólo una foto»: dos personas con nombres parecidos pondrían la cara
 * de la otra, y eso no es un adorno mal puesto — es afirmar que la firma es de
 * alguien que no la hizo. Verificado en producción el 2026-08-31: los **40** ids
 * distintos que aparecen en `by` (despacho, recepción y aplicado) están los 40
 * en `employees`, así que no hay nada que ganar cruzando por nombre.
 *
 * Si el id no resuelve —una ficha borrada, un Map a medio hidratar— cae al
 * `by_name` como texto antes que a un hueco: perder la foto es un problema,
 * perder el nombre es perder la firma.
 */
const Firmante = ({ acto, employeesById }) => {
    const persona = acto?.by ? employeesById?.get(String(acto.by)) : null;
    if (persona) return <ChipPersona persona={persona} />;
    if (acto?.by_name) return <span className="text-caption font-bold text-content-2">{acto.by_name}</span>;
    return null;
};

/* ─── Constancia de lo que se aplicó ──────────────────────────────────────── */
//
// Sin esto, aprobar y que el cambio ocurra fuera del portal se ve igual que
// aprobar y que no ocurra nada.
//
// Tenía UNA sola forma —la de facturación, con `campo`/`de`/`a`— y a un
// movimiento de inventario lo pintaba como «— → —», porque su constancia no
// tiene esos campos sino líneas, unidades y costo. Ahora cada familia se lee
// con la suya.
const BloqueAplicado = ({ req, aplicado, employeesById }) => {
    if (!aplicado) return null;
    const esMovimiento = req.type?.startsWith('INVENTORY_');

    /* En un traslado, «Aplicado» decía la mitad de la verdad. El acto que este
       bloque describe es el DESPACHO —la sala que tiene el producto lo saca y lo
       manda—, y abajo hay un segundo bloque para el acto de recibirlo. Con las
       dos cajas rotuladas igual, la primera parecía el resumen de todo y quien
       la firmaba parecía el único que había tocado la bolsa. */
    const origen = (typeof req.metadata === 'object' && req.metadata)
        ? req.metadata.origen_branch_name : null;
    const rotulo = req.type === 'INVENTORY_TRANSFER_REQUEST'
        ? (origen ? `Despachado desde ${origen}` : 'Despachado')
        : 'Aplicado';

    return (
        <Caja tono="hover" className="space-y-1">
            <Rotulo>{rotulo}</Rotulo>
            {/* `flex-wrap` y no una sola línea de texto: la cara es un elemento,
                no una palabra, así que el renglón tiene que poder cortarse antes
                de ella en una pantalla angosta en vez de empujarla afuera. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <p className="text-label font-bold text-content">
                    {esMovimiento ? (
                        <>
                            {aplicado.lineas ?? 0} {aplicado.lineas === 1 ? 'producto' : 'productos'}
                            {' · '}{aplicado.unidades ?? 0} {aplicado.unidades === 1 ? 'unidad' : 'unidades'}
                            {Number.isFinite(Number(aplicado.total)) && ` · ${formatMoney(aplicado.total)}`}
                        </>
                    ) : (
                        aplicado.campo === 'anulacion'
                            ? (aplicado.solventado_internamente
                                ? 'Factura anulada en el sistema'
                                : 'Factura anulada')
                            : `${aplicado.de || '—'} → ${aplicado.a || '—'}`
                    )}
                    {(aplicado.by || aplicado.by_name) && ' · por'}
                </p>
                <Firmante acto={aplicado} employeesById={employeesById} />
            </div>
            {/* Lo que hay que hacer AHORA, y por eso no va con los avisos: un
                aviso se puede leer y seguir de largo. Acá, si nadie vuelve a
                facturar, la venta queda sin ningún documento que la respalde —
                que es peor que el error que se vino a corregir. */}
            {aplicado.instruccion && (
                <div className="px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30">
                    <p className="text-micro font-black uppercase tracking-widest text-warning mb-1">Falta hacer</p>
                    <p className="text-body-sm text-warning-text font-bold leading-relaxed">{aplicado.instruccion}</p>
                </div>
            )}
            {aplicado.hacienda?.sello && (
                <p className="text-micro text-content-3 font-mono break-all">
                    Sello de Hacienda: {aplicado.hacienda.sello}
                </p>
            )}
            {aplicado.concepto_recortado && (
                <p className="text-micro text-content-3">El detalle se guardó abreviado.</p>
            )}
            {/* Lo que se apartó de lo pedido sin llegar a frenarlo — casi
                siempre, que el lote que salió no es el que se había apartado.
                No frena nada, y por eso mismo hay que poder leerlo: si no se
                muestra acá, no se muestra en ninguna parte. */}
            {Array.isArray(aplicado.avisos) && aplicado.avisos.length > 0 && (
                <ul className="text-micro text-warning-text font-medium leading-snug space-y-0.5">
                    {aplicado.avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
            )}
        </Caja>
    );
};

/* ─── Y quién lo recibió del otro lado ────────────────────────────────────── */
/**
 * Un traslado tiene TRES actos y la pantalla mostraba dos: quien lo pidió, quien
 * lo despachó… y quien abrió la bolsa en la sala de destino.
 *
 * El tercero estaba guardado desde el día uno —`metadata.erp_recibido`, con
 * nombre, hora y lo que entró— y no lo pintaba NINGUNA pantalla del portal. El
 * único sitio donde asomaba era volver a escanear el código de la bolsa, que
 * contesta «esa bolsa ya se recibió, la recibió X»: o sea que para saber quién
 * había aceptado un traslado en su sala había que ir a preguntar por WhatsApp.
 * Medido en producción el 2026-08-31: **622 de los 666 traslados tenían ese dato
 * escrito y ninguno lo mostraba.** Es el mismo defecto que el motivo del rechazo
 * que vivía en `metadata.rejection_reason` — el dato estaba, la pantalla no.
 *
 * **`by_name` en `null` no es un hueco**: es el barrido nocturno cerrando una
 * solicitud que el sistema ya tenía recibida por su cuenta
 * (`cerrar_traslado_ya_recibido` escribe `via: 'sistema'` y deja la firma vacía
 * A PROPÓSITO). Ahí no se pone un nombre cualquiera —sería justo lo contrario de
 * lo que este bloque viene a arreglar—: se dice que lo cerró el portal solo, y
 * se muestra el aviso que explica que la hora es la del barrido y no la de la
 * entrada.
 */
const BloqueRecibido = ({ req, recibido, despachado, employeesById }) => {
    if (!recibido) return null;
    const meta = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const destino = meta.branch_name;
    const cerroElPortal = !recibido.by_name;
    const tardanza = cuantoTardo(despachado?.at, recibido.at);

    /* Medido en producción: 2 de las 622 recepciones no traen estos números —
       las que cerró el barrido, que no carga nada y por eso no tiene qué contar.
       Hoy llegan con la clave AUSENTE, y `Number(undefined)` es NaN, o sea que
       un chequeo perezoso alcanzaría… hasta el día que llegue un `null`
       explícito, porque `Number(null)` es **0** y la caja diría «0 productos · 0
       unidades». Eso no es un hueco: es una afirmación, y falsa. El `== null`
       cubre las dos formas del mismo «no hay dato», y lo ancla una prueba. */
    const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const lineas   = numero(recibido.lineas);
    const unidades = numero(recibido.unidades);
    const total    = numero(recibido.total);

    return (
        <Caja tono="hover" className="space-y-1">
            <Rotulo>{destino ? `Recibido en ${destino}` : 'Recibido'}</Rotulo>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <p className="text-label font-bold text-content">
                    {lineas != null && <>{lineas} {lineas === 1 ? 'producto' : 'productos'}{' · '}</>}
                    {unidades != null && <>{unidades} {unidades === 1 ? 'unidad' : 'unidades'}{' · '}</>}
                    {total != null && <>{formatMoney(total)}{' · '}</>}
                    {/* Sin firma no va una cara vacía: lo cerró el portal, y
                        decirlo con un disco gris al lado se leería como una foto
                        que no cargó. */}
                    {cerroElPortal ? 'lo cerró el portal solo' : 'por'}
                </p>
                {!cerroElPortal && <Firmante acto={recibido} employeesById={employeesById} />}
            </div>
            {/* La hora, siempre. Es la respuesta a «¿cuándo llegó?», y el tiempo
                que pasó desde el despacho es lo que dice si la bolsa estuvo un
                día dando vueltas — que es exactamente lo que nadie podía ver. */}
            <p className="text-micro text-content-3 tabular-nums">
                {fmtFechaHora(recibido.at)}{tardanza ? ` · ${tardanza} desde el despacho` : ''}
            </p>
            {/* `msg` es la respuesta del sistema al cargar el movimiento, y sólo
                se muestra cuando la carga NO la hizo el portal (`via: sistema`).
                Un «Hecho!» no le dice nada a nadie; lo del barrido sí, porque
                explica por qué la hora es la de la revisión y no la de la
                entrada. La condición es `via` y no «falta la firma»: de las dos
                filas así, una tiene nombre y la otra no, y las dos necesitan la
                explicación.

                Lo que NO se lee acá es el faltante: `erp_recibido` no lo guarda
                —la respuesta de la recepción sí trae `faltantes`, pero eso viaja
                al navegador y no a la fila, verificado en prod: 0 solicitudes
                con esa clave—. Vive en `bolsa_faltante`, con su propia pantalla.
                Pintar `recibido.faltantes` sería una línea que nunca aparece, y
                una que nunca aparece se lee como «no faltó nada». */}
            {recibido.via === 'sistema' && recibido.msg && (
                <p className="text-micro text-content-3 leading-snug">{recibido.msg}</p>
            )}
        </Caja>
    );
};

/* ─── El bloque que depende del tipo ──────────────────────────────────────── */
export const BloquePorTipo = ({ req, meta, seleccion, onToggle, onCantidad, cantidades, employeesById }) => {
    const t = req.type;

    /* Los tres que mueven producto de verdad. */
    if (t === 'INVENTORY_LOAD_REQUEST' || t === 'INVENTORY_DISCARD_REQUEST' || t === 'INVENTORY_TRANSFER_REQUEST') {
        // Las unidades que de verdad van a entrar, mientras se decide.
        const deLinea = (l, i) => cantidades?.get(i) ?? (Number(l?.cantidad) || 0);
        const aplicadas = seleccion
            ? [...seleccion].reduce((s, i) => s + deLinea(lineasDe(meta)[i], i), 0)
            : (cantidades
                ? lineasDe(meta).reduce((s, l, i) => s + deLinea(l, i), 0)
                : null);
        return (
            <div className="space-y-2">
                <CabeceraMovimiento req={req} meta={meta} unidadesAplicadas={aplicadas} />
                <LineasMovimiento meta={meta} seleccion={seleccion} onToggle={onToggle}
                    onCantidad={onCantidad} cantidades={cantidades}
                    rechazadas={rechazadasDe(meta)} ajustadas={ajustadasDe(meta)}
                    signo={SIGNO_POR_TIPO[t] ?? ''} />
                <EvidenciaFotos urls={meta.evidencia_urls} />
            </div>
        );
    }

    /* Min/Max — vive en otra tabla y se muestra acá igual que el resto. */
    if (t === 'MINMAX_CHANGE_REQUEST') {
        const baja = Number(meta.min_pedido) < Number(meta.min_actual);
        // «— · —» y «0 · 0» son el mismo número para la reposición: el pedido
        // entra por MAX > 0, y ahí el «—» vale 0. Desde el 2026-08-14 el
        // formulario y el disparador `trg_mmcr_solicitud_con_efecto` cortan las
        // propuestas así, pero las que ya estaban pendientes siguen acá y no
        // pueden decir «deja de reponerse»: hace rato que no se repone.
        //
        // El par de HOY sale de lo que la solicitud guardó al crearse, o sea el
        // retrato del momento — es lo único que este detalle tiene a mano, y
        // alcanza para no afirmar una consecuencia que no existe.
        const aprobada  = req?.status === 'APPROVED';
        const rechazada = req?.status === 'REJECTED';
        const nOnull = v => (v === null || v === undefined || v === '' ? null : Number(v));
        const sinCambio = ajusteSinCambio(
            { min: nOnull(meta.min_actual), max: nOnull(meta.max_actual) },
            nOnull(meta.min_pedido), nOnull(meta.max_pedido));
        return (
            <div className="space-y-2">
                <Caja tono="hover">
                    <div className="flex items-start gap-2">
                        <BarChart2 size={14} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2} />
                        <div className="flex-1 min-w-0">
                            <Rotulo>Producto</Rotulo>
                            <p className="text-body-sm font-bold text-content-2 leading-tight">
                                {meta.producto ?? `#${meta.erp_product_id}`}
                            </p>
                            {meta.branch_name && <p className="text-caption text-content-2 mt-0.5">{meta.branch_name}</p>}
                        </div>
                    </div>
                </Caja>
                {/* «Se pide» sólo es cierto mientras nadie contestó. Sobre una
                    solicitud ya aprobada —que es como se la mira la mayor parte
                    del tiempo, porque quedan en la bandeja— decía que se está
                    pidiendo algo que ya se aplicó. **Nuevo** vale en los tres
                    estados. Pedido del usuario, 2026-08-14.

                    Y su pareja cambia con el estado: aprobada, lo de la
                    izquierda ya no es «Hoy» —hoy la sala está en el otro par—
                    sino lo que había ANTES. Rechazada no cambió nada, así que
                    ahí «Hoy» sigue siendo verdad. */}
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>{aprobada ? 'Antes' : 'Hoy'}</Rotulo>
                        <p className="text-body-sm font-black text-content-2">
                            MIN {meta.min_actual ?? '—'} · MAX {meta.max_actual ?? '—'}
                        </p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Nuevo</Rotulo>
                        <p className={`text-body-sm font-black ${baja ? 'text-warning-text' : 'text-content-2'}`}>
                            MIN {meta.min_pedido ?? '—'} · MAX {meta.max_pedido ?? '—'}
                        </p>
                    </Caja>
                </div>
                {/* Los dos avisos hablan de una CONSECUENCIA, así que no tienen
                    nada que decir sobre una solicitud rechazada: ahí no pasó
                    nada. Y sobre una aprobada hablan en pasado — «aprobado
                    esto, el producto no vuelve a entrar» sobre algo aprobado
                    ayer anuncia como futuro lo que ya ocurrió. */}
                {sinCambio && !rechazada && (
                    <div className="px-3 py-2.5 rounded-2xl border border-warning/30 bg-warning/10">
                        <p className="text-caption text-warning-text font-semibold leading-snug">
                            {aprobada ? 'No cambió nada: ' : 'Aprobarlo no cambia nada: '}
                            {meta.branch_name || 'la sucursal'} {aprobada ? 'ya estaba' : 'ya está'}
                            {nOnull(meta.min_actual) === null ? ' sin MIN ni MAX' : ` en MIN ${meta.min_actual} · MAX ${meta.max_actual}`},
                            que es lo mismo que {aprobada ? 'se pidió' : 'se pide'}.
                        </p>
                    </div>
                )}
                {/* El 0 · 0 no es «un número más chico»: apaga la reposición.
                    Quien aprueba lo tiene que leer, no deducirlo de dos ceros. */}
                {!sinCambio && !rechazada && Number(meta.min_pedido) === 0 && Number(meta.max_pedido) === 0 && (
                    <div className="px-3 py-2.5 rounded-2xl border border-warning/30 bg-warning/10">
                        <p className="text-caption text-warning-text font-semibold leading-snug">
                            {aprobada
                                ? <>Dejó de reponerse: el producto ya no entra en los pedidos
                                    de {meta.branch_name || 'la sucursal'} hasta que alguien le fije un MIN y un MAX.</>
                                : <>Deja de reponerse: aprobado esto, el producto no vuelve a entrar en los
                                    pedidos de {meta.branch_name || 'la sucursal'} hasta que alguien le fije un MIN y un MAX.</>}
                        </p>
                    </div>
                )}
                {/* Las tres cifras que dicen si el producto está vivo. Sueltas
                    no alcanzan: 26 en seis meses puede ser 26 el mes pasado o
                    26 con la última venta en enero, y sólo la fecha lo separa.
                    Se muestra el bloque aunque falte alguna —las solicitudes
                    anteriores al 2026-08-14 no traen las dos nuevas— y lo que
                    falta va como «—», nunca como 0. */}
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Vendidas este mes</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.ventas_mes)) && meta.ventas_mes != null
                                ? Number(meta.ventas_mes).toLocaleString() : '—'}
                        </p>
                    </Caja>
                    <Caja>
                        <Rotulo>Vendidas en 6 meses</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.ventas_6m)) && meta.ventas_6m != null
                                ? Number(meta.ventas_6m).toLocaleString() : '—'}
                        </p>
                    </Caja>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>En sala</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.existencia)) && meta.existencia != null
                                ? `${Number(meta.existencia).toLocaleString()} und` : '—'}
                        </p>
                    </Caja>
                    <Caja>
                        <Rotulo>Última venta</Rotulo>
                        <p className={`text-body-sm font-black leading-tight ${meta.ultima_venta ? 'text-content-2' : 'text-content-3'}`}>
                            {meta.ultima_venta ? fmtUltimaVenta(meta.ultima_venta) : '—'}
                        </p>
                    </Caja>
                </div>
            </div>
        );
    }

    if (t === 'SHIFT_CHANGE') {
        return (
            <div className="space-y-2">
                {(meta.targetEmployeeName || meta.date) && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-chart-3/10 border border-chart-3/30">
                        <ArrowLeftRight size={12} className="text-chart-3-text flex-shrink-0" strokeWidth={2} />
                        <div className="flex flex-wrap items-center gap-2">
                            {meta.targetEmployeeName && <span className="text-body-sm font-bold text-chart-3-text">↔ {meta.targetEmployeeName}</span>}
                            {meta.date && <span className="text-label text-chart-3-text">{new Date(meta.date+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}</span>}
                        </div>
                    </div>
                )}
                {(meta.myShift || meta.targetShift) && (
                    <div className="grid grid-cols-2 gap-2">
                        <Caja>
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5 truncate" title={req.employee?.name}>{shortEmployeeName(req.employee)}</p>
                            <p className="text-label font-black text-content-2">{meta.myShift || '—'}</p>
                        </Caja>
                        <div className="bg-chart-3/10 border border-chart-3/30 rounded-2xl p-2.5">
                            <p className="text-micro font-black text-chart-3-text uppercase tracking-widest mb-0.5 truncate" title={meta.targetEmployeeName}>{shortEmployeeName(meta.targetEmployeeName)}</p>
                            <p className="text-label font-black text-content-2">{meta.targetShift || '—'}</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (t === 'DISABILITY') {
        return (
            <div className="space-y-2">
                {meta.startDate && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                        <Stethoscope size={13} className="text-danger flex-shrink-0" strokeWidth={2} />
                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-danger mb-0.5">Período</p>
                            <p className="text-body font-bold text-danger-text">
                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                {meta.days && <span className="text-danger font-medium ml-1.5">· {meta.days}d</span>}
                            </p>
                            {Number(meta.days) > 3 && <p className="text-caption text-content-2 font-black mt-0.5">Requiere boleta ISSS</p>}
                        </div>
                    </div>
                )}
                {meta.docUrl ? (
                    <a href={meta.docUrl} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-border-card text-label font-bold text-content-2 hover:text-brand-text transition-all">
                        <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                    </a>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-divider">
                        <AlertTriangle size={11} className="text-warning flex-shrink-0" strokeWidth={2} />
                        <p className="text-caption text-content-2 font-medium">Sin certificado adjunto.</p>
                    </div>
                )}
            </div>
        );
    }

    if (t === 'VACATION' && meta.startDate) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-success/10 border border-success/30">
                <CalendarDays size={13} className="text-success flex-shrink-0" strokeWidth={2} />
                <div>
                    <p className="text-caption font-black uppercase tracking-widest text-success mb-0.5">Período</p>
                    <p className="text-body-sm font-bold text-success-text">
                        {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                    </p>
                </div>
            </div>
        );
    }

    if (t === 'PERMIT' && (meta.permissionDates || []).length > 0) {
        return (
            <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                <p className="text-caption font-black uppercase tracking-widest text-success-text mb-2">Días de Permiso</p>
                <div className="flex flex-wrap gap-1.5">
                    {meta.permissionDates.map(d => (
                        <Badge key={d} variant="success" uppercase={false}>{new Date(d+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}</Badge>
                    ))}
                </div>
            </div>
        );
    }

    /* Horas Extra. El formulario pide la fecha Y cuántas horas desde la fusión
     * de «Mis Solicitudes» (v2.557.0) — pero acá no había rama, así que el dato
     * se guardaba y no se pintaba: quien aprueba abría la solicitud y sólo veía
     * el motivo. Capturar el número que define la solicitud y no mostrarlo deja
     * el defecto exactamente donde estaba. */
    if (t === 'OVERTIME' && (meta.date || meta.hours)) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <Clock size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Horas extra</Rotulo>
                    <p className="text-body font-black text-content-2">
                        {meta.hours ? `${meta.hours} h` : 'Sin especificar'}
                    </p>
                    {meta.date && (
                        <p className="text-caption text-content-2">
                            {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}
                        </p>
                    )}
                </div>
            </Caja>
        );
    }

    if (t === 'ADVANCE' && meta.amount) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <Banknote size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Monto solicitado</Rotulo>
                    <p className="text-body font-black text-content-2">${Number(meta.amount).toLocaleString('es-SV')}</p>
                </div>
            </Caja>
        );
    }

    if (t === 'CERTIFICATE' && meta.certificateType) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <FileCheck2 size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Tipo</Rotulo>
                    <p className="text-body-sm font-bold text-content-2">
                        {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                    </p>
                </div>
            </Caja>
        );
    }

    /* ── Las cuatro de facturación ─────────────────────────────────────────
     * Todas hablan de la MISMA venta, así que todas abren con ella entera
     * —cliente, quién atendió, forma de pago, sello, productos— y después
     * dicen qué se pide cambiar. Antes cada una mostraba cuatro datos sueltos
     * (correlativo, total, fecha) y con eso no se decide nada. */
    if (t === 'ANNULMENT_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                {meta.reason && (
                    <Caja>
                        <Rotulo>Motivo de anulación</Rotulo>
                        <p className="text-label font-bold text-content-2">{meta.reason}</p>
                    </Caja>
                )}
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Pago actual</Rotulo>
                        <p className="text-body-sm font-black text-content-2 capitalize">{meta.current_pago || '—'}</p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Cambiar a</Rotulo>
                        <p className="text-body-sm font-black text-content-2 capitalize">{meta.new_pago || '—'}</p>
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'VENDOR_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Atendió</Rotulo>
                        <Persona photo={meta.current_vendor_photo} nombre={meta.current_vendor_name}
                            vacio="Sin vendedor" />
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Pasa a</Rotulo>
                        <Persona photo={meta.new_vendor_photo} nombre={meta.new_vendor_name} />
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'CLIENT_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Cliente actual</Rotulo>
                        <p className="text-label font-black text-content-2 leading-tight">{meta.current_cliente || 'Sin nombre'}</p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Cambiar a</Rotulo>
                        <p className="text-label font-black text-content-2 leading-tight">{meta.new_client_name}</p>
                        {(meta.new_client_nit || meta.new_client_dui) && (
                            <p className="text-micro text-content-3 font-mono mt-0.5">{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</p>
                        )}
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    return null;
};

/* ─── El detalle completo ─────────────────────────────────────────────────── */
/**
 * Todo lo que se sabe de una solicitud: su bloque de tipo, el motivo de quien la
 * pidió, la constancia de lo aplicado, la nota de quien decidió y el historial.
 *
 * `seleccion`/`onToggle` sólo se pasan cuando se está DECIDIENDO por línea; sin
 * ellos el detalle es de lectura y las líneas se ven sin casillas.
 */
export default function DetalleSolicitud({ req, employeesById, seleccion, onToggle, onCantidad, cantidades }) {
    const meta = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';
    const motivoRechazo = motivoDeRechazo(req);

    const personaDelNivel = (ap) => (ap.approverId ? employeesById?.get(String(ap.approverId)) : null) ?? null;

    return (
        <div className="space-y-2.5 text-left">
            {/* Quién y cuándo, antes que el qué. */}
            <BloquePersonas req={req} empleadosPorId={employeesById} />

            <BloquePorTipo req={req} meta={meta} seleccion={seleccion} onToggle={onToggle}
                onCantidad={onCantidad} cantidades={cantidades} employeesById={employeesById} />

            <BloqueAplicado req={req} aplicado={meta.erp_aplicado ?? meta.erp_traslado}
                employeesById={employeesById} />

            <BloqueRecibido req={req} recibido={meta.erp_recibido} despachado={meta.erp_traslado}
                employeesById={employeesById} />

            {req.note && (
                <div>
                    <Rotulo>Motivo de quien la envió</Rotulo>
                    <p data-surface="card" className="text-body-sm text-content-2 p-3 leading-relaxed">{req.note}</p>
                </div>
            )}

            {/* El motivo del rechazo sale de `motivoDeRechazo`, que mira los DOS
                campos. Acá se leía sólo `approver_note`, y un traslado guarda su
                motivo en `metadata.rejection_reason` con el texto libre
                OPCIONAL: medido el 2026-08-18, 6 de los 11 rechazos no tenían
                `approver_note`, así que este bloque no se pintaba y el motivo
                —que estaba guardado— no se veía en ninguna pantalla. */}
            {motivoRechazo && (
                <div className="px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                    <p className="text-micro font-black uppercase tracking-widest text-danger mb-1">Motivo de rechazo</p>
                    {motivoRechazo.titular && (
                        <p className="text-body-sm text-danger-text font-bold leading-relaxed">{motivoRechazo.titular}</p>
                    )}
                    {/* El texto escrito a mano es la aclaración del motivo
                        elegido, no otro motivo: va debajo y con menos peso. */}
                    {motivoRechazo.detalle && (
                        <p className="text-body-sm text-danger-text font-medium leading-relaxed">{motivoRechazo.detalle}</p>
                    )}
                </div>
            )}

            {!isRejected && req.approver_note && (
                <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                    <p className="text-micro font-black uppercase tracking-widest text-success mb-1">Nota de quien decidió</p>
                    <p className="text-body-sm text-success-text font-medium leading-relaxed">{req.approver_note}</p>
                </div>
            )}

            {/* El historial sólo tiene algo que agregar cuando hubo MÁS de un
                nivel: con uno solo repite, palabra por palabra, la ficha de
                quien decidió que está arriba. */}
            {req.approvals?.length > 1 && (
                <div className="space-y-1.5">
                    <Rotulo>Historial</Rotulo>
                    {req.approvals.map((ap, i) => {
                        const quien = personaDelNivel(ap);
                        return (
                            <div key={i} className="flex items-start gap-2 bg-success/10 border border-success/30 rounded-2xl p-2.5">
                                {quien
                                    ? <CaraPersona persona={quien} px={28} className="mt-0.5" />
                                    : <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" strokeWidth={2.5} />}
                                <div className="min-w-0">
                                    <p className="text-label font-black text-success-text">
                                        {quien ? `${shortEmployeeName(quien)}${quien.role ? ` · ${quien.role}` : ''}` : `Nivel ${ap.level}`}
                                    </p>
                                    <p className="text-micro text-content-3 mt-0.5">{fmtFechaHora(ap.approvedAt)}</p>
                                    {ap.approverNote && <p className="text-caption text-content-2 mt-0.5 italic">&ldquo;{ap.approverNote}&rdquo;</p>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Acá se mostraba el CÓDIGO de empleado de quien pidió. Se retiró
                el 2026-08-17: desde que ese código es la contraseña del carné,
                la base no se lo deja leer a nadie salvo al servicio —
                `authenticated` no tiene SELECT sobre esa columna— así que la
                línea no podía tener dato. Peor: pedirla hacía fallar la
                consulta ENTERA de las personas de la solicitud (ver
                `COLUMNAS_PERSONA` en `requestsSlice`), o sea que el precio de
                un número que nunca se pintaba lo pagaban el nombre y la cara.
                Si algún día hace falta ubicar a alguien en su legajo, el camino
                es su ficha de personal, no esta pantalla. */}
        </div>
    );
}
