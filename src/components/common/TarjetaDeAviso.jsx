import React, { useEffect, useRef } from 'react';
import { ArrowRight, ArrowLeftRight, Ban, Check, ChevronDown, Eye, X } from 'lucide-react';
import Button from './Button';
import AvatarConEstado from './AvatarConEstado';
import NotificacionDetalle from './NotificacionDetalle';
import { AnilloDeMeta, CuerpoDeCierreDeMeta, CuerpoDeCierreDeEmpresa, CuerpoDeCierreDelDia } from './CierreDeMeta';
import { AnilloDeFaltante, CuerpoDeFaltanteDeCaja } from './TarjetaDeFaltante';
import { AnilloDeAperturas, CuerpoDeAperturas } from './TarjetaDeAperturas';
import { datosDeCierreDeMeta, datosDeCierreDeEmpresa, datosDeCierreDelDia } from '../../utils/cierreDeMeta';
import { datosDeFaltanteDeCaja } from '../../utils/faltanteDeCaja';
import { datosDeAperturasDeLaManana } from '../../utils/aperturasDeLaManana';
import { iconoDeTipo } from '../../constants/tipoIconos';
import { shortEmployeeName } from '../../utils/nameUtils';
import {
    severidadDelTitulo, tituloSinEmoji, tintForType, etiquetaDeAccion,
    RESUELTA_LABEL, cuandoLlego,
} from '../../utils/notificacionTexto';

/* La tarjeta de UN aviso — la misma en la campana y en `/notificaciones`.
 *
 * Vivía escrita dentro del `map` de `NotificationBell` y era su único lector.
 * El 2026-09-04 nació el historial, que la escribió otra vez en versión
 * simplificada, y el usuario lo vio de una: «en la vista no se ven las
 * notificaciones modernas, como en la notificación». Lo que se había perdido no
 * era el estilo, era la MITAD de lo que la tarjeta hace:
 *
 *   · el anillo del cierre de metas y el del faltante de caja, que DIBUJAN la
 *     cifra en vez de contarla en un párrafo;
 *   · el detalle desplegable de una solicitud (`NotificacionDetalle`), con sus
 *     renglones, sus fotos y su motivo;
 *   · Aprobar / Rechazar, Confirmar / Descartar el corte, revisar el traslado.
 *
 * O sea que la copia no se «desincronizó con el tiempo»: nació incompleta, que
 * es como empiezan todas. Por eso ahora es un solo componente.
 *
 * ── Lo que NO entra acá ──────────────────────────────────────────────────────
 * La ventana de deshacer de la campana (`pendingOne`) se queda en la campana:
 * es su gesto, no el de la tarjeta. Y el control de borrado llega como `nodo`
 * (`controlDeBorrado`) porque los dos sitios lo resuelven distinto: la campana
 * lo borra con ventana de 3s, el historial lo manda a la papelera o lo devuelve.
 *
 * ── `acciones` puede ser `null` ──────────────────────────────────────────────
 * Sin ella la tarjeta se dibuja igual pero sin botones de decidir. Es lo que
 * necesita la papelera: un aviso borrado se lee, no se decide desde ahí.
 */

/* ── El cuerpo del aviso, y saber si se está cortando ──────────────────────
 *
 * La tarjeta muestra tres renglones. Un aviso del sistema puede tener seis
 * —«El barrido de Hacienda no corrió anoche» tiene 200 caracteres— y hasta que
 * esto existió no había forma de leer el resto: el control para desplegar
 * existía sólo para las solicitudes, o sea que el aviso más largo del portal
 * era el único que no se podía abrir.
 *
 * Se MIDE el párrafo en vez de contar caracteres: que un texto entre en tres
 * renglones depende del ANCHO —el mismo aviso entra en el panel de escritorio y
 * se corta en el teléfono—, así que un umbral por largo pondría el control
 * donde no hace falta, y un control que al tocarlo no despliega nada se lee
 * como que la tarjeta está rota.
 *
 * Avisa hacia arriba en vez de resolverlo acá porque el control no puede vivir
 * dentro de la tarjeta: su cara ya es un <button> y un botón adentro de otro no
 * es HTML válido. Va abajo, junto a «Ver detalle». */
export const CuerpoDeAviso = ({ id, texto, recortar, clase, onRecorte }) => {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        // Desplegado no se puede medir: sin el recorte, el alto del contenido y
        // el de la caja coinciden y la medición diría «entra». Se conserva la
        // última medición, que es la que decidió mostrar el control.
        if (!el || !recortar) return undefined;
        const medir = () => onRecorte(id, el.scrollHeight - el.clientHeight > 1);
        medir();
        if (typeof ResizeObserver === 'undefined') return undefined;
        // Girar el teléfono cambia el ancho y con él la respuesta.
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [id, texto, recortar, onRecorte]);

    return (
        <p ref={ref} className={`text-body-sm font-medium leading-snug mt-0.5 ${recortar ? 'line-clamp-3' : ''} ${clase}`}>
            {texto}
        </p>
    );
};

/* El ícono, en su propio componente de módulo.
   Resolverlo dentro de la tarjeta y rendirlo como `<Icono/>` es «crear un
   componente durante el render»: React lo trata como un tipo nuevo en cada
   pasada y le reinicia el estado. Acá el tipo es siempre el mismo y lo que
   cambia es su prop. */
const IconoDeAviso = ({ n, sev, isDark }) => (
    <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5 ${sev ? (isDark ? sev.oscuro : sev.claro) : tintForType(n.type, n.metadata, isDark)}`}>
        {/* `createElement` y no `<Glifo/>`: el glifo se elige en tiempo de
            render y escribirlo como JSX sobre una variable local es «crear un
            componente durante el render» — el compilador de React lo trata como
            un tipo nuevo en cada pasada. Acá el elemento se construye, no se
            declara un componente. */}
        {React.createElement(sev ? sev.Icono : iconoDeTipo(n.type), { size: 16, strokeWidth: 2 })}
    </div>
);

const TarjetaDeAviso = ({
    n,
    cx,
    isDark,
    quien = null,
    sucursal = null,
    buscarEmpleado = null,
    expandida = false,
    cuerpoCortado = false,
    onAlternarExpansion,
    onRecorte,
    onAbrir,
    acciones = null,
    controlDeBorrado = null,
    /* Sólo la campana los usa: el destello del que acaba de llegar y el
       atenuado de los que están en la ventana de «Borrar todas». */
    destello = false,
    atenuada = false,
}) => {
    const sev = severidadDelTitulo(n.title);
    const sinLeer = !n.read_at;

    // Una solicitud ya decidida no se "revisa": el verbo tiene que decir en qué
    // terminó, no invitar a algo que ya pasó.
    const resuelta    = n.metadata?.resuelta;
    const actionLabel = resuelta
        ? (RESUELTA_LABEL[resuelta] || 'Resuelta')
        : (n.link ? (etiquetaDeAccion(n) || 'Ver') : null);

    // Dos motivos para desplegar una tarjeta: el detalle de una solicitud, y un
    // cuerpo que no entra en tres renglones. El segundo dejaba sin leer justo a
    // los avisos del sistema, que son los que más texto tienen.
    const tieneDetalle = Boolean(n.metadata?.request_id);
    const expandible   = tieneDetalle || cuerpoCortado;

    // Interactiva es la que hace ALGO al tocarla, y desde que el toque es uno
    // solo eso significa «lleva a su pantalla». De eso depende el realce, que es
    // la promesa de que se puede tocar.
    const interactiva = Boolean(n.link || n.metadata?.request_id);

    /* El cierre de mes de una sala se dibuja en vez de leerse. Devuelve `null`
       para un aviso viejo o para un mes que cerró sin meta, y ahí la fila queda
       como siempre. */
    const cierre  = datosDeCierreDeMeta(n);
    /* Y su gemelo de administración, que mira las seis salas a la vez. */
    const empresa = datosDeCierreDeEmpresa(n);
    /* Y el de cada noche: comparte el anillo y la escala de colores con los dos
       de arriba, y agrega cómo quedó la caja y contra qué se compara. */
    const delDia  = datosDeCierreDelDia(n);
    const conAnillo = cierre || empresa || delDia;
    /* El faltante de caja de ayer. NO entra en `conAnillo`: aquéllos dibujan un
       porcentaje de cumplimiento con su escala de colores, y acá el arco es otra
       cosa —cuánto se contó de lo que debía haber— y su color es uno solo,
       porque un faltante nunca es verde. */
    const faltante = datosDeFaltanteDeCaja(n);
    /* Cómo abrió la mañana. Tampoco entra en `conAnillo`: su arco no mide un
       porcentaje sino CUÁNTAS de las seis salas abrieron, y su color no sale de
       la escala de cumplimiento — están todas o falta alguna, no hay franja
       naranja entre las dos. */
    const aperturas = datosDeAperturasDeLaManana(n);

    const corte = acciones?.corteDe?.(n) ?? null;
    const decidible = Boolean(acciones?.puedeDecidir?.(n));
    const traslado  = Boolean(acciones?.trasladoPorResolver?.(n));
    const ocupadoId = acciones?.decidiendoId ?? null;

    return (
        <div
            data-surface="card"
            className={`relative group overflow-hidden rounded-card ${atenuada ? 'pointer-events-none opacity-35' : ''}`}
        >
            {/* El estado de la tarjeta —sin leer, recién llegada— y el realce al
                apuntarla. Van en velos porque el fondo de la tarjeta lo fija
                `index.css` (ver `cx.rowHover`). Dos capas y no una: así apuntar
                una tarjeta sin leer SUMA realce en vez de reemplazar su tinte. */}
            <div aria-hidden="true"
                className={`absolute inset-0 pointer-events-none transition-colors duration-[var(--dur-lento)]
                    ${destello ? (isDark ? 'bg-chart-1/[0.14]' : 'bg-chart-1/10') : sinLeer ? cx.rowUnread : ''}`} />
            <div aria-hidden="true"
                className={`absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-[var(--dur-base)]
                    ${cx.veloHover} ${interactiva ? cx.rowHover : ''}`} />

            <button
                onClick={() => onAbrir?.(n)}
                // Este botón no es una pieza de la tarjeta: es su cara. Sin ceder
                // el filo, la animación al apuntar corre SU rectángulo y corta la
                // tarjeta justo arriba de Aprobar/Rechazar. Ver `index.css`.
                data-filo="ceder"
                className={`relative w-full flex items-start gap-3 pl-3.5 pr-9 py-3 text-left
                    ${interactiva ? 'cursor-pointer' : 'cursor-default'}`}
            >
                {faltante ? (
                    <AnilloDeFaltante datos={faltante} isDark={isDark} />
                ) : aperturas ? (
                    <AnilloDeAperturas datos={aperturas} isDark={isDark} />
                ) : conAnillo ? (
                    <AnilloDeMeta pct={conAnillo.pct} isDark={isDark} />
                ) : (
                    <IconoDeAviso n={n} sev={sev} isDark={isDark} />
                )}
                <div className="flex-1 min-w-0">
                    {/* El punto va PEGADO al título, no en la esquina. Arriba a
                        la derecha competía por el mismo sitio que la ✕ y no se
                        leía como «este es nuevo», sino como un adorno suelto. */}
                    <p className={`text-body leading-snug ${sinLeer ? `font-bold ${cx.rowTitle}` : `font-semibold ${cx.rowTitleRead}`}`}>
                        {sinLeer && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand align-middle mr-1.5 -mt-0.5 shadow-[var(--shadow-glow-brand-sm)]" />
                        )}
                        {tituloSinEmoji(n.title)}
                    </p>
                    {/* Con montos, las cifras se dibujan y el párrafo sobra:
                        diría en palabras lo mismo que está arriba en números.
                        Sin montos el `body` ya viene escrito en porcentaje y se
                        deja tal cual. */}
                    {((!conAnillo && !faltante && !aperturas) || (cierre && cierre.venta == null)) && n.body && (
                        <CuerpoDeAviso
                            id={n.id}
                            texto={n.body}
                            recortar={!expandida}
                            clase={cx.rowBody}
                            onRecorte={onRecorte}
                        />
                    )}
                    {cierre && (
                        <CuerpoDeCierreDeMeta datos={cierre} claseTenue={cx.rowBody}
                            isDark={isDark} buscarEmpleado={buscarEmpleado} />
                    )}
                    {delDia && (
                        <CuerpoDeCierreDelDia datos={delDia} claseTenue={cx.rowBody} isDark={isDark} />
                    )}
                    {faltante && (
                        <CuerpoDeFaltanteDeCaja datos={faltante} claseTenue={cx.rowBody} isDark={isDark} />
                    )}
                    {aperturas && (
                        <CuerpoDeAperturas datos={aperturas} claseTenue={cx.rowBody}
                            isDark={isDark} buscarEmpleado={buscarEmpleado} />
                    )}
                    {empresa && (
                        <CuerpoDeCierreDeEmpresa datos={empresa} claseTenue={cx.rowBody}
                            isDark={isDark} buscarEmpleado={buscarEmpleado} />
                    )}

                    {/* ── De quién y de qué sala ──────────────────────────────
                        El nombre viaja adentro del cuerpo («QA Testing
                        solicita…»), pero ahí es una palabra más en un párrafo de
                        tres renglones: no se distingue de un vistazo y la sala no
                        aparecía en ninguna parte. Acá van como dato, con la cara
                        adelante —que es lo que de verdad se reconoce— y sin
                        costar una consulta: las dos salen de la fila. */}
                    {(quien || sucursal) && (
                        <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                            {quien && (
                                <AvatarConEstado emp={quien} px={20} radio="rounded-full" marco="" />
                            )}
                            <span className={`text-caption font-bold truncate ${cx.rowTitleRead}`}>
                                {quien ? shortEmployeeName(quien) : sucursal}
                            </span>
                            {quien && sucursal && (
                                <span className={`text-caption font-medium truncate ${cx.rowTime}`}>· {sucursal}</span>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2 mt-1.5">
                        {/* CUÁNDO llegó, no cuánto hace: la hora si es de hoy, y
                            la fecha con la hora si es de ayer para atrás — ver
                            `cuandoLlego`. Va en minúscula y sin tracking ancho:
                            es contexto, no acción, y en mayúsculas competía de
                            igual a igual con «VER». */}
                        <span className={`text-caption font-medium tabular-nums ${cx.rowTime}`}>{cuandoLlego(n.created_at)}</span>
                        {/* Que este aviso salió de la bandeja. Dice «fuera de la
                            campana» y no «borrada» porque no se borró nada: la
                            fila está acá, a la vista, y su botón «Devolver» la
                            regresa. Sólo lo pinta el listado — en la campana la
                            columna viene siempre nula, porque lo que tiene fecha
                            ahí justamente no se muestra. */}
                        {n.deleted_at && (
                            <span className="text-caption font-semibold text-warning-text">
                                Fuera de la campana desde las {cuandoLlego(n.deleted_at)}
                            </span>
                        )}
                        {/* El verbo del TOQUE. «Ver detalle» dejó de vivir acá
                            —era una palabra dentro del botón grande, o sea que no
                            se podía tocar por su cuenta— y bajó a la fila de
                            controles como botón de verdad. */}
                        {actionLabel && (
                            <span className={`inline-flex items-center gap-1 text-caption font-black uppercase tracking-widest transition-transform
                                ${resuelta ? cx.chipMuted : `group-hover:translate-x-0.5 ${sinLeer ? (isDark ? 'text-chart-1-text' : 'text-brand-text') : cx.chipMuted}`}`}>
                                {actionLabel}
                                {/* La flecha promete "esto lleva a algún lado". En
                                    una solicitud ya decidida no lleva a nada que
                                    haya que hacer. */}
                                {!resuelta && <ArrowRight size={10} strokeWidth={3} />}
                            </span>
                        )}
                    </div>
                </div>
            </button>

            {/* ── «Ver detalle», un control de verdad ────────────────────────
                Era una palabra DENTRO del botón grande de la tarjeta, así que no
                se podía tocar por su cuenta. Acá es un botón, al ancho de la
                tarjeta y con la altura mínima de toque que garantiza
                `--tap-min`. */}
            {expandible && (
                <div className={`relative px-3.5 pb-2.5 ${resuelta ? '' : '-mt-1'} flex items-center gap-2`}>
                    {/* `secondary` y no `ghost`: en `ghost` era texto con un ícono
                        al lado —medido en iPhone 13, se leía como un rótulo
                        centrado y no como algo que se toca—. */}
                    <Button
                        size="xs"
                        variant="secondary"
                        icon={expandida ? ChevronDown : Eye}
                        className="flex-1 min-w-0"
                        aria-expanded={expandida}
                        onClick={(e) => { e.stopPropagation(); onAlternarExpansion?.(n.id); }}
                    >
                        {/* El rótulo nombra lo que se despliega. En un aviso del
                            sistema no hay ningún «detalle» que abrir: lo que falta
                            es el resto del mensaje. */}
                        {tieneDetalle
                            ? (expandida ? 'Ocultar detalle'  : 'Ver detalle')
                            : (expandida ? 'Ocultar mensaje'  : 'Ver mensaje completo')}
                    </Button>
                    {/* El estado de una solicitud ya decidida: sin esto, una
                        aprobada y una pendiente se leen igual una vez que el verbo
                        dejó de decirlo. */}
                    {resuelta && (
                        <span className={`shrink-0 text-caption font-black uppercase tracking-widest ${cx.chipMuted}`}>
                            {RESUELTA_LABEL[resuelta] || 'Resuelta'}
                        </span>
                    )}
                </div>
            )}

            {/* ── El detalle, desplegado ─────────────────────────────────────
                Lo que hay que ver para decidir: las líneas de producto de un
                ajuste, la factura de una modificación, el MIN/MAX de antes y el
                propuesto, las fotos de evidencia y el motivo escrito. Se monta
                SOLO al abrirla — el contenido pesa y no tiene por qué viajar por
                cada fila de la lista. */}
            {expandida && tieneDetalle && (
                <div className={`relative px-3.5 pb-3 pt-2 border-t ${cx.headerBorder}`}>
                    <NotificacionDetalle notif={n} />
                </div>
            )}

            {/* ── Decidir acá mismo ──────────────────────────────────────────
                Aprobar aplica de una: un toque y listo, sin pasar por otra
                pantalla ni por un segundo «confirmar». Rechazar abre el diálogo
                canónico, porque exige motivo — y ahí arriba se ve lo que se
                rechaza. La regla no está duplicada: las dos llaman a
                `useDecidirSolicitud`, la misma que usa la bandeja. */}
            {decidible && (
                <div className={`relative flex items-stretch gap-2 px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                    {/* `soft` y no relleno sólido: es el caso que nombra
                        DESIGN.md §15.2 — dos acciones de categoría juntas donde
                        ninguna manda. Van al ANCHO de la tarjeta, mitad y mitad:
                        dos acciones del mismo peso repartidas por igual no
                        dependen del largo de su etiqueta. */}
                    <Button
                        size="xs" tone="success" soft icon={Check} className="flex-1 min-w-0"
                        loading={ocupadoId === n.id && acciones?.decidiendo}
                        disabled={!!ocupadoId && ocupadoId !== n.id}
                        onClick={(e) => { e.stopPropagation(); acciones.onAprobar(n); }}
                    >
                        Aprobar
                    </Button>
                    <Button
                        size="xs" tone="danger" soft icon={X} className="flex-1 min-w-0"
                        disabled={!!ocupadoId}
                        onClick={(e) => { e.stopPropagation(); acciones.onRechazar(n); }}
                    >
                        Rechazar
                    </Button>
                </div>
            )}

            {/* ── El corte, resuelto acá mismo ───────────────────────────────
                «Confirmar» cierra el corte que cuadra al centavo de un toque; el
                que tiene diferencia abre el detalle con la cifra delante, porque
                firmar un faltante sin verlo no es un atajo, es otra cosa.
                «Descartar» siempre abre: exige decir por qué. */}
            {corte && (
                <div className={`relative flex items-stretch gap-2 px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                    <Button
                        size="xs" tone="success" soft icon={Check} className="flex-1 min-w-0"
                        loading={acciones.corteOcupado === corte.id}
                        disabled={!!acciones.corteOcupado && acciones.corteOcupado !== corte.id}
                        onClick={(e) => { e.stopPropagation(); acciones.onConfirmarCorte(n, corte); }}
                    >
                        Confirmar
                    </Button>
                    <Button
                        size="xs" tone="danger" soft icon={Ban} className="flex-1 min-w-0"
                        disabled={!!acciones.corteOcupado}
                        onClick={(e) => { e.stopPropagation(); acciones.onDescartarCorte(n, corte); }}
                    >
                        Descartar
                    </Button>
                </div>
            )}

            {/* El traslado abre su solicitud con el bloque que confirma o rechaza
                adentro. Un solo botón y no dos: confirmarlo relee la existencia
                de la sala de origen y puede resultar que ya no alcance, así que
                prometer «Aprobar» desde acá sería prometer lo que no se sabe. */}
            {traslado && (
                <div className={`relative px-3.5 pb-3 ${expandible ? '' : '-mt-1'}`}>
                    <Button
                        size="xs" soft icon={ArrowLeftRight} className="w-full"
                        loading={ocupadoId === n.id}
                        disabled={!!ocupadoId}
                        onClick={(e) => { e.stopPropagation(); acciones.onResolverTraslado(n); }}
                    >
                        Revisar el traslado
                    </Button>
                </div>
            )}

            {/* El control de borrado lo pone quien la dibuja, y no es un detalle
                de estilo: la campana borra con ventana de 3s para deshacer, y el
                historial manda a la papelera o devuelve de ella. Va ANCLADO
                arriba a la derecha — el texto ya le reserva el hueco con su
                `pr-9`. */}
            {controlDeBorrado && (
                <div className="absolute top-1.5 right-1.5 z-base flex items-center gap-1">
                    {controlDeBorrado}
                </div>
            )}
        </div>
    );
};

export default TarjetaDeAviso;
