import React, { useState, useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, ArrowLeftRight, Eye, FileText } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import ModalShell from '../../components/common/ModalShell';
import PortalTextarea from '../../components/common/PortalTextarea';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import { ICONO_POR_TIPO } from '../../constants/tipoIconos';
import DetalleSolicitud from './DetalleSolicitud';
import { resumenMovimiento, esMovimiento, lineasDe, esParcial, fmtDiaMes as fmtDate, fmtDateFull } from './movimientoTexto';
import { shortEmployeeName } from '../../utils/nameUtils';

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
export const RequestCard = memo(({ req, onOpen }) => {
    const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-surface-card-hover text-content-3', border: 'border-divider', dot: 'bg-content-3' };
    const TypeIcon = TYPE_ICONS[req.type] || FileText;
    const typeConf = REQUEST_TYPES[req.type] || { label: req.type };
    const isRejected = req.status === 'REJECTED';
    const isUrgent   = req.type === 'DISABILITY' && req.status === 'PENDING';
    const parcial    = esParcial(req);

    return (
        <button data-surface="card" onClick={() => onOpen(req)}
            className={`w-full text-left px-4 py-3.5 flex items-center gap-3 overflow-hidden transform-gpu
                hover:bg-surface-card-hover/40 active:scale-[0.99]
                transition-[background-color,transform,border-color] duration-[var(--dur-base)]
                ${isUrgent ? '!border-danger' : isRejected ? '!border-danger/30' : ''}`}>

            {/* El ícono dice el tipo; el color, el estado. */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-card-hover border border-divider">
                <TypeIcon size={15} strokeWidth={2} className="text-content-2" />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {req.employee && (
                        <span className="text-body font-semibold text-content truncate leading-tight max-w-[160px]" title={req.employee.name}>
                            {shortEmployeeName(req.employee)}
                        </span>
                    )}
                    <span className={`flex items-center gap-1 text-caption font-bold shrink-0 ${statConf.color.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />
                        {parcial ? 'Aprobada parcial' : statConf.label}
                    </span>
                    {isUrgent && <span className="text-micro font-black text-danger animate-pulse shrink-0">URGENTE</span>}
                </div>

                {/* El tipo, escrito. Una tarjeta fuera de su grupo no lo tenía. */}
                <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-0.5 truncate">
                    {typeConf.label}
                </p>

                <div className="flex items-center gap-1.5 flex-wrap">
                    <CompactSummary req={req} />
                    <span className="text-micro text-content-3 shrink-0">{fmtDateFull(req.created_at)}</span>
                </div>
            </div>

            <Eye size={14} strokeWidth={2.5} className="text-content-3 flex-shrink-0" />
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
// Acá la decisión vive DENTRO del detalle: se despliega debajo de lo que se
// está mirando, como hace la fila de un traslado, en vez de taparlo con otra
// ventana encima.
/**
 * @param accionPropia  Acción de quien MANDÓ la solicitud —hoy, cancelarla—.
 *                      Va aparte de `onDecidir` porque no es una decisión: no
 *                      la toma quien aprueba y no necesita motivo.
 * @param extra         Bloque propio de la pantalla que lo usa (p. ej. adjuntar
 *                      el certificado de una incapacidad, que sólo tiene sentido
 *                      del lado de quien la pidió).
 */
export const ModalSolicitud = ({ req, canApprove, employeesById, onCerrar, onDecidir, ocupado, accionInicial, accionPropia, extra }) => {
    const [modo, setModo]   = useState(accionInicial ?? null);   // null | 'approve' | 'reject'
    const [nota, setNota]   = useState('');
    const navigate          = useNavigate();
    const bloqueDecision    = useRef(null);

    const meta      = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const lineas    = lineasDe(meta);
    const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
    const decidible  = req.status === 'PENDING' && canApprove && !esTraslado;

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
     * rechazar, y para eso está su botón. */
    const editable = decidible && esMovimiento(req.type);
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
                     || (modo === 'approve' && parcial && !nota.trim());

    const confirmar = () => onDecidir({
        req, modo, nota: nota.trim(),
        // Qué entra y cuánto — sólo cuando de verdad se cambió algo. Van los
        // ÍNDICES con su cantidad, nunca las líneas: el servidor las resuelve
        // contra lo que se guardó al crear la solicitud.
        aceptadas: parcial
            ? [...seleccion].sort((a, b) => a - b)
                .map(i => ({ i, cantidad: cantidades.get(i) ?? (Number(lineas[i]?.cantidad) || 0) }))
            : null,
    });

    /* En el teléfono el detalle es más alto que la pantalla, así que al entrar en
     * modo decisión —y al dejar una línea afuera— el motivo que HABILITA el botón
     * queda debajo del pliegue. Sin esto se ve un botón apagado y ninguna pista
     * de por qué: hay que adivinar que abajo hay un campo obligatorio.
     * Se trae a la vista en vez de esperar que alguien deslice a buscarlo. */
    useEffect(() => {
        if (modo === null) return;
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
                subtitulo={`${req.employee ? shortEmployeeName(req.employee) : 'Sin nombre'} · ${fmtDateFull(req.created_at)} · ${esParcial(req) ? 'Aprobada parcial' : statConf.label}`}
                icono={TypeIcon}
                anchoEscritorio="max-w-xl"
                pie={<>
                    {decidible && modo === null && (
                        <>
                            <Button tone="success" icon={Check} disabled={ocupado}
                                onClick={() => { setModo('approve'); setNota(''); }}>Aprobar</Button>
                            <Button variant="destructive" icon={X} disabled={ocupado}
                                onClick={() => { setModo('reject'); setNota(''); }}>Rechazar</Button>
                        </>
                    )}
                    {decidible && modo !== null && (
                        <>
                            <Button onClick={confirmar} loading={ocupado}
                                disabled={faltaMotivo || nadaSeleccionado}
                                tone={modo === 'approve' ? 'success' : 'danger'}
                                icon={modo === 'approve' ? Check : X}>
                                {modo === 'approve'
                                    ? (parcial ? 'Aplicar lo marcado' : 'Aprobar completo')
                                    : 'Confirmar rechazo'}
                            </Button>
                            <Button variant="ghost" disabled={ocupado} onClick={() => { setModo(null); setNota(''); }}>
                                Volver
                            </Button>
                        </>
                    )}
                    {esTraslado && req.status === 'PENDING' && (
                        <Button icon={ArrowLeftRight} onClick={() => navigate('/traslados')}>
                            Resolver en Traslados
                        </Button>
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
                    {/* Un traslado se resuelve en su pantalla, no acá. Y no es un
                        detalle de gusto: confirmarlo relee la existencia de la
                        sala de origen justo antes de despachar y ofrece los
                        motivos de rechazo que la base valida. Aprobarlo desde
                        acá lo marcaba APROBADO **sin mover nada** y lo hacía
                        desaparecer de las tres pestañas de Traslados. */}
                    {esTraslado && req.status === 'PENDING' && (
                        <Notice variant="info" icon={ArrowLeftRight}>
                            Este traslado se confirma o se rechaza en la pantalla de Traslados,
                            donde se revisa la existencia de la sala antes de enviarlo.
                        </Notice>
                    )}

                    <DetalleSolicitud req={req} employeesById={employeesById}
                        seleccion={porLinea && modo === 'approve' ? seleccion : undefined}
                        onToggle={porLinea && modo === 'approve' ? alternar : undefined}
                        onCantidad={editable && modo === 'approve' ? fijarCantidad : undefined}
                        cantidades={editable && modo === 'approve' ? cantidades : undefined} />

                    {modo === 'approve' && editable && (
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
                                          ].filter(Boolean).join(' y ') + '. Contá por qué abajo.'
                                        : 'Entra todo lo que se pidió, completo.'}
                            </Notice>
                        </div>
                    )}

                    {extra}

                    {modo !== null && (
                        <div ref={bloqueDecision}>
                            <label className="text-label font-black uppercase tracking-widest text-content-2 mb-1.5 block">
                                {modo === 'reject' ? 'Motivo de rechazo'
                                    : parcial ? 'Por qué no entra todo'
                                    : 'Nota para quien la envió'}
                                {(modo === 'reject' || parcial) && <span className="text-danger ml-1">*</span>}
                            </label>
                            <PortalTextarea
                                value={nota}
                                onChange={e => setNota(e.target.value)}
                                rows={3}
                                placeholder={modo === 'approve' && !parcial ? 'Opcional...' : 'Explicá el motivo...'}
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

