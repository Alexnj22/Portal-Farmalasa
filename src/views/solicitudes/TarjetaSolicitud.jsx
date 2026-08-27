import React, { useState, useEffect, useRef, memo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, FileText, Clock } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import ModalShell from '../../components/common/ModalShell';
import PortalTextarea from '../../components/common/PortalTextarea';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import { ICONO_POR_TIPO } from '../../constants/tipoIconos';
import { useAuth } from '../../context/AuthContext';
import { CaraPersona, ChipPersona } from './PersonasSolicitud';
import {
    resumenMovimiento, esMovimiento, lineasDe, esParcial,
    fmtDiaMes as fmtDate, fmtHora, fmtFechaHora, desdeHace,
    personasDe, cuandoSeDecidio, salaQueEspera, motivoDeRechazoCorto,
} from './movimientoTexto';
import { shortEmployeeName } from '../../utils/nameUtils';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

// La tarjeta y el modal de una solicitud — el canónico, para las TRES pantallas
// que muestran solicitudes.
//
// Vivían dentro de `RequestsView`, y por eso «Mis Solicitudes» tenía una tarjeta
// propia, escrita a mano, con otro diseño: se desplegaba en el sitio en vez de
// abrir el modal, no decía su tipo, y su detalle cubría dos tipos contra los
// trece de acá. Preguntado así por el usuario: «¿por qué mis solicitudes no
// tiene la vista canónica de solicitudes de sucursal?». No había motivo — era
// que nadie la había unificado.
//
// Es exactamente el mismo error que ya se corrigió un nivel más abajo con
// `DetalleSolicitud`: dos copias del mismo componente se separan en cuanto
// alguien mejora una, y la que no se mejora es la que menos gente mira.

/* Los dos pesos del modal, diferidos — y esto NO es maquillaje del gate.
 *
 * Las dos cosas se dibujan ÚNICAMENTE dentro de `ModalSolicitud`, o sea sólo
 * cuando alguien abre una solicitud. Quien entra a la bandeja a mirar la cola
 * —que es la mayoría de las visitas— no las necesita nunca, y las estaba
 * bajando igual: `DetalleSolicitud` 7.8 kB gzip y `FilasTraslado` 6.1, entre
 * las dos casi un cuarto del peso de entrar a la vista (61 kB contra un techo
 * de 58, medido el 2026-08-21 con `npm run gate:bundle`).
 *
 * `NotificacionDetalle` ya cargaba `DetalleSolicitud` así desde antes: acá se
 * copia esa decisión en vez de dejar dos formas de importar el mismo archivo —
 * que además es lo que hace que las dos compartan un solo trozo.
 *
 * El `Suspense` va con `fallback={null}` a propósito: el modal ya tiene marco,
 * título y pie pintados, así que lo único que falta un instante es su cuerpo.
 * Un esqueleto ahí parpadearía más de lo que informa. */
const DetalleSolicitud = lazy(() => import('./DetalleSolicitud'));
const DecisionTraslado = lazy(() =>
    import('../traslados/FilasTraslado').then(m => ({ default: m.DecisionTraslado })));

const TYPE_ICONS = ICONO_POR_TIPO;

export const CompactSummary = ({ req }) => {
    const meta = typeof req.metadata === 'object' && req.metadata ? req.metadata : {};
    if (req.type === 'VACATION' && meta.startDate)
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}</span>;
    if (req.type === 'SHIFT_CHANGE' && meta.targetEmployeeName)
        return <span className="text-caption text-content-3">↔ {meta.targetEmployeeName.split(' ')[0]}{meta.date ? ` · ${fmtDate(meta.date)}` : ''}</span>;
    if (req.type === 'DISABILITY' && meta.startDate) {
        const days = meta.days || (meta.endDate ? Math.max(1, Math.round((new Date(meta.endDate+'T00:00:00') - new Date(meta.startDate+'T00:00:00')) / 86400000) + 1) : null);
        return <span className="text-caption text-content-3">{fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}{days ? ` · ${days}d` : ''}</span>;
    }
    if (req.type === 'PERMIT') {
        const dates = meta.permissionDates || [];
        if (dates.length) return <span className="text-caption text-content-3">{dates.length === 1 ? fmtDate(dates[0]) : `${dates.length} días`}</span>;
    }
    if (req.type === 'ADVANCE' && meta.amount)
        return <span className="text-caption text-content-3">${Number(meta.amount).toLocaleString('es-SV')}</span>;
    // Horas Extra caía al `req.note`: la lista mostraba el texto libre y no la
    // fecha ni las horas, que es lo único que distingue una de otra.
    if (req.type === 'OVERTIME' && (meta.date || meta.hours))
        return <span className="text-caption text-content-3">{[meta.date && fmtDate(meta.date), meta.hours && `${meta.hours} h`].filter(Boolean).join(' · ')}</span>;
    if (req.type === 'CERTIFICATE' && meta.certificateType) {
        const labels = { LABORAL: 'Laboral', SALARIO: 'Salario', BANCARIA: 'Bancaria' };
        return <span className="text-caption text-content-3">{labels[meta.certificateType] || meta.certificateType}</span>;
    }
    if (req.type === 'ANNULMENT_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo}{meta.reason ? ` · ${meta.reason}` : ''}</span>;
    if (req.type === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {meta.current_pago} → {meta.new_pago}</span>;
    // Por NOMBRE, no por código: «no quiero el código, quiero las fotos y
    // nombre» (usuario, 2026-08-10). Un `#140` no dice quién atendió.
    if (req.type === 'VENDOR_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {(meta.current_vendor_name || 'Sin vendedor').split(' ')[0]} → {(meta.new_vendor_name || '').split(' ')[0]}</span>;
    if (req.type === 'CLIENT_CHANGE_REQUEST' && meta.correlativo)
        return <span className="text-caption text-content-3">{meta.correlativo} · {(meta.current_cliente || 'Sin nombre').split(' ')[0]} → {(meta.new_client_name || '').split(' ')[0]}</span>;
    // Los tres que mueven producto. Sin esta rama caían al `req.note`, o sea que
    // un descarte se resumía con el texto libre de quien lo pidió —«inyectorio»—
    // y el producto, que es lo que se está por sacar de la sala, no aparecía.
    if (esMovimiento(req.type))
        return <span className="text-caption text-content-3 truncate max-w-[220px]">{resumenMovimiento(meta)}</span>;
    if (req.type === 'MINMAX_CHANGE_REQUEST')
        return <span className="text-caption text-content-3 truncate max-w-[220px]">{meta.producto ?? `#${meta.erp_product_id}`} · MIN {meta.min_actual ?? '—'}→{meta.min_pedido ?? '—'}</span>;
    if (req.note) return <span className="text-caption text-content-3 italic truncate max-w-[160px]">&ldquo;{req.note}&rdquo;</span>;
    return null;
};

// ─── Tarjeta ──────────────────────────────────────────────────────────────────
//
// La tarjeta DICE, el modal MUESTRA.
//
// Antes se desplegaba en el sitio, y traía tres problemas encima:
//
//  1. Las tarjetas viven en una rejilla de hasta 3 columnas. Desplegar una
//     empujaba toda su fila, con un `max-h-[900px]` de salto.
//  2. Lo que hay que mostrar no entra en un tercio de ancho —la tabla de
//     líneas, las fotos, y sobre todo la decisión por línea, que necesita una
//     casilla por renglón—. En el teléfono era inusable.
//  3. Era un `<button>` con más botones adentro, y por eso hacía falta `inert`
//     para que el teclado no cayera en controles escondidos.
//
// Y falta lo que la tarjeta NO decía: su tipo. El nombre del tipo vivía sólo en
// el encabezado del grupo, así que una tarjeta mirada sola no lo tenía, y el
// ícono caía al genérico en los tres tipos de inventario. Ahora el tipo se lee
// en la tarjeta misma, por ícono y por nombre — **nunca por color**: el color
// sigue reservado al estado, que es la decisión que ya tomó la auditoría de
// tema y que nueve tintes compitiendo habían roto.
//
// ── La cara y la hora (2026-08-11) ─────────────────────────────────────────
// Faltaban las dos, y con ellas la mitad de lo que uno pregunta al mirar la
// bandeja: quién la mandó (el nombre lo decía, la cara no), quién la resolvió
// —que no aparecía en ningún lado— y a qué hora pasó cada cosa. El día suelto
// («11 ago 2026») hacía indistinguibles un descarte de las 8 de la mañana y uno
// de las 9 de la noche.
//
// El pie de la tarjeta es el que contesta esas tres: a la izquierda cuándo se
// mandó —y cuánto lleva esperando, si sigue pendiente—; a la derecha quién la
// tiene que decidir o quién ya la decidió, con su cara y su hora.
/**
 * @param empleadosPorId  El maestro de personal. Trae la foto ya firmada y el
 *                        cargo; sin él la tarjeta se cae a lo que hidrató
 *                        `fetchRequests`, que desde hoy también las trae.
 * @param ahora           El reloj, de `useNowTick`. Viene de la vista y no de
 *                        acá: un `setInterval` por tarjeta serían cincuenta
 *                        relojes para pintar el mismo minuto.
 */
export const RequestCard = memo(({ req, onOpen, empleadosPorId, ahora }) => {
    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3' };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;
    const typeConf = REQUEST_TYPES[req.type] || { label: req.type };
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';
    const parcial    = esParcial(req);

    const { solicitante, aprobador } = personasDe(req, empleadosPorId);
    const meta        = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    /* La sala de la tarjeta. En un traslado son DOS y la del metadata es la de
     * DESTINO —la que pidió—, así que mostrarla sola decía justo lo contrario de
     * lo que hay que saber para contestarlo: de dónde sale el producto. Se leía
     * «TRASLADO ENTRE SALAS · La Popular» cuando el producto salía de Bodega.
     *
     * Importa desde v2.657.0, cuando una sala pasó a poder confirmar traslados
     * de la sala que cubre mientras está cerrada: hasta entonces el origen era
     * siempre la sala propia y no hacía falta decirlo. El detalle ya mostraba el
     * recorrido; la tarjeta, no. */
    const esTraslado  = req.type === 'INVENTORY_TRANSFER_REQUEST';
    const sala        = esTraslado
        ? ([meta.origen_branch_name, meta.branch_name].filter(Boolean).join(' → ') || null)
        : (meta.branch_name || solicitante?.branch_name || null);
    const decidida    = req.status === 'APPROVED' || req.status === 'REJECTED';
    /* Un ajuste de Min/Max no tiene aprobador asignado: su tabla no guarda uno y
     * lo resuelve quien tenga el permiso del módulo. Decir «Espera a: Sin
     * asignar» ahí sonaría a que se perdió el destinatario — y lo que pasa es
     * que nunca hubo uno. */
    const sinAprobadorFijo = req.type === 'MINMAX_CHANGE_REQUEST' && !aprobador;
    /* Un traslado pendiente no lo espera una persona: lo espera la SALA que
     * tiene el producto, y desde v2.656.7 lo confirma cualquiera de ella con
     * permiso. El nombre que salía acá era `approver_id` —el primero de la
     * lista de destinatarios—, o sea uno de varios, y se leía como que sólo ése
     * podía. Fue exactamente lo que se reportó mirando esta tarjeta. */
    const esperaSala = salaQueEspera(req);
    const cuandoCerro = cuandoSeDecidio(req);
    const espera      = req.status === 'PENDING' ? desdeHace(req.created_at, ahora) : '';
    // Dos días esperando ya no es «recién llegada»: la espera se tiñe sola para
    // que la cola se lea sin contar fechas. El umbral es el mismo que usa la
    // baldosa del tablero para decir que alguien se está durmiendo.
    const esperaLarga = req.status === 'PENDING' && ahora
        && (ahora - new Date(req.created_at).getTime()) > 2 * 86400000;
    /* Por qué se rechazó, en la tarjeta y no sólo al abrirla.
     *
     * Una tarjeta que dice «Rechazada» y nada más obliga a abrir el detalle
     * —o a preguntar por WhatsApp— para saber qué corregir, y quien pidió el
     * producto está mirando justamente eso. Pedido del usuario, 2026-08-18. */
    const motivoRechazo = motivoDeRechazoCorto(req);

    return (
        <button data-surface="card" onClick={() => onOpen(req)}
            className={`group w-full text-left px-4 py-3.5 flex flex-col gap-2.5 overflow-hidden transform-gpu
                hover:bg-surface-card-hover/40 active:scale-[0.99]
                transition-[background-color,transform,border-color] duration-[var(--dur-base)]
                ${isUrgent ? '!border-danger' : isRejected ? '!border-danger/30' : ''}`}>

            <div className="flex items-center gap-3">
                {/* La cara dice quién; la insignia, de qué es; el color, el estado.
                    La insignia se veía como un arco de 2px hasta el 2026-08-15: la
                    foto le pasaba por encima. No era el orden de acá —va después,
                    que es lo correcto— sino que el avatar dejaba escapar el
                    `z-base` de su `<img>`; se arregló en `LiquidAvatar`, y por eso
                    esta esquina no lleva ningún z-index. */}
                <div className="relative flex-shrink-0">
                    <CaraPersona persona={solicitante} px={40} />
                    <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full
                                     bg-surface-card border border-border-card flex items-center justify-center">
                        <TypeIcon size={10} strokeWidth={2.5} className="text-content-2" />
                    </span>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {solicitante && (
                            <span className="text-body font-semibold text-content truncate leading-tight max-w-[160px]" title={solicitante.name}>
                                {shortEmployeeName(solicitante)}
                            </span>
                        )}
                        <span className={`flex items-center gap-1 text-caption font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                            {parcial ? 'Aprobada parcial' : statConf.label}
                        </span>
                        {isUrgent && <span className="text-micro font-black text-danger animate-pulse shrink-0">URGENTE</span>}
                    </div>

                    {/* El tipo, escrito. Una tarjeta fuera de su grupo no lo tenía.
                        Y la sala al lado: con alcance sobre todas, la bandeja
                        mezcla siete y la tarjeta no decía de cuál venía. La del
                        movimiento manda —es donde pasa la cosa— y si no hay,
                        la de quien la mandó. */}
                    <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-0.5 truncate">
                        {typeConf.label}
                        {sala && <span className="font-bold normal-case tracking-normal"> · {sala}</span>}
                    </p>

                    <CompactSummary req={req} />
                </div>

                <OjoDeTarjeta className="self-start mt-1" />
            </div>

            {/* El motivo del rechazo, entre lo que se pidió y quién lo cerró.
                Va ARRIBA del pie porque es contenido de la solicitud, no
                metadato de la decisión — y porque en la lista es lo primero que
                se busca cuando la tarjeta ya dice «Rechazada».

                `line-clamp-2`: un motivo escrito a mano puede ser un párrafo, y
                en una rejilla que iguala alturas eso estira toda la fila. Se
                lee entero al abrirla. */}
            {motivoRechazo && (
                <p className="text-micro text-danger-text font-medium leading-snug line-clamp-2"
                   title={motivoRechazo}>
                    {motivoRechazo}
                </p>
            )}

            {/* El pie: cuándo entró y en manos de quién está. */}
            <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-divider">
                <span className="flex items-center gap-1 min-w-0 text-micro text-content-3">
                    <Clock size={11} strokeWidth={2.5} className="flex-shrink-0" />
                    <span className="truncate">{fmtFechaHora(req.created_at)}</span>
                    {espera && (
                        <span className={`shrink-0 font-bold ${esperaLarga ? 'text-warning-text' : 'text-content-3'}`}>
                            · {espera}
                        </span>
                    )}
                </span>

                {(decidida || (req.status === 'PENDING' && !sinAprobadorFijo)) && (
                    <span className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-micro font-black uppercase tracking-widest shrink-0
                            ${isRejected ? 'text-danger' : decidida ? 'text-success' : 'text-content-3'}`}>
                            {isRejected ? 'Rechazó' : decidida ? 'Aprobó' : 'Espera a'}
                        </span>
                        <ChipPersona persona={aprobador} sala={esperaSala}
                            vacio={decidida ? 'Sin registro' : 'Sin asignar'} />
                        {decidida && cuandoCerro && (
                            <span className="text-micro text-content-3 shrink-0">{fmtHora(cuandoCerro)}</span>
                        )}
                    </span>
                )}
            </div>
        </button>
    );
});
RequestCard.displayName = 'RequestCard';

// ─── El modal de una solicitud ────────────────────────────────────────────────
//
// Ver primero, decidir después. El diálogo de aprobar/rechazar era una ventana
// aparte que se abría SIN haber mostrado nunca qué se estaba aprobando — y el
// enlace de la campana con `&accion=aprobar` iba derecho ahí. O sea que el
// camino más corto hasta una decisión era el que menos información daba.
//
// Acá la decisión vive DENTRO del detalle: lo que se ajusta y la nota están
// debajo de lo que se está mirando, como en la fila de un traslado, en vez de
// taparlo con otra ventana encima. Y el pie decide de una — el segundo toque
// quedó sólo para el rechazo, que es el que exige escribir un motivo.
/**
 * @param accionInicial `'reject'` abre el motivo desplegado (deep-link
 *                      `&accion=rechazar`). Cualquier otro valor abre el
 *                      detalle a secas: aprobar ya no es un paso aparte.
 * @param accionPropia  Acción de quien MANDÓ la solicitud —hoy, cancelarla—.
 *                      Va aparte de `onDecidir` porque no es una decisión: no
 *                      la toma quien aprueba y no necesita motivo.
 * @param extra         Bloque propio de la pantalla que lo usa (p. ej. adjuntar
 *                      el certificado de una incapacidad, que sólo tiene sentido
 *                      del lado de quien la pidió).
 * @param onResuelto    Se llama cuando un TRASLADO se despachó o se rechazó.
 *                      Va aparte de `onDecidir` porque el traslado no se decide
 *                      con `approveRequest`: lo aplica una Edge Function que
 *                      mueve existencia de verdad, así que el store no se entera
 *                      solo y la pantalla tiene que volver a leer.
 */
export const ModalSolicitud = ({ req, canApprove, employeesById, onCerrar, onDecidir, ocupado, accionInicial, accionPropia, extra, onResuelto }) => {
    /* Sólo el RECHAZO es un modo aparte, y por una razón concreta: exige un
     * motivo escrito, así que hay algo que llenar antes de poder confirmar.
     *
     * Aprobar no tenía ninguna: apretar «Aprobar» sólo cambiaba el pie por otro
     * botón que decía «Aprobar completo», o sea dos toques para decir lo mismo
     * sobre un detalle que ya se estaba mirando. Corregido a pedido del usuario
     * (2026-08-16): «me toca darle 2 veces confirmar … eso que pase solo para
     * descartar». Lo que se ajusta antes de aprobar —qué líneas entran y con
     * cuánta cantidad— ya no se despliega al entrar en un modo: está a la vista
     * desde que se abre el detalle, que es donde se mira. */
    const [modo, setModo]   = useState(accionInicial === 'reject' ? 'reject' : null);   // null | 'reject'
    const [nota, setNota]   = useState('');
    const bloqueDecision    = useRef(null);
    const { hasPermission } = useAuth();

    const meta      = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const lineas    = lineasDe(meta);
    const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
    /* El traslado NO pasa por la decisión genérica, y nunca pasó: aprobarlo con
     * `approveRequest` lo marcaría APROBADO sin mover un solo producto. Lo que
     * cambió el 2026-08-15 es que ya no manda a otra pantalla a resolverlo —
     * trae acá su propio bloque, que es el mismo de la tarjeta del tablero.
     *
     * Su permiso también es propio (`traslados.can_approve`, no `requests`), y
     * se pregunta acá porque `canApprove` habla del módulo del ámbito. Es la
     * misma cuenta que hace la policy de la base: sin ese permiso no hay botón,
     * y con él la base acepta. */
    /* El ENVÍO tampoco pasa por la decisión genérica, y acá cuesta más caro que
     * en el traslado: el producto YA SALIÓ de la sala de origen. Aprobarlo con
     * `approveRequest` lo daría por recibido sin cargarlo en el sistema. Se
     * decide renglón por renglón en «Traslados entre salas». */
    const esEnvio    = req.type === 'INVENTORY_TRANSFER_PUSH';
    const decidible  = req.status === 'PENDING' && canApprove && !esTraslado && !esEnvio;
    const decidibleTraslado = esTraslado && req.status === 'PENDING'
        && hasPermission('traslados', 'can_approve');

    /* Qué entra y cuánto.
     *
     * Son DOS ajustes distintos y hacían falta los dos: quitar renglones enteros
     * («quitar unos») y bajarle la cantidad a uno que sí entra («modificar
     * unos»). Con sólo lo primero, que de 4 unidades pedidas entraran 2 obligaba
     * a rechazar la línea completa y pedir que la mandaran de nuevo.
     *
     * La cantidad se ofrece incluso con UNA sola línea: ahí no hay nada que
     * elegir entre renglones, pero sí cuánto de ese renglón entra. Las casillas,
     * en cambio, sólo aparecen con más de una — con una sola, desmarcarla es
     * rechazar, y para eso está su botón.
     *
     * Se ofrecen mientras no se esté rechazando: al rechazar no hay nada que
     * recortar y las casillas sólo confundirían. */
    const editable = decidible && esMovimiento(req.type) && modo !== 'reject';
    const porLinea = editable && lineas.length > 1;

    const [seleccion, setSeleccion] = useState(() => new Set(lineas.map((_, i) => i)));
    const [cantidades, setCantidades] = useState(
        () => new Map(lineas.map((l, i) => [i, Number(l.cantidad) || 0])));

    const alternar = (i) => setSeleccion(prev => {
        const s = new Set(prev);
        s.has(i) ? s.delete(i) : s.add(i);
        return s;
    });
    const fijarCantidad = (i, n) => setCantidades(prev => {
        const tope = Number(lineas[i]?.cantidad) || 0;
        const m = new Map(prev);
        m.set(i, Math.max(1, Math.min(tope, n)));   // nunca 0 ni más de lo pedido
        return m;
    });

    const fuera    = lineas.length - seleccion.size;
    const recortes = [...seleccion].filter(i => (cantidades.get(i) ?? 0) < (Number(lineas[i]?.cantidad) || 0)).length;
    // «Parcial» es cualquier cosa que no sea exactamente lo que pidieron: falta
    // un renglón, o falta cantidad en alguno.
    const parcial  = editable && seleccion.size > 0 && (fuera > 0 || recortes > 0);

    // Aprobar sin nada seleccionado no es aprobar: es rechazar con otro nombre,
    // y se dice en vez de dejar apretar un botón que no hace lo que promete.
    const nadaSeleccionado = porLinea && seleccion.size === 0;

    const faltaMotivo = (modo === 'reject' && !nota.trim())
                     || (modo === null && parcial && !nota.trim());

    const confirmar = (modoElegido) => onDecidir({
        req, modo: modoElegido, nota: nota.trim(),
        // Qué entra y cuánto — sólo cuando de verdad se cambió algo. Van los
        // ÍNDICES con su cantidad, nunca las líneas: el servidor las resuelve
        // contra lo que se guardó al crear la solicitud.
        aceptadas: parcial
            ? [...seleccion].sort((a, b) => a - b)
                .map(i => ({ i, cantidad: cantidades.get(i) ?? (Number(lineas[i]?.cantidad) || 0) }))
            : null,
    });

    /* En el teléfono el detalle es más alto que la pantalla, así que al entrar a
     * rechazar —y al dejar una línea afuera— el motivo que HABILITA el botón
     * queda debajo del pliegue. Sin esto se ve un botón apagado y ninguna pista
     * de por qué: hay que adivinar que abajo hay un campo obligatorio.
     * Se trae a la vista en vez de esperar que alguien deslice a buscarlo.
     *
     * Al abrir NO se mueve nada: con la nota opcional siempre a la vista, esto
     * corría en el primer render y arrancaba el detalle deslizado hasta abajo,
     * tapando justo lo que hay que leer antes de decidir. */
    useEffect(() => {
        if (modo === null && !parcial && !nadaSeleccionado) return;
        bloqueDecision.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [modo, parcial, nadaSeleccionado]);

    const statConf = REQUEST_STATUS[req.status] || { label: req.status };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-xl" zClass="z-toast"
            closeOnEsc={!ocupado} surface={null}
            ariaLabel={`Solicitud de ${REQUEST_TYPES[req.type]?.label ?? req.type}`}>
            <CuerpoDialogo
                titulo={REQUEST_TYPES[req.type]?.label ?? req.type}
                /* El nombre se fue del subtítulo: lo dice —con su cara, su cargo
                   y su sala— la ficha que abre el detalle, y repetirlo dos
                   renglones más arriba gastaba el único lugar donde cabía la
                   hora. */
                subtitulo={`${esParcial(req) ? 'Aprobada parcial' : statConf.label} · ${fmtFechaHora(req.created_at)}`}
                icono={TypeIcon}
                anchoEscritorio="max-w-xl"
                pie={<>
                    {/* Aprobar APLICA. No abre un segundo paso: lo que había
                        que ver ya está arriba y lo que se puede ajustar está a
                        la vista. Sólo se apaga cuando la decisión todavía no es
                        una —nada marcado, o un parcial sin explicar—. */}
                    {decidible && modo === null && (
                        <>
                            <Button tone="success" icon={Check} loading={ocupado}
                                disabled={faltaMotivo || nadaSeleccionado}
                                onClick={() => confirmar('approve')}>
                                {parcial ? 'Aplicar lo marcado' : 'Aprobar'}
                            </Button>
                            {/* La nota NO se borra al entrar: si venía escrita
                                es porque el parcial la exigía, y es la misma
                                explicación. Volviéndola a pedir en blanco, el
                                motivo se escribe dos veces. */}
                            <Button variant="destructive" icon={X} disabled={ocupado}
                                onClick={() => setModo('reject')}>Rechazar</Button>
                        </>
                    )}
                    {decidible && modo === 'reject' && (
                        <>
                            <Button onClick={() => confirmar('reject')} loading={ocupado}
                                disabled={faltaMotivo}
                                tone="danger" icon={X}>
                                Confirmar rechazo
                            </Button>
                            <Button variant="ghost" disabled={ocupado} onClick={() => { setModo(null); setNota(''); }}>
                                Volver
                            </Button>
                        </>
                    )}
                    {/* «Cerrar» sólo cuando no se está decidiendo: al lado de
                        «Volver» son dos salidas para lo mismo, y en el teléfono
                        empujan el pie a tres botones en dos renglones. */}
                    {modo === null && accionPropia && (
                        <Button variant="destructive" icon={X} disabled={ocupado}
                            onClick={() => accionPropia.onClick(req)}>{accionPropia.label}</Button>
                    )}
                    {modo === null && (
                        <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                    )}
                </>}
            >
                <div className="space-y-3 text-left max-h-[60vh] overflow-y-auto pr-1">
                    <Suspense fallback={null}>
                        <DetalleSolicitud req={req} employeesById={employeesById}
                            seleccion={porLinea ? seleccion : undefined}
                            onToggle={porLinea ? alternar : undefined}
                            onCantidad={editable ? fijarCantidad : undefined}
                            cantidades={editable ? cantidades : undefined} />
                    </Suspense>

                    {editable && (
                        <div>
                            <Notice variant={nadaSeleccionado ? 'danger' : parcial ? 'warning' : 'info'} icon={Check}>
                                {nadaSeleccionado
                                    ? 'No dejaste ninguna línea marcada. Si no entra nada, rechazá la solicitud.'
                                    : parcial
                                        ? [
                                            fuera > 0 && (fuera === 1
                                                ? 'Queda 1 producto afuera'
                                                : `Quedan ${fuera} productos afuera`),
                                            recortes > 0 && (recortes === 1
                                                ? 'a 1 le bajaste la cantidad'
                                                : `a ${recortes} les bajaste la cantidad`),
                                          ].filter(Boolean).join(' y ') + '. Cuenta por qué abajo.'
                                        : 'Entra todo lo que se pidió, completo.'}
                            </Notice>
                        </div>
                    )}

                    {/* La decisión del traslado, debajo de lo que se está
                        mirando — igual que el resto del modal, que despliega la
                        decisión en el sitio en vez de tapar el detalle.
                        Es el MISMO bloque de la tarjeta del tablero: relee la
                        existencia de la sala de origen al abrirse, avisa si ya
                        no alcanza, y ofrece los cuatro motivos de rechazo que
                        la base valida. No se copió — se importa. */}
                    {decidibleTraslado && (
                        <div className="pt-1">
                            <Suspense fallback={null}>
                                <DecisionTraslado fila={req}
                                    onHecho={(estado) => { onResuelto?.(estado); onCerrar(); }} />
                            </Suspense>
                        </div>
                    )}

                    {/* ── El envío se contesta en su pantalla ──────────────
                        Y hay que DECIRLO. Sin esto el modal se abre con el
                        detalle, sin un solo botón y sin explicación: es el
                        «me pierdo» que hizo mudar la decisión del traslado acá,
                        pero al revés.

                        No trae su bloque de decisión como el traslado porque el
                        envío se resuelve renglón por renglón —aceptar unos y
                        devolver otros—, y eso es una pantalla, no un par de
                        botones. */}
                    {esEnvio && req.status === 'PENDING' && (
                        <div className="pt-1">
                            <p className="text-label text-content-2 font-medium leading-snug">
                                Este envío se contesta producto por producto en{' '}
                                <Link to="/traslados?tab=envios"
                                    className="font-black text-brand-text underline underline-offset-2"
                                    onClick={onCerrar}>
                                    Traslados entre salas
                                </Link>
                                : ahí se acepta lo que se queda la sala y se devuelve lo demás con su motivo.
                            </p>
                        </div>
                    )}

                    {extra}

                    {/* El motivo se pide UNA vez, y sólo cuando hace falta.
                        Hasta el 2026-08-26 este campo estaba a la vista desde
                        que se abría el detalle, con el rótulo «Nota para quien
                        la envió», y al apretar «Rechazar» cambiaba de rótulo y
                        se vaciaba. Desde afuera eso son DOS preguntas por lo
                        mismo: «antes de confirmar y rechazar me pregunta
                        motivo, y al rechazar me pregunta de nuevo». Y aprobar
                        nunca necesitó una: la decisión se explica sola.

                        Queda entonces en los dos casos en que no se explica
                        sola —un rechazo y un parcial—, y en los dos es
                        obligatoria. La nota opcional de quien aprueba se cayó
                        con esto a propósito: nadie la escribía y su precio era
                        preguntar dos veces. */}
                    {decidible && (modo === 'reject' || parcial) && (
                        <div ref={bloqueDecision}>
                            <label className={rotuloCampo('text-content-2')}>
                                {modo === 'reject' ? 'Motivo de rechazo' : 'Por qué no entra todo'}
                                <span className="text-danger ml-1">*</span>
                            </label>
                            <PortalTextarea
                                value={nota}
                                onChange={e => setNota(e.target.value)}
                                rows={3}
                                placeholder="Explicá el motivo..."
                                readOnly={ocupado}
                                textareaClassName="disabled:opacity-50"
                            />
                        </div>
                    )}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
};

