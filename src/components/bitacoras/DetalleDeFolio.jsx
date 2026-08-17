import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Camera, FileText, Package, Stethoscope, Store, User } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import { LoadingState } from '../common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { formatMoney } from '../../utils/formatNumber';
import { openStoredFile } from '../../utils/storageFiles';
import { ESTADO_RENGLON, fetchFolio } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Un folio, abierto.
//
// El pedido era literal: «al buscar uno, se tenga toda la información. Receta,
// venta, y toda la información». Así que este panel no resume — muestra las
// cuatro caras del renglón completas, cada una con su encabezado, y dice
// explícitamente cuál falta en vez de dejar el hueco mudo.
//
// El detalle se PIDE de nuevo al abrir aunque la fila ya venga con casi todo:
// la lista trae lo que entra en una tabla, y esto trae el resto —el documento,
// la foto, las entregas parciales de la misma receta—. Reutilizar la fila
// mostraría un panel que parece completo y no lo está.
// ═══════════════════════════════════════════════════════════════════════════

const fmtFecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '—');

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));

const money = (v) => (v === null || v === undefined ? '—' : formatMoney(v));

/** Una sección del expediente. Cinco iguales se leen; cinco distintas, no. */
function Seccion({ icon: Icono, titulo, children, aviso }) {
    return (
        <section data-surface="card" className="p-4 space-y-3">
            <header className="flex items-center gap-2">
                <span className="grid place-items-center size-7 rounded-btn bg-brand/10 text-brand-text shrink-0">
                    <Icono size={14} />
                </span>
                <h4 className="text-body-sm font-black uppercase tracking-widest text-content-3">{titulo}</h4>
            </header>
            {aviso}
            {children}
        </section>
    );
}

/** Un dato con su etiqueta. `mono` para lo que se lee dígito a dígito. */
function Dato({ label, children, mono = false, ancho = false }) {
    return (
        <div className={ancho ? 'col-span-2' : ''}>
            <p className="text-label font-bold uppercase tracking-widest text-content-3">{label}</p>
            <p className={`text-body-sm font-bold text-content-2 break-words ${mono ? 'tabular-nums' : ''}`}>
                {children ?? '—'}
            </p>
        </div>
    );
}

export default function DetalleDeFolio({ renglon }) {
    const { hasPermission } = useAuth();
    const puedeVerMontos = hasPermission('bitacoras', 'can_view');

    const [detalle, setDetalle] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [abriendo, setAbriendo] = useState(false);

    useEffect(() => {
        let vivo = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- pide el folio completo al abrir el panel
        setCargando(true);
        setError(null);
        fetchFolio(renglon.branch_id ?? renglon.branchId, renglon.anio, renglon.folio)
            .then(({ renglon: d, error: err }) => {
                if (!vivo) return;
                if (err) setError(err.message || 'No se pudo cargar el folio.');
                setDetalle(d);
                setCargando(false);
            });
        return () => { vivo = false; };
    }, [renglon]);

    const abrirComprobante = useCallback(async () => {
        if (!detalle?.venta?.pdf_path) return;
        setAbriendo(true);
        // `openStoredFile` firma la URL al vuelo: en la base vive la URL
        // formato-public como identificador, nunca una firmada — esa expira.
        await openStoredFile(detalle.venta.pdf_path);
        setAbriendo(false);
    }, [detalle]);

    if (cargando) return <LoadingState label="Abriendo el folio…" />;

    if (error || !detalle) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error || 'Ese folio no existe en esta sucursal.'}
            </Notice>
        );
    }

    const { producto, venta, receta } = detalle;
    const est = ESTADO_RENGLON[detalle.estado] || ESTADO_RENGLON.pendiente;
    const vencidoAlVender = producto?.vence && detalle.fecha && producto.vence < detalle.fecha;

    return (
        <div className="space-y-4">
            {/* La cabecera dice QUÉ es este renglón antes que nada: el folio, su
                estado y la fecha. Es lo que se compara contra el papel. */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-title font-black tabular-nums text-content">{detalle.folio_txt}</span>
                <Badge variant={est.variant} size="md" uppercase={false}>{est.label}</Badge>
                {vencidoAlVender && <Badge variant="danger" size="md" uppercase={false}>Lote vencido al dispensar</Badge>}
                <span className="text-body-sm text-content-3">
                    {detalle.sucursal} · {fmtFecha(detalle.fecha)}
                    {detalle.hora ? ` · ${String(detalle.hora).slice(0, 5)}` : ''}
                </span>
            </div>

            {detalle.estado === 'anulada' && (
                <Notice variant="neutral">
                    <span className="font-bold">Este renglón está anulado.</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        El documento de venta fue invalidado ante Hacienda. El renglón NO se borra:
                        un libro foliado anota, no borra — y la norma pide registrar las devoluciones.
                    </span>
                </Notice>
            )}

            {vencidoAlVender && (
                <Notice variant="danger" icon={AlertTriangle}>
                    <span className="font-bold">El lote ya estaba vencido el día que se dispensó.</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Venció el {fmtFecha(producto.vence)} y se entregó el {fmtFecha(detalle.fecha)}.
                        Es un hallazgo crítico en una inspección: hay que revisar ese lote en existencia.
                    </span>
                </Notice>
            )}

            <Seccion icon={Package} titulo="Medicamento">
                <p className="text-body font-black text-content">{producto?.nombre}</p>
                <div className="grid grid-cols-2 gap-3">
                    <Dato label="Laboratorio">{producto?.laboratorio}</Dato>
                    <Dato label="Presentación">{producto?.presentacion}</Dato>
                    <Dato label="Cantidad entregada" mono>{num(producto?.cantidad)}</Dato>
                    <Dato label="Lote" mono>{producto?.lote}</Dato>
                    <Dato label="Vence" mono>
                        <span className={vencidoAlVender ? 'text-danger-text' : ''}>{fmtFecha(producto?.vence)}</span>
                    </Dato>
                </div>
            </Seccion>

            <Seccion icon={Store} titulo="La venta">
                <div className="grid grid-cols-2 gap-3">
                    <Dato label="Documento" mono>{venta?.correlativo}</Dato>
                    <Dato label="Tipo">{venta?.tipo_documento}</Dato>
                    <Dato label="Cliente" ancho>{venta?.cliente}</Dato>
                    <Dato label="Vendió">{venta?.vendedor}</Dato>
                    {puedeVerMontos && <Dato label="Total del documento" mono>{money(venta?.total)}</Dato>}
                    <Dato label="Código de generación" mono ancho>{venta?.codigo_generacion}</Dato>
                </div>
                {venta?.pdf_path ? (
                    <Button variant="secondary" size="sm" icon={FileText}
                        onClick={abrirComprobante} loading={abriendo}>
                        Ver el comprobante
                    </Button>
                ) : (
                    <Notice variant="info" compact>
                        El comprobante de esta venta todavía no está archivado.
                    </Notice>
                )}
            </Seccion>

            <Seccion icon={User} titulo="Paciente y receta"
                aviso={!receta && detalle.estado !== 'anulada' && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <span className="font-bold">Todavía no se ligó a una receta.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Falta el paciente, el médico y la foto de la receta — que es lo único
                            que no sale de la venta.
                        </span>
                    </Notice>
                )}>
                {receta ? (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <Dato label="N.º de receta" mono>{receta.correlativo_txt}</Dato>
                            <Dato label="Prescrita el">{fmtFecha(receta.fecha_prescripcion)}</Dato>
                            <Dato label="Paciente" ancho>{receta.paciente?.nombre}</Dato>
                            <Dato label="Edad" mono>{receta.paciente?.edad}</Dato>
                            <Dato label="Documento" mono>{receta.paciente?.documento}</Dato>
                        </div>

                        {/* Parcial o total NO es una casilla: es cuánto queda.
                            Por eso se muestra la resta y no un rótulo. */}
                        <div data-surface="card" data-tono={Number(receta.pendiente) > 0 ? 'warning' : 'success'}
                            className="p-3 space-y-2">
                            <p className="text-body-sm font-black text-content">
                                {Number(receta.pendiente) > 0
                                    ? `Dispensación parcial — faltan ${num(receta.pendiente)} de ${num(receta.prescrito?.cantidad_prescrita)}`
                                    : `Dispensación total — se entregó todo lo prescrito (${num(receta.prescrito?.cantidad_prescrita)})`}
                            </p>
                            {(receta.entregas || []).length > 1 && (
                                <ul className="space-y-1">
                                    {receta.entregas.map((e) => (
                                        <li key={e.folio_txt} className="text-label text-content-2 tabular-nums">
                                            Folio {e.folio_txt} · {fmtFecha(e.fecha)} · {num(e.cantidad)}
                                            {e.lote ? ` · lote ${e.lote}` : ''}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {receta.motivo_pendiente === 'agotamiento_inventario' && (
                                <p className="text-label text-content-3">
                                    Pendiente por agotamiento de inventario — la copia de la receta queda retenida.
                                </p>
                            )}
                        </div>

                        {receta.foto_url ? (
                            <Button variant="secondary" size="sm" icon={Camera}
                                onClick={() => openStoredFile(receta.foto_url)}>
                                Ver la receta
                            </Button>
                        ) : (
                            <Notice variant="warning" compact icon={Camera}>
                                Falta adjuntar la foto de la receta.
                            </Notice>
                        )}
                    </>
                ) : null}
            </Seccion>

            <Seccion icon={Stethoscope} titulo="Médico">
                {receta?.medico ? (
                    <div className="grid grid-cols-2 gap-3">
                        <Dato label="Nombre" ancho>{receta.medico.nombre}</Dato>
                        <Dato label="N.º de junta" mono>{receta.medico.numero_junta}</Dato>
                        <Dato label="Carrera">{receta.medico.carrera}</Dato>
                        <Dato label="Confirmado" ancho>
                            {receta.medico.verificado_at
                                ? 'Sí, contra el registro del Consejo Superior de Salud Pública'
                                : 'Se tomó de la receta, sin confirmar contra el registro'}
                        </Dato>
                    </div>
                ) : (
                    <p className="text-body-sm text-content-3">
                        Sin médico registrado todavía.
                    </p>
                )}
            </Seccion>

            {detalle.completada_por && (
                <p className="text-label text-content-3">
                    Completado por {detalle.completada_por}
                    {detalle.completada_at ? ` · ${new Date(detalle.completada_at).toLocaleString('es-SV')}` : ''}
                </p>
            )}
        </div>
    );
}
