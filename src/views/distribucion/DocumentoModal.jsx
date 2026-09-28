import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    FileCheck2, RefreshCw, Loader2, Download, ExternalLink, Printer, Pencil, Undo2, Ban, RotateCcw,
} from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import PagosDelPedido from './PagosDelPedido';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import {
    fetchDocumento, reintentarDocumento, descartarDocumento, mensajeDeDistribucion,
    corregirDocumentoSellado, anularVenta, reenviarInvalidacion,
} from '@nucleo/data/distribucion';
import { registrarEgreso } from '@nucleo/data/egreso';
import { descargarArchivo, abrirEnPestanaNueva } from '../../plataforma/descargas';
import { construirTicketHtml, conCodigosDibujados, ajustarAltoDePagina } from '@nucleo/utils/ticketPrint';
import {
    ticketDeVenta, imprimirTicketDeVenta, pdfDelDocumento, nombreDelPdf, urlConsultaPublica, jsonParaElCliente,
} from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from './marca';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO } from './comun';
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
    { value: 'ticket', label: 'Ticket' },
    { value: 'pdf', label: 'PDF' },
    { value: 'datos', label: 'Datos' },
];

function VistaTicket({ dte }) {
    const marco = useRef(null);
    const [html, setHtml] = useState('');
    const [alto, setAlto] = useState(600);
    useEffect(() => {
        let vivo = true;
        conCodigosDibujados(ticketDeVenta(dte, MARCA_PAPEL))
            .then(t => { if (vivo) setHtml(construirTicketHtml(t)); })
            .catch(e => console.error('VistaTicket', e));
        return () => { vivo = false; };
    }, [dte]);
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

export default function DocumentoModal({ id, puedeVender, imprimirAlAbrir = false, onClose, onCambio, onCorregirPedido }) {
    const navigate = useNavigate();
    const showToast = useToastStore(s => s.showToast);
    const [d, setD] = useState(null);
    const [vista, setVista] = useState('ticket');
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);
    const [pdf, setPdf] = useState({ blob: null, url: null, error: null });
    const [deshaciendo, setDeshaciendo] = useState(false);
    const [motivo, setMotivo] = useState('');
    const yaImprimio = useRef(false);

    const cargar = useCallback(() => {
        fetchDocumento(id).then(setD).catch(e => setError(mensajeDeDistribucion(e)));
    }, [id]);
    useEffect(() => { cargar(); }, [cargar]);

    const imprimirTicket = useCallback(async (doc) => {
        const r = await imprimirTicketDeVenta(doc, MARCA_PAPEL);
        useStaff.getState().appendAuditLog('DISTRIBUCION_TICKET_IMPRESO', String(doc.id), { ok: r?.ok !== false });
        if (r && r.ok === false) showToast('No se pudo imprimir el ticket', r.detalle ?? '', 'error');
    }, [showToast]);

    // Recién facturado con «imprimir»: el ticket sale solo, una vez.
    useEffect(() => {
        if (!d || !imprimirAlAbrir || yaImprimio.current) return;
        yaImprimio.current = true;
        imprimirTicket(d);
    }, [d, imprimirAlAbrir, imprimirTicket]);

    // El PDF se arma cuando se pide (pdfmake llega por `import()`), y se
    // rehace si cambia el documento (por ejemplo, al recibir el sello).
    const selloVisto = d?.sello_recibido ?? null;
    useEffect(() => {
        if (vista !== 'pdf' || !d) return undefined;
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
    const puedeReintentar = puedeVender && d && ['sin_firmar', 'firmado'].includes(d.estado);
    const invalidando = d?.invalidacion_estado === 'pendiente' || d?.invalidacion_estado === 'procesada';
    const puedeCorregir = puedeVender && d?.pedido_id && (sinSello || d.estado === 'rechazado' || (d.estado === 'sellado' && !invalidando));
    const puedeDeshacer = puedeVender && d?.estado === 'sellado' && !invalidando;
    const obs = d?.observaciones_mh ?? [];

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
                        {d.estado !== 'sellado' && (
                            <Notice variant={est.variant === 'danger' ? 'danger' : 'warning'} compact>
                                {est.ayuda}{d.descripcion_msg ? ` Hacienda: «${d.descripcion_msg}».` : ''}
                            </Notice>
                        )}
                        {obs.length > 0 && (
                            <div className="rounded-xl border border-divider px-4 py-3">
                                <p className="text-caption font-bold text-content-2 mb-1">Observaciones de Hacienda</p>
                                <ul className="list-disc pl-4 text-caption text-content-2 space-y-0.5">
                                    {obs.map((o, i) => <li key={i}>{o}</li>)}
                                </ul>
                            </div>
                        )}

                        <SegmentedControl value={vista} onChange={setVista} options={VISTAS} />

                        {vista === 'ticket' && <VistaTicket dte={d} />}
                        {vista === 'pdf' && <VistaPdf url={pdf.url} error={pdf.error} />}
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
                        {d.invalidacion_estado === 'pendiente' && (
                            <Notice variant="warning" compact>
                                Invalidación firmada y pendiente de enviar a Hacienda
                                {d.reemplazo_id ? ': sale cuando el documento que lo reemplaza tenga sello.' : '.'}
                            </Notice>
                        )}
                        {d.invalidacion_estado === 'rechazada' && (
                            <Notice variant="danger" compact>Hacienda rechazó la invalidación. Revisa el motivo en «Datos» y vuelve a enviarla.</Notice>
                        )}
                        {d.estado === 'sellado' && puedeVender && !invalidando && (
                            <p className="text-caption text-content-3">
                                Con sello, «Corregir» emite un documento nuevo que reemplaza a éste, y éste se invalida ante Hacienda.
                                Si la venta no se hizo, usa «Deshacer la venta».
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
                    {d && vista === 'ticket' && (
                        <Button variant="secondary" icon={Printer} onClick={() => imprimirTicket(d)}>Imprimir ticket</Button>
                    )}
                    {d && vista === 'pdf' && (<>
                        <Button variant="secondary" icon={Download} disabled={!pdf.blob} onClick={descargarPdf}>Descargar PDF</Button>
                        <Button variant="secondary" icon={Printer} disabled={!pdf.url} onClick={() => abrirEnPestanaNueva(pdf.url)}>Abrir para imprimir</Button>
                    </>)}
                    {d && vista === 'datos' && (<>
                        <Button variant="secondary" icon={Download} onClick={descargarJson}>Archivo JSON</Button>
                        {d.estado === 'sellado' && (
                            <Button variant="secondary" icon={ExternalLink} onClick={() => abrirEnPestanaNueva(urlConsultaPublica(d))}>Ver en Hacienda</Button>
                        )}
                    </>)}
                    {puedeDeshacer && !deshaciendo && (
                        <Button variant="secondary" tone="danger" icon={Ban} disabled={!!ocupado} onClick={() => setDeshaciendo(true)}>Deshacer la venta</Button>
                    )}
                    {deshaciendo && (
                        <Button variant="secondary" tone="danger" icon={ocupado === 'deshacer' ? Loader2 : Ban}
                            disabled={!!ocupado || !motivo.trim()} onClick={deshacer}>Invalidar ante Hacienda</Button>
                    )}
                    {puedeVender && ['pendiente', 'rechazada'].includes(d?.invalidacion_estado) && (
                        <Button variant="secondary" icon={ocupado === 'invalidacion' ? Loader2 : RefreshCw} disabled={!!ocupado} onClick={reenviarInv}>
                            Enviar invalidación
                        </Button>
                    )}
                    {puedeCorregir && (
                        <Button variant="secondary" icon={ocupado === 'corregir' ? Loader2 : (d.estado === 'rechazado' ? Pencil : Undo2)}
                            disabled={!!ocupado} onClick={corregir}>Corregir</Button>
                    )}
                    {puedeReintentar && (
                        <Button variant="primary" icon={ocupado === 'reintentar' ? Loader2 : RefreshCw} disabled={!!ocupado} onClick={reintentar}>
                            Enviar a Hacienda
                        </Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
