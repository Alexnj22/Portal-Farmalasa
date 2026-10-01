import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    FileCheck2, RefreshCw, Loader2, Download, ExternalLink, Printer, Pencil, Undo2, Ban, RotateCcw, FileMinus,
} from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import PagosDelPedido from './PagosDelPedido';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import DevolucionModal from './DevolucionModal';
import CorreoDocumento from './CorreoDocumento';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import {
    fetchDocumento, fetchPagos, reintentarDocumento, descartarDocumento, mensajeDeDistribucion,
    corregirDocumentoSellado, anularVenta, reenviarInvalidacion, enviarContingencia,
    fetchPlazoInvalidacion,
} from '@nucleo/data/distribucion';
import { registrarEgreso } from '@nucleo/data/egreso';
import { descargarArchivo, abrirEnPestanaNueva } from '../../plataforma/descargas';
import { construirTicketHtml, conCodigosDibujados, ajustarAltoDePagina } from '@nucleo/utils/ticketPrint';
import {
    ticketDeVenta, imprimirTicketDeVenta, pdfDelDocumento, nombreDelPdf, urlConsultaPublica, jsonParaElCliente, leerDocumento,
} from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from './marca';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO, FORMA_PAGO } from './comun';
import EstadoHacienda from './EstadoHacienda';
import { useNavigate } from 'react-router-dom';
import { rutaVolverAVender } from './rutas';

// Un documento de Distribución con sus dos papeles a la vista: el TICKET (lo
// que sale por la ticketera) y el PDF (la representación gráfica del DTE).
// Los dos se arman del JSON firmado —ver `distribucionDocumento.js`—, así que
// lo que se ve acá es exactamente lo que se imprime.
//
// ── Corregir ───────────────────────────────────────────────────────────────
// Un documento es un hecho fiscal y no se edita. Lo que sí se puede:
//   · si NUNCA llegó a Hacienda (sin firma, por enviar): «Corregir» lo retira
//     —el servidor le pregunta a Hacienda antes— y el pedido vuelve a
//     «Por facturar» para cambiarle lo que haga falta y facturarlo de nuevo;
//   · si Hacienda lo RECHAZÓ: el pedido ya quedó libre, se corrige igual;
//   · si tiene SELLO: «Corregir» abre un pedido NUEVO con lo mismo; al
//     facturarlo, el servidor invalida el original citando al nuevo (CAT-024
//     tipo 1). «Deshacer la venta» lo invalida sin reemplazo (tipo 2) y el
//     pedido queda anulado. La invalidación sale cuando Hacienda ya conoce al
//     reemplazo; mientras tanto queda «pendiente» y se ve acá.

const VISTAS = [
    // Lo vendido como INFORMACIÓN, no como papel (pedido del usuario,
    // 2026-09-30: «¿dónde puedo ver lo que vendí? no en ticket ni PDF»).
    { value: 'detalle', label: 'Detalle' },
    { value: 'ticket', label: 'Ticket' },
    { value: 'pdf', label: 'PDF' },
    { value: 'datos', label: 'Datos' },
];

const nombreForma = (f) => (f === '13' ? 'A crédito' : FORMA_PAGO.find(x => x.value === f)?.label ?? f);

/** Una fila rótulo · valor del detalle. */
function Fila({ rotulo, valor, fuerte = false, tono = '' }) {
    return (
        <div className={`flex items-baseline justify-between gap-3 ${fuerte ? 'pt-2 mt-1 border-t border-divider' : ''}`}>
            <span className={fuerte ? 'text-body font-black text-content' : 'text-caption text-content-3'}>{rotulo}</span>
            <span className={`tabular-nums ${fuerte ? 'text-title font-black text-brand-text' : `text-body-sm font-bold ${tono || 'text-content-2'}`}`}>{valor}</span>
        </div>
    );
}

/** Lo vendido, leído del mismo JSON del documento: productos, totales y cómo se pagó. */
function VistaDetalle({ dte, pagos }) {
    const d = leerDocumento(dte);
    const r = d.resumen;
    return (
        <div className="flex flex-col gap-4" data-testid="detalle-venta">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-body-sm">
                <div><dt className="text-caption text-content-3">Cliente</dt><dd className="font-bold text-content-2">{d.receptor.nombre}</dd></div>
                <div><dt className="text-caption text-content-3">Documento</dt><dd className="text-content-2">{d.receptor.documento || '—'}</dd></div>
                <div><dt className="text-caption text-content-3">Fecha</dt><dd className="text-content-2">{d.fecha} · {d.hora}</dd></div>
                <div><dt className="text-caption text-content-3">Condición</dt><dd className="text-content-2">{d.condicion ?? 'Contado'}</dd></div>
            </dl>
            <div data-surface="card" className="overflow-hidden">
                <div className="hidden sm:grid grid-cols-[3.5rem_minmax(0,1fr)_6rem_6rem] gap-3 px-3 py-2 border-b border-divider text-micro font-bold uppercase tracking-wide text-content-3">
                    <span className="text-right">Cant.</span><span>Producto</span><span className="text-right">P. unit.</span><span className="text-right">Importe</span>
                </div>
                {d.renglones.map(x => (
                    <div key={x.n} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] sm:grid-cols-[3.5rem_minmax(0,1fr)_6rem_6rem] gap-3 px-3 py-2 border-b border-divider last:border-b-0 items-baseline">
                        <span className="text-right font-black text-content tabular-nums">{x.cantidad}</span>
                        <span className="min-w-0">
                            <span className="block text-body-sm font-bold text-content-2">{x.descripcion}</span>
                            <span className="block text-caption text-content-3">
                                {[x.unidad, x.lote && `Lote ${x.lote}`, x.vence && `vence ${x.vence}`, x.descuento > 0 && `descuento ${formatMoney(x.descuento)}`].filter(Boolean).join(' · ')}
                                <span className="sm:hidden"> · {formatMoney(x.precio)} c/u</span>
                            </span>
                        </span>
                        <span className="hidden sm:block text-right text-body-sm tabular-nums text-content-2">{formatMoney(x.precio)}</span>
                        <span className="text-right font-black tabular-nums text-content">{formatMoney(x.gravada + x.exenta + x.noSujeta)}</span>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                    <p className="text-micro font-bold uppercase tracking-wide text-content-3">Pago</p>
                    {pagos == null && <p className="text-caption text-content-3">Cargando…</p>}
                    {pagos?.length === 0 && <p className="text-caption text-content-3">Sin pagos registrados.</p>}
                    {(pagos ?? []).map(p => {
                        const recibido = p.forma === '01' && p.efectivo_recibido != null ? Number(p.efectivo_recibido) : null;
                        return (
                            <div key={p.id} className="flex flex-col gap-1">
                                <Fila rotulo={nombreForma(p.forma)} valor={formatMoney(p.monto)} />
                                {recibido != null && recibido > Number(p.monto) && (<>
                                    <Fila rotulo="Recibido" valor={formatMoney(recibido)} />
                                    <Fila rotulo="Cambio" valor={formatMoney(recibido - Number(p.monto))} tono="text-success-text" />
                                </>)}
                                {p.referencia && <p className="text-caption text-content-3">Ref. {p.referencia}</p>}
                            </div>
                        );
                    })}
                </div>
                <div className="flex flex-col gap-1.5">
                    <p className="text-micro font-bold uppercase tracking-wide text-content-3">Totales</p>
                    {!r.ivaIncluido && <Fila rotulo="Sumas (sin IVA)" valor={formatMoney(r.subTotal)} />}
                    {r.descuento > 0 && <Fila rotulo="Descuentos (ya aplicados)" valor={formatMoney(r.descuento)} tono="text-success-text" />}
                    {!r.ivaIncluido && <Fila rotulo="IVA 13%" valor={formatMoney(r.iva)} />}
                    {r.percepcion > 0 && <Fila rotulo="(+) IVA percibido" valor={formatMoney(r.percepcion)} />}
                    {r.retencion > 0 && <Fila rotulo="(−) IVA retenido" valor={`−${formatMoney(r.retencion)}`} />}
                    <Fila rotulo="Total" valor={formatMoney(r.total)} fuerte />
                    {r.ivaIncluido && <p className="text-micro text-content-3 text-right">IVA incluido: {formatMoney(r.iva)}</p>}
                </div>
            </div>
        </div>
    );
}

function VistaTicket({ dte, pagos }) {
    const marco = useRef(null);
    const [html, setHtml] = useState('');
    const [alto, setAlto] = useState(600);
    useEffect(() => {
        let vivo = true;
        conCodigosDibujados(ticketDeVenta(dte, MARCA_PAPEL, { pagos }))
            .then(t => { if (vivo) setHtml(construirTicketHtml(t)); })
            .catch(e => console.error('VistaTicket', e));
        return () => { vivo = false; };
    }, [dte, pagos]);
    if (!html) return <p className="text-caption text-content-3">Armando el ticket…</p>;
    return (
        <div className="flex justify-center overflow-auto max-h-[60vh]">
            {/* Sin radio ni fondo del tema: es papel (IMPRESION-EN-TICKETERA §5). */}
            <div className="border border-border-card inline-block overflow-hidden">
                <iframe ref={marco} title="Vista previa del ticket" srcDoc={html} className="block border-0"
                    style={{ width: '80mm', height: `${alto}px` }}
                    onLoad={() => {
                        const mm = ajustarAltoDePagina(marco.current);
                        if (mm) setAlto(Math.ceil((mm / 25.4) * 96));
                    }} />
            </div>
        </div>
    );
}

function VistaPdf({ url, error }) {
    if (error) return <Notice variant="danger" compact>{error}</Notice>;
    if (!url) return <p className="text-caption text-content-3">Armando el PDF…</p>;
    return <iframe title="Documento en PDF" src={url} className="block w-full h-[60vh] border border-border-card" />;
}

// El plazo para invalidar, dicho antes de que alguien lo intente. Los estados
// salen de `dist_plazo_invalidacion` (borrador 0028).
function AvisoPlazo({ plazo, tipo }) {
    const limite = fechaNumerica(plazo.limite);
    if (plazo.estado === 'vencido') {
        return (
            <Notice variant="danger" compact data-plazo="vencido">
                Venció el plazo para invalidarlo ({limite}).{tipo === '03'
                    ? ' Si hay que corregirlo, usa «Devolución»: emite una nota de crédito.'
                    : ' Ya no se puede corregir ni deshacer ante Hacienda.'}
            </Notice>
        );
    }
    if (plazo.estado === 'gracia') {
        return (
            <Notice variant="warning" compact data-plazo="gracia">
                El plazo para invalidarlo era el {limite}. Puede que Hacienda todavía lo acepte si hubo asuetos; si lo rechaza, corrige con nota de crédito.
            </Notice>
        );
    }
    if (plazo.estado === 'medicamentos') {
        return (
            <Notice variant="warning" compact data-plazo="medicamentos">
                Pasaron los 3 meses para invalidar una factura ({limite}). Sólo se puede si la venta es de medicamentos, hasta el {fechaNumerica(plazo.limite_medicamentos)}.
            </Notice>
        );
    }
    return (
        <p className={`text-caption ${plazo.dias <= 3 ? 'text-warning-text font-bold' : 'text-content-3'}`} data-plazo="vigente">
            Se puede corregir o deshacer ante Hacienda hasta el {limite}{plazo.dias <= 3 ? ` · quedan ${plazo.dias === 0 ? 'horas' : `${plazo.dias} día${plazo.dias === 1 ? '' : 's'}`}` : ''}.
        </p>
    );
}

export default function DocumentoModal({ id, puedeVender, imprimirAlAbrir = false, onClose, onCambio, onCorregirPedido }) {
    const navigate = useNavigate();
    const showToast = useToastStore(s => s.showToast);
    const [d, setD] = useState(null);
    const [vista, setVista] = useState('detalle');
    const [pagos, setPagos] = useState(null);   // de `dist_pagos`: el ticket dice lo entregado y el cambio
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);
    const [pdf, setPdf] = useState({ blob: null, url: null, error: null });
    const [deshaciendo, setDeshaciendo] = useState(false);
    const [devolviendo, setDevolviendo] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [plazo, setPlazo] = useState(null);   // hasta cuándo se puede invalidar (sólo sellados)
    const yaImprimio = useRef(false);

    const cargar = useCallback(() => {
        fetchDocumento(id)
            .then(doc => {
                setD(doc);
                if (!doc?.pedido_id) { setPagos([]); return; }
                fetchPagos(doc.pedido_id).then(setPagos).catch(e => { console.error('DocumentoModal: pagos', e); setPagos([]); });
            })
            .catch(e => setError(mensajeDeDistribucion(e)));
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);
    const estadoDoc = d?.estado;
    useEffect(() => {
        if (estadoDoc !== 'sellado') return undefined;
        let vivo = true;
        fetchPlazoInvalidacion(id)
            .then(p => { if (vivo) setPlazo(p); })
            .catch(e => console.error('DocumentoModal: plazo de invalidación', e));
        return () => { vivo = false; };
    }, [id, estadoDoc]);

    const imprimirTicket = useCallback(async (doc) => {
        const r = await imprimirTicketDeVenta(doc, MARCA_PAPEL, { pagos: pagos ?? [] });
        useStaff.getState().appendAuditLog('DISTRIBUCION_TICKET_IMPRESO', String(doc.id), { ok: r?.ok !== false });
        if (r && r.ok === false) showToast('No se pudo imprimir el ticket', r.detalle ?? '', 'error');
    }, [showToast, pagos]);

    // Recién facturado con «imprimir»: el ticket sale solo, una vez — cuando ya
    // llegaron los pagos, para que salga con lo entregado y el cambio.
    useEffect(() => {
        if (!d?.json?.identificacion || pagos == null || !imprimirAlAbrir || yaImprimio.current) return;
        yaImprimio.current = true;
        imprimirTicket(d);
    }, [d, pagos, imprimirAlAbrir, imprimirTicket]);

    // El PDF se arma cuando se pide (pdfmake llega por `import()`), y se
    // rehace si cambia el documento (por ejemplo, al recibir el sello).
    const selloVisto = d?.sello_recibido ?? null;
    useEffect(() => {
        if (vista !== 'pdf' || !d?.json?.identificacion) return undefined;
        let vivo = true;
        let url = null;
        setPdf({ blob: null, url: null, error: null });
        pdfDelDocumento(d, MARCA_PAPEL)
            .then(blob => { if (!vivo) return; url = URL.createObjectURL(blob); setPdf({ blob, url, error: null }); })
            .catch(e => { if (vivo) setPdf({ blob: null, url: null, error: `No se pudo armar el PDF: ${e.message}` }); });
        return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
    }, [vista, d?.id, selloVisto]); // eslint-disable-line react-hooks/exhaustive-deps

    const accion = async (clave, fn, auditoria) => {
        setOcupado(clave);
        setError('');
        try {
            const r = await fn();
            useStaff.getState().appendAuditLog(auditoria, String(id), { estado: r?.estado });
            showToast(ESTADO_DOCUMENTO[r?.estado]?.label ?? 'Listo', r?.aviso ?? r?.mensaje ?? '', r?.estado === 'sellado' ? 'success' : 'warning');
            return r;
        } catch (e) {
            setError(mensajeDeDistribucion(e));
            return null;
        } finally {
            setOcupado(null);
        }
    };

    const reintentar = async () => {
        await accion('reintentar', () => reintentarDocumento(id), 'DISTRIBUCION_DTE_REINTENTO');
        cargar();
        onCambio?.();
    };

    const corregir = async () => {
        if (d.estado === 'rechazado') { onCorregirPedido?.(d.pedido_id); return; }
        if (d.estado === 'sellado') {
            const r = await accion('corregir', () => corregirDocumentoSellado(id), 'DISTRIBUCION_CORRECCION_ABIERTA');
            if (r?.pedido_id) onCorregirPedido?.(r.pedido_id);
            return;
        }
        const r = await accion('corregir', () => descartarDocumento(id), 'DISTRIBUCION_DTE_DESCARTADO');
        if (r?.estado === 'descartado') onCorregirPedido?.(d.pedido_id);
        else { cargar(); onCambio?.(); }
    };

    const deshacer = async () => {
        await accion('deshacer', () => anularVenta(id, motivo), 'DISTRIBUCION_VENTA_DESHECHA');
        setDeshaciendo(false);
        cargar();
        onCambio?.();
    };
    const avisoContingencia = async () => {
        setOcupado('contingencia');
        setError('');
        try {
            const r = await enviarContingencia();
            useStaff.getState().appendAuditLog('DISTRIBUCION_CONTINGENCIA_AVISO', String(id), { avisos: r?.avisos?.length ?? 0, sellados: r?.sellados });
            const rechazado = (r?.avisos ?? []).find(a => a.estado === 'rechazado');
            if (rechazado) showToast('Hacienda rechazó el aviso de contingencia', rechazado.mensaje ?? '', 'error');
            else showToast('Aviso de contingencia enviado', `${r?.sellados ?? 0} sellados · ${r?.pendientes ?? 0} pendientes · ${r?.rechazados ?? 0} rechazados`, 'success');
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(null);
            cargar();
            onCambio?.();
        }
    };
    const reenviarInv = async () => {
        await accion('invalidacion', () => reenviarInvalidacion(id), 'DISTRIBUCION_INVALIDACION_REENVIO');
        cargar();
        onCambio?.();
    };

    const descargarJson = () => {
        descargarArchivo(new Blob([JSON.stringify(jsonParaElCliente(d), null, 2)], { type: 'application/json' }),
            `${String(d.codigo_generacion).toUpperCase()}.json`);
        registrarEgreso('distribucion', { formato: 'json', filas: 1, detalle: { dte_id: d.id, numero_control: d.numero_control } });
    };
    const descargarPdf = () => {
        if (!pdf.blob) return;
        descargarArchivo(pdf.blob, nombreDelPdf(d));
        registrarEgreso('distribucion', { formato: 'pdf', filas: 1, detalle: { dte_id: d.id, numero_control: d.numero_control } });
    };

    const est = d ? ESTADO_DOCUMENTO[d.estado] : null;
    const sinSello = d && ['sin_firmar', 'firmado', 'contingencia'].includes(d.estado);
    const conArchivo = !!d?.json?.identificacion;
    const invalidando = d?.invalidacion_estado === 'pendiente' || d?.invalidacion_estado === 'procesada';
    // Pasado el plazo, Hacienda no sella el evento: ni «Corregir» (que invalida
    // el sellado) ni «Deshacer» sirven. Queda la Nota de Crédito.
    const vencido = d?.estado === 'sellado' && plazo?.estado === 'vencido';
    const puedeCorregir = puedeVender && d?.pedido_id && (sinSello || d.estado === 'rechazado' || (d.estado === 'sellado' && !invalidando && !vencido));
    const puedeDeshacer = puedeVender && d?.estado === 'sellado' && !invalidando && !vencido;
    // Devolución parcial: Nota de Crédito, que sólo corrige un Crédito Fiscal (borrador 0017).
    const puedeDevolver = puedeVender && d?.tipo === '03' && d?.estado === 'sellado' && !invalidando;

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-3xl" ariaLabel="Documento">
            <LiquidModal.Header>
                <div className="flex items-start justify-between gap-4 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <FileCheck2 size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content truncate">
                                {d ? TIPO_DOCUMENTO[d.tipo]?.largo : 'Documento'}
                                {d && <span className="text-content-3 font-bold"> · {formatMoney(d.total_pagar)}</span>}
                            </h2>
                        </div>
                        {d && <p className="text-caption text-content-3 mt-1 truncate">{d.dist_clientes?.nombre} · {d.numero_control}</p>}
                    </div>
                    {est && <Badge variant={est.variant}>{est.label}</Badge>}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {!d && !error && <p className="text-caption text-content-3">Cargando…</p>}
                    {d && (<>
                        {d.ambiente === '00' && <Notice variant="info" compact>Documento de PRUEBA: no tiene validez fiscal.</Notice>}
                        {/* Lo primero: ¿está bien con Hacienda? Y si falta algo, el botón. */}
                        <EstadoHacienda documento={d} ocupado={ocupado} puedeActuar={puedeVender}
                            onReenviar={reintentar} onCorregir={corregir} onInvalidacion={reenviarInv} onContingencia={avisoContingencia} />

                        <SegmentedControl value={vista} onChange={setVista} options={VISTAS} />

                        {/* Sin el archivo del documento (datos de muestra sembrados a mano)
                            no hay qué pintar: se dice, en vez de reventar la vista entera. */}
                        {!conArchivo && vista !== 'datos' && (
                            <Notice variant="info" bloque>Este documento no tiene guardado su archivo: sólo se pueden ver sus datos.</Notice>
                        )}
                        {conArchivo && vista === 'detalle' && <VistaDetalle dte={d} pagos={pagos} />}
                        {conArchivo && vista === 'ticket' && <VistaTicket dte={d} pagos={pagos ?? []} />}
                        {conArchivo && vista === 'pdf' && <VistaPdf url={pdf.url} error={pdf.error} />}
                        {conArchivo && vista === 'detalle' && ['01', '03', '05'].includes(d.tipo) && d.estado !== 'invalidado' && (
                            <CorreoDocumento key={d.correo?.[0]?.enviado_at ?? d.id} dte={d} puedeEnviar={puedeVender} onEnviado={cargar} />
                        )}
                        {vista === 'datos' && (
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
                                <dt className="text-content-3">Número de control</dt>
                                <dd className="font-mono text-caption text-content-2 break-all">{d.numero_control}</dd>
                                <dt className="text-content-3">Código de generación</dt>
                                <dd className="font-mono text-caption text-content-2 break-all">{String(d.codigo_generacion).toUpperCase()}</dd>
                                <dt className="text-content-3">Sello de recepción</dt>
                                <dd className="font-mono text-caption text-content-2 break-all">{d.sello_recibido ?? '—'}</dd>
                                <dt className="text-content-3">Emitido</dt>
                                <dd className="text-content-2">{fechaTexto(d.fec_emi, { day: 'numeric', month: 'long', year: 'numeric' })}, {hora12(d.hor_emi)}</dd>
                                <dt className="text-content-3">Total</dt>
                                <dd className="font-black text-content tabular-nums">{formatMoney(d.total_pagar)}</dd>
                                {d.intentos > 0 && (<><dt className="text-content-3">Envíos a Hacienda</dt><dd className="text-content-2">{d.intentos}</dd></>)}
                            </dl>
                        )}
                        {d.estado === 'sellado' && !invalidando && plazo && <AvisoPlazo plazo={plazo} tipo={d.tipo} />}
                        {d.estado === 'sellado' && puedeVender && !invalidando && !vencido && (
                            <p className="text-caption text-content-3">
                                Con sello, «Corregir» emite un documento nuevo que reemplaza a éste, y éste se invalida ante Hacienda.
                                Si la venta no se hizo, usa «Deshacer la venta».
                                {d.tipo === '03'
                                    ? ' Si el cliente regresa sólo una parte, «Devolución» emite una nota de crédito por eso.'
                                    : ' A una Factura no se le hace nota de crédito: si el cliente regresa una parte, «Corregir» y deja sólo lo que se queda.'}
                            </p>
                        )}
                        {deshaciendo && (
                            <PortalInput label="¿Por qué se deshace la venta? (lo lee Hacienda)" name="motivo-invalidacion" value={motivo}
                                placeholder="Ej.: el cliente devolvió toda la mercadería" onChange={(e) => setMotivo(e.target.value)} />
                        )}
                        {vista === 'datos' && d.pedido_id && (
                            <PagosDelPedido pedidoId={d.pedido_id} puedeEditar={puedeVender} onCambio={onCambio} />
                        )}
                    </>)}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</Button>
                    {puedeVender && d?.pedido_id && (
                        <Button variant="secondary" icon={RotateCcw} onClick={() => navigate(rutaVolverAVender(d.pedido_id))}>Volver a vender</Button>
                    )}
                    {conArchivo && (vista === 'ticket' || vista === 'detalle') && (
                        <Button variant="secondary" icon={Printer} onClick={() => imprimirTicket(d)}>Imprimir ticket</Button>
                    )}
                    {conArchivo && vista === 'pdf' && (<>
                        <Button variant="secondary" icon={Download} disabled={!pdf.blob} onClick={descargarPdf}>Descargar PDF</Button>
                        <Button variant="secondary" icon={Printer} disabled={!pdf.url} onClick={() => abrirEnPestanaNueva(pdf.url)}>Abrir para imprimir</Button>
                    </>)}
                    {d && vista === 'datos' && (<>
                        <Button variant="secondary" icon={Download} onClick={descargarJson}>Archivo JSON</Button>
                        {d.estado === 'sellado' && (
                            <Button variant="secondary" icon={ExternalLink} onClick={() => abrirEnPestanaNueva(urlConsultaPublica(d))}>Ver en Hacienda</Button>
                        )}
                    </>)}
                    {puedeDevolver && !deshaciendo && (
                        <Button variant="secondary" icon={FileMinus} disabled={!!ocupado} onClick={() => setDevolviendo(true)}>Devolución</Button>
                    )}
                    {puedeDeshacer && !deshaciendo && (
                        <Button variant="secondary" tone="danger" icon={Ban} disabled={!!ocupado} onClick={() => setDeshaciendo(true)}>Deshacer la venta</Button>
                    )}
                    {deshaciendo && (
                        <Button variant="secondary" tone="danger" icon={ocupado === 'deshacer' ? Loader2 : Ban}
                            disabled={!!ocupado || !motivo.trim()} onClick={deshacer}>Invalidar ante Hacienda</Button>
                    )}
                    {/* Rechazado: el botón está en la tarjeta de Hacienda, arriba. */}
                    {puedeCorregir && d.estado !== 'rechazado' && (
                        <Button variant="secondary" icon={ocupado === 'corregir' ? Loader2 : (d.estado === 'rechazado' ? Pencil : Undo2)}
                            disabled={!!ocupado} onClick={corregir}>Corregir</Button>
                    )}
                </div>
            </LiquidModal.Footer>
            {devolviendo && (
                <DevolucionModal dteId={id} onClose={() => setDevolviendo(false)}
                    onEmitida={() => { setDevolviendo(false); cargar(); onCambio?.(); }} />
            )}
        </LiquidModal>
    );
}
