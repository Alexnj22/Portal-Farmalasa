import React, { useEffect, useRef, useState } from 'react';
import { Archive, AlertTriangle, Download, ExternalLink, FileText, Loader2, Receipt, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { getSignedFileUrl, downloadStoredFile } from '../../utils/storageFiles';
import { downloadPurchaseDtePackage, fetchPurchaseDteReviewSource } from '../../data/facturasCompra';
import { dteTypeLabel } from '../../utils/dteTypes';

const fmt$ = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// El visor nativo de PDF del navegador (dentro del <iframe>) no expone zoom
// propio de forma confiable: en el build nativo/PWA instalada, index.html fija
// user-scalable=no a nivel de página (a propósito, "feel de app nativa") — eso
// también neutraliza cualquier pinch-zoom dentro del iframe. Por eso el zoom
// se implementa acá, a mano, independiente del viewport global: botones
// +/-/reset, Ctrl+rueda en desktop, y gesto de pinch (2 dedos) en móvil vía
// listeners nativos no-pasivos (para poder preventDefault del scroll nativo
// durante el pinch). El iframe queda con pointer-events:none — sacrifica
// clicks/selección de texto dentro del PDF, aceptable para un visor de
// solo-lectura — así el contenedor recibe los gestos en vez del iframe.
const PdfZoomViewer = ({ src }) => {
    const containerRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const pinchRef = useRef(null);

    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_STEP));
    const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_STEP));
    const resetZoom = () => setZoom(1);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const distance = (touches) => Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );

        const onTouchStart = (e) => {
            if (e.touches.length === 2) {
                pinchRef.current = { startDist: distance(e.touches), startZoom: zoomRef.current };
            }
        };
        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchRef.current) {
                e.preventDefault();
                const ratio = distance(e.touches) / pinchRef.current.startDist;
                setZoom(clampZoom(pinchRef.current.startZoom * ratio));
            }
        };
        const onTouchEnd = (e) => {
            if (e.touches.length < 2) pinchRef.current = null;
        };
        const onWheel = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => clampZoom(e.deltaY < 0 ? z * 1.08 : z / 1.08));
        };

        // Safari/iOS dispara gesturestart/gesturechange/gestureend — un
        // mecanismo propio de WebKit para pinch, separado de los touch
        // events estándar, que puede ganarle a touch-action:none y disparar
        // el zoom NATIVO de toda la página en vez de solo este visor (el
        // pinch de arriba, vía touchmove, sigue siendo el que calcula el
        // zoom real — acá solo se bloquea la gesture nativa). No-op en
        // Chrome/Firefox, que no implementan estos eventos.
        const onGestureStart = (e) => e.preventDefault();
        const onGestureChange = (e) => e.preventDefault();

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('gesturestart', onGestureStart, { passive: false });
        el.addEventListener('gesturechange', onGestureChange, { passive: false });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('gesturestart', onGestureStart);
            el.removeEventListener('gesturechange', onGestureChange);
        };
    }, []);

    return (
        <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-0.5 rounded-[1rem] bg-surface-card-hover p-1">
                    <button
                        type="button"
                        onClick={zoomOut}
                        disabled={zoom <= ZOOM_MIN}
                        title="Alejar"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-content-2 hover:bg-white disabled:opacity-40 transition-colors"
                    >
                        <ZoomOut size={14} strokeWidth={2} />
                    </button>
                    <span className="w-11 text-center text-[10px] font-bold text-content-2 tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button
                        type="button"
                        onClick={zoomIn}
                        disabled={zoom >= ZOOM_MAX}
                        title="Acercar"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-content-2 hover:bg-white disabled:opacity-40 transition-colors"
                    >
                        <ZoomIn size={14} strokeWidth={2} />
                    </button>
                    {zoom !== 1 && (
                        <button
                            type="button"
                            onClick={resetZoom}
                            title="Restablecer zoom"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-content-3 hover:bg-white transition-colors"
                        >
                            <RotateCcw size={13} strokeWidth={2} />
                        </button>
                    )}
                </div>
                <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[10px] font-bold text-brand hover:text-brand-hover px-2.5 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                >
                    <ExternalLink size={12} /> Abrir en pestaña nueva
                </a>
            </div>
            <div
                ref={containerRef}
                className="flex-1 min-h-0 rounded-[1.5rem] border border-slate-200 bg-white shadow-sm overflow-auto"
                style={{ touchAction: zoom > 1 ? 'pan-x pan-y' : 'none' }}
            >
                <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minWidth: '100%', minHeight: '100%' }}>
                    {/* #toolbar=0&navpanes=0&scrollbar=0: el visor nativo de PDF del
                        navegador (Chrome/Edge) dibuja su propia barra de zoom encima
                        del PDF aunque el iframe tenga pointer-events:none (decorativa,
                        no clickeable, pero SE VE — "zoom duplicado" reportado por el
                        usuario). Este hash es el open-param estándar que ambos
                        respetan para ocultarla; no aplica al link "Abrir en pestaña
                        nueva" de abajo, donde sí conviene tener la barra nativa. */}
                    <iframe src={`${src}#toolbar=0&navpanes=0&scrollbar=0`} className="w-full h-full border-none pointer-events-none" title="Visor PDF" />
                </div>
            </div>
        </div>
    );
};

// Detalle de un DTE de compra: parsea el JSON crudo (esquema del Ministerio de
// Hacienda de El Salvador) y lo muestra como factura — encabezado/ítems/totales
// — en vez del texto crudo. Tab a "PDF" cuando el documento tiene uno asociado.
const FormPurchaseDteViewer = ({ formData }) => {
    const { document } = formData || {};
    const [tab, setTab] = useState('detalle');
    const [dte, setDte] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [downloadAllError, setDownloadAllError] = useState('');
    const [invalidacionSource, setInvalidacionSource] = useState(null);
    const [openingInvalidacionPdf, setOpeningInvalidacionPdf] = useState(false);

    const openInvalidacionPdf = async () => {
        if (!invalidacionSource?.file_path) return;
        setOpeningInvalidacionPdf(true);
        try {
            const url = await getSignedFileUrl(invalidacionSource.file_path);
            if (url) window.open(url, '_blank', 'noopener');
        } finally {
            setOpeningInvalidacionPdf(false);
        }
    };

    const downloadAll = async () => {
        setDownloadingAll(true);
        setDownloadAllError('');
        try {
            await downloadPurchaseDtePackage(document);
        } catch (e) {
            setDownloadAllError(e.message || 'No se pudo descargar el paquete');
        } finally {
            setDownloadingAll(false);
        }
    };

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const signedJsonUrl = await getSignedFileUrl(document?.json_path);
                if (!signedJsonUrl) throw new Error('URL no disponible');
                const res = await fetch(signedJsonUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (alive) setDte(json);
            } catch (e) {
                if (alive) setError(e.message);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [document?.json_path]);

    useEffect(() => {
        if (!document?.pdf_path) { setPdfUrl(null); return; }
        let alive = true;
        getSignedFileUrl(document.pdf_path).then((u) => { if (alive) setPdfUrl(u); });
        return () => { alive = false; };
    }, [document?.pdf_path]);

    // El PDF huérfano de Revisión que justificó marcar invalidado (ver
    // classify_purchase_dte_review) — sin esto, el aviso de anulación queda
    // sin rastro visible una vez que sale de Revisión (pedido del usuario
    // tras probar el caso real de Grupo Jamilu, 2026-07-22).
    useEffect(() => {
        if (!document?.invalidado || !document?.id) { setInvalidacionSource(null); return; }
        let alive = true;
        fetchPurchaseDteReviewSource(document.id).then((row) => { if (alive) setInvalidacionSource(row); }).catch(() => {});
        return () => { alive = false; };
    }, [document?.invalidado, document?.id]);

    const items = dte?.cuerpoDocumento || dte?.detalle || [];
    const resumen = dte?.resumen || {};

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-surface-card-hover/50">
            <div className="p-6 border-b border-slate-200 bg-white shrink-0 shadow-sm z-10">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-[1.25rem] bg-blue-50 text-brand flex items-center justify-center shadow-inner shrink-0">
                            <Receipt size={24} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg font-black text-content truncate">
                                {document?.supplier_nombre || document?.emisor_nombre || 'Documento'}
                            </h3>
                            <p className="text-[10px] font-bold text-content-2 uppercase tracking-widest mt-0.5 truncate">
                                {dteTypeLabel(document?.tipo_dte)} · {document?.numero_control || document?.codigo_generacion}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {document?.pdf_path && (
                            <div className="flex rounded-[1rem] bg-surface-card-hover p-1">
                                <button
                                    type="button"
                                    onClick={() => setTab('detalle')}
                                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${tab === 'detalle' ? 'bg-white shadow-sm text-content' : 'text-content-3'}`}
                                >
                                    Detalle
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTab('pdf')}
                                    className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${tab === 'pdf' ? 'bg-white shadow-sm text-content' : 'text-content-3'}`}
                                >
                                    PDF
                                </button>
                            </div>
                        )}
                        {document?.pdf_path && (
                            <button
                                type="button"
                                onClick={downloadAll}
                                disabled={downloadingAll}
                                title="Descargar PDF + JSON en un ZIP"
                                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-surface-card-hover text-content-2 rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all active:scale-[0.97] disabled:opacity-50"
                            >
                                <Archive size={14} strokeWidth={2} className={downloadingAll ? 'animate-pulse' : ''} />
                                {downloadingAll ? 'Armando ZIP…' : 'Todo'}
                            </button>
                        )}
                        {document?.pdf_path && (
                            <button
                                type="button"
                                onClick={() => downloadStoredFile(document.pdf_path, `${document.codigo_generacion}.pdf`)}
                                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-surface-card-hover text-content-2 rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all active:scale-[0.97]"
                            >
                                <Download size={14} strokeWidth={2} /> PDF
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => downloadStoredFile(document?.json_path, `${document?.codigo_generacion}.json`)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all active:scale-[0.97]"
                        >
                            <Download size={14} strokeWidth={2} /> JSON
                        </button>
                    </div>
                </div>
                {downloadAllError && (
                    <p className="mt-2 text-[10px] font-bold text-danger">{downloadAllError}</p>
                )}
                {document?.invalidado && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-[1rem] border border-red-500/25 bg-red-500/10 px-4 py-3">
                        <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" strokeWidth={2} />
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold text-red-700 leading-snug">
                                Este documento está invalidado
                                {document.invalidado_motivo ? `: ${document.invalidado_motivo}` : ''}
                                {document.invalidado_at ? ` (${document.invalidado_at.slice(0, 10)})` : ''}.
                                No ampara deducciones ni crédito fiscal (Art. 119-E Código Tributario).
                            </p>
                            {invalidacionSource?.file_path && (
                                <button
                                    type="button"
                                    onClick={openInvalidacionPdf}
                                    disabled={openingInvalidacionPdf}
                                    className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-black text-red-700 hover:text-red-800 underline disabled:opacity-50"
                                >
                                    <ExternalLink size={11} strokeWidth={2} />
                                    {openingInvalidacionPdf ? 'Abriendo…' : 'Ver PDF de anulación'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* flex flex-col en vez de h-full puro en los hijos: un h-full/percentage
                dentro de un flex-item sin su propia altura explícita (flex-1 solo)
                no siempre resuelve como "definite" — se colapsaba al tamaño del
                contenido (confirmado con Playwright, caja del PDF ~130px en vez de
                llenar el modal). Encadenar flex-1/min-h-0 en cada nivel es robusto
                sin depender de esa resolución de porcentajes. */}
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-0">
                {tab === 'pdf' && pdfUrl ? (
                    <PdfZoomViewer src={pdfUrl} />
                ) : loading ? (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-content-3 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm">
                        <Loader2 size={32} className="animate-spin mb-3 text-brand" />
                        <p className="font-bold text-[11px] uppercase tracking-widest">Cargando detalle…</p>
                    </div>
                ) : error ? (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-content-3 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5} />
                        <p className="font-bold text-sm">No se pudo cargar el detalle ({error}).</p>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 w-full overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white shadow-sm p-6">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 pb-4 mb-4 border-b border-slate-100 text-[12px]">
                            <div><span className="text-content-3">Emisor: </span><span className="font-semibold text-content">{dte?.emisor?.nombre || document?.emisor_nombre || '—'}</span></div>
                            <div><span className="text-content-3">NIT / NRC: </span><span className="font-semibold text-content">{dte?.emisor?.nit || document?.emisor_nit || '—'} / {dte?.emisor?.nrc || document?.emisor_nrc || '—'}</span></div>
                            <div><span className="text-content-3">Receptor: </span><span className="font-semibold text-content">{dte?.receptor?.nombre || '—'}</span></div>
                            <div><span className="text-content-3">Fecha emisión: </span><span className="font-semibold text-content">{dte?.identificacion?.fecEmi || document?.fecha_emision || '—'}</span></div>
                        </div>

                        {items.length > 0 ? (
                            <div className="overflow-x-auto mb-4">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="border-b border-slate-200 text-content-3 font-semibold">
                                            <th className="text-left py-2">#</th>
                                            <th className="text-left py-2">Descripción</th>
                                            <th className="text-center py-2">Cant.</th>
                                            <th className="text-right py-2">P. Unit.</th>
                                            <th className="text-right py-2">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {items.map((it, i) => {
                                            const lineTotal = it.ventaGravada ?? it.ventaNoSuj ?? it.ventaExenta ?? ((it.cantidad || 0) * (it.precioUni || 0));
                                            return (
                                                <tr key={i}>
                                                    <td className="py-2 text-content-3 tabular-nums">{it.numItem ?? i + 1}</td>
                                                    <td className="py-2 text-content-2">{it.descripcion || '—'}</td>
                                                    <td className="py-2 text-center tabular-nums">{it.cantidad ?? '—'}</td>
                                                    <td className="py-2 text-right tabular-nums">{fmt$(it.precioUni)}</td>
                                                    <td className="py-2 text-right tabular-nums font-semibold">{fmt$(lineTotal)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-[11px] text-content-3 mb-4">Sin ítems detallados en el documento.</p>
                        )}

                        <div className="flex flex-col items-end gap-1 text-[12px] pt-3 border-t border-slate-100">
                            <div className="flex justify-between w-56"><span className="text-content-3">Subtotal</span><span className="tabular-nums">{fmt$(resumen.subTotal ?? resumen.totalGravada)}</span></div>
                            <div className="flex justify-between w-56"><span className="text-content-3">IVA</span><span className="tabular-nums">{fmt$(resumen.totalIva ?? document?.total_iva)}</span></div>
                            <div className="flex justify-between w-56 font-black text-content text-[13px]"><span>Total</span><span className="tabular-nums">{fmt$(resumen.totalPagar ?? resumen.montoTotalOperacion ?? document?.monto_total)}</span></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormPurchaseDteViewer;
