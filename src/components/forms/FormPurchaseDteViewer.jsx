import React, { useEffect, useState } from 'react';
import Button from '../common/Button';
import PdfZoomViewer from '../common/PdfZoomViewer';
import { Archive, AlertTriangle, Download, ExternalLink, FileText, Receipt } from 'lucide-react';
import { getSignedFileUrl, downloadStoredFile } from '../../utils/storageFiles';
import { useAuth } from '../../context/AuthContext';
import { downloadPurchaseDtePackage, fetchPurchaseDteReviewSources } from '../../data/facturasCompra';
import { dteTypeLabel } from '../../utils/dteTypes';
import SegmentedControl from '../common/SegmentedControl';
import { useToastStore } from '../../store/toastStore';
import { LoadingState } from '../common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ivaDelDte } from '../../utils/dteIva';

const fmt$ = (n) => formatMoney(n || 0);

// Detalle de un DTE de compra: parsea el JSON crudo (esquema del Ministerio de
// Hacienda de El Salvador) y lo muestra como factura — encabezado/ítems/totales
// — en vez del texto crudo. Tab a "PDF" cuando el documento tiene uno asociado.
const FormPurchaseDteViewer = ({ formData }) => {
    const { document } = formData || {};
    // Llegar acá ya exige `facturas_compra_abrir` (la vista es el único origen
    // del modal). Lo que falta chequear es lo OTRO: llevarse el archivo es un
    // permiso aparte, así que los tres botones de descarga del encabezado se
    // consultan acá y no se pasan por prop — UnifiedModal no reenvía nada más
    // que formData.
    const { hasPermission } = useAuth();
    const canDownload = hasPermission('facturas_compra_descargar');
    const [tab, setTab] = useState('detalle');
    const [dte, setDte] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [downloadingAll, setDownloadingAll] = useState(false);
    const [downloadAllError, setDownloadAllError] = useState('');
    // Una LISTA, no un archivo: una anulación puede venir con dos respaldos —el
    // PDF con el sello y el JSON del evento, que trae su propio sello de
    // recepción del Ministerio de Hacienda—. Mostrar sólo uno deja el otro sin
    // forma de abrirse, y ofrecerlos con el mismo rótulo los vuelve
    // indistinguibles justo cuando importa cuál es cuál.
    const [respaldos, setRespaldos] = useState([]);
    const [abriendoRespaldo, setAbriendoRespaldo] = useState(null);

    const abrirRespaldo = async (r) => {
        if (!r?.file_path) return;
        setAbriendoRespaldo(r.id ?? r.file_path);
        try {
            const url = await getSignedFileUrl(r.file_path);
            if (url) window.open(url, '_blank', 'noopener');
        } catch (e) {
            console.error('FormPurchaseDteViewer.jsx: ', e);
            useToastStore.getState().showToast('No se pudo abrir el archivo', 'El respaldo de la anulación no está disponible. Intenta de nuevo.', 'error');
        } finally {
            setAbriendoRespaldo(null);
        }
    };

    // El rótulo sale del `kind` de la fila, que es lo que la base sabe. Un
    // rótulo fijo mentía en cuanto el respaldo no era un PDF.
    const rotuloRespaldo = (r) => (
        r?.kind === 'invalidacion_pendiente' ? 'Ver el aviso de anulación (JSON)' : 'Ver el PDF de anulación'
    );

    const downloadAll = async () => {
        setDownloadingAll(true);
        setDownloadAllError('');
        try {
            await downloadPurchaseDtePackage(document);
        } catch (e) {
            setDownloadAllError(mensajeAmigable(e, 'No se pudo descargar el paquete'));
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
                if (alive) setError(mensajeAmigable(e));
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
    // H13 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): `get_purchase_dte_documents`
    // YA devuelve `invalidacion_source` en cada fila, así que pedirlo de nuevo
    // al abrir el modal era una ida al servidor por documento para traer algo
    // que el llamador tenía en la mano. El RPC queda solo de respaldo, para
    // cuando el modal se abre sin pasar por la lista (la fila no trae el campo).
    useEffect(() => {
        if (!document?.invalidado || !document?.id) { setRespaldos([]); return; }
        // La fila de la lista trae UN respaldo (el principal) — con eso se pinta
        // de una, sin parpadeo. Pero puede haber dos, y el listado sólo cabe en
        // el RPC, así que se pide igual. Es una llamada por documento anulado
        // abierto: cinco en todo el histórico, no la ruta caliente que la
        // optimización H13 buscaba evitar.
        setRespaldos(document.invalidacion_source ? [document.invalidacion_source] : []);
        let alive = true;
        fetchPurchaseDteReviewSources(document.id)
            .then((filas) => { if (alive && filas.length) setRespaldos(filas); })
            .catch(() => {});
        return () => { alive = false; };
    }, [document?.invalidado, document?.id, document?.invalidacion_source]);

    const items = dte?.cuerpoDocumento || dte?.detalle || [];
    const resumen = dte?.resumen || {};

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-surface-card-hover/50">
            <div className="p-4 md:p-6 border-b border-divider bg-surface-card shrink-0 shadow-sm z-base">
                {/* `flex-wrap` y `gap`: en el teléfono la identidad del documento y
                    sus cuatro controles no entran en una línea de 390px — el último
                    botón quedaba CORTADO contra el filo de la pantalla, o sea que
                    descargar el PDF era inalcanzable justo donde más se usa. Con el
                    quiebre, los controles bajan a su propio renglón. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 md:gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-chart-1/10 text-brand-text flex items-center justify-center shadow-inner shrink-0">
                            <Receipt size={24} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg font-black text-content truncate">
                                {document?.supplier_nombre || document?.emisor_nombre || 'Documento'}
                            </h3>
                            <p className="text-caption font-bold text-content-2 uppercase tracking-widest mt-0.5 truncate">
                                {dteTypeLabel(document?.tipo_dte)} · {document?.numero_control || document?.codigo_generacion}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {document?.pdf_path && (
                            <SegmentedControl
                                label="Vista del documento"
                                size="sm"
                                tone="neutro"
                                value={tab}
                                onChange={setTab}
                                options={[{ value: 'detalle', label: 'Detalle' }, { value: 'pdf', label: 'PDF' }]}
                            />
                        )}
                        {canDownload && document?.pdf_path && (
                            <Button variant="secondary" icon={Archive} disabled={downloadingAll} title="Descargar PDF + JSON en un ZIP" onClick={downloadAll}>{downloadingAll ? 'Armando ZIP…' : 'Todo'}</Button>
                        )}
                        {canDownload && document?.pdf_path && (
                            <Button variant="secondary" icon={Download} onClick={() => downloadStoredFile(document.pdf_path, `${document.codigo_generacion}.pdf`)}>PDF</Button>
                        )}
                        {canDownload && (
                            <Button icon={Download} onClick={() => downloadStoredFile(document?.json_path, `${document?.codigo_generacion}.json`)}>JSON</Button>
                        )}
                    </div>
                </div>
                {downloadAllError && (
                    <p className="mt-2 text-caption font-bold text-danger">{downloadAllError}</p>
                )}
                {document?.invalidado && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3">
                        <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" strokeWidth={2} />
                        <div className="min-w-0">
                            <p className="text-label font-bold text-danger-text leading-snug">
                                Este documento está invalidado
                                {document.invalidado_motivo ? `: ${document.invalidado_motivo}` : ''}
                                {document.invalidado_at ? ` (${document.invalidado_at.slice(0, 10)})` : ''}.
                                No ampara deducciones ni crédito fiscal (Art. 119-E Código Tributario).
                            </p>
                            {respaldos.filter((r) => r?.file_path).map((r) => (
                                <Button
                                    key={r.id ?? r.file_path}
                                    variant="ghost"
                                    icon={ExternalLink}
                                    disabled={abriendoRespaldo === (r.id ?? r.file_path)}
                                    onClick={() => abrirRespaldo(r)}
                                >
                                    {abriendoRespaldo === (r.id ?? r.file_path) ? 'Abriendo…' : rotuloRespaldo(r)}
                                </Button>
                            ))}
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
                    <LoadingState variant="content" label="Cargando el detalle…" className="flex-1 min-h-0" />
                ) : error ? (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-content-3 bg-surface-card rounded-3xl border border-divider shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5} />
                        <p className="font-bold text-sm">No se pudo cargar el detalle ({error}).</p>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 w-full overflow-y-auto rounded-3xl border border-divider bg-surface-card shadow-sm p-6">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 pb-4 mb-4 border-b border-divider text-body-sm">
                            <div><span className="text-content-3">Emisor: </span><span className="font-semibold text-content">{dte?.emisor?.nombre || document?.emisor_nombre || '—'}</span></div>
                            <div><span className="text-content-3">NIT / NRC: </span><span className="font-semibold text-content">{dte?.emisor?.nit || document?.emisor_nit || '—'} / {dte?.emisor?.nrc || document?.emisor_nrc || '—'}</span></div>
                            <div><span className="text-content-3">Receptor: </span><span className="font-semibold text-content">{dte?.receptor?.nombre || '—'}</span></div>
                            <div><span className="text-content-3">Fecha emisión: </span><span className="font-semibold text-content">{dte?.identificacion?.fecEmi || document?.fecha_emision || '—'}</span></div>
                        </div>

                        {items.length > 0 ? (
                            <div className="overflow-x-auto mb-4">
                                {/* `min-w-[440px]`: la tabla es `w-full` y sin un piso
                                    se aplastaba hasta que **Total** quedaba fuera del
                                    marco — y el total es el número por el que se abre
                                    una factura. Con el piso, la columna existe entera y
                                    el carril de este contenedor la alcanza. La tabla se
                                    queda escrita a mano a propósito: reproduce el
                                    documento fiscal del proveedor, no una lista de
                                    registros del portal (§32, excepción declarada en
                                    `mobile-gate`). */}
                                <table className="w-full min-w-[440px] text-label">
                                    <thead>
                                        <tr className="border-b border-divider text-content-3 font-semibold">
                                            <th className="text-left px-3 py-2 text-caption font-black uppercase tracking-wider text-content-3">#</th>
                                            <th className="text-left px-3 py-2 text-caption font-black uppercase tracking-wider text-content-3">Descripción</th>
                                            <th className="px-3 py-2 text-caption font-black uppercase tracking-wider text-content-3 text-center">Cant.</th>
                                            <th className="px-3 py-2 text-caption font-black uppercase tracking-wider text-content-3 text-right">P. Unit.</th>
                                            <th className="px-3 py-2 text-caption font-black uppercase tracking-wider text-content-3 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-divider">
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
                            <p className="text-label text-content-3 mb-4">Sin ítems detallados en el documento.</p>
                        )}

                        <div className="flex flex-col items-end gap-1 text-body-sm pt-3 border-t border-divider">
                            <div className="flex justify-between w-56"><span className="text-content-3">Subtotal</span><span className="tabular-nums">{fmt$(resumen.subTotal ?? resumen.totalGravada)}</span></div>
                            <div className="flex justify-between w-56"><span className="text-content-3">IVA</span><span className="tabular-nums">{fmt$(ivaDelDte(dte, document?.total_iva))}</span></div>
                            <div className="flex justify-between w-56 font-black text-content text-body"><span>Total</span><span className="tabular-nums">{fmt$(resumen.totalPagar ?? resumen.montoTotalOperacion ?? document?.monto_total)}</span></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormPurchaseDteViewer;
