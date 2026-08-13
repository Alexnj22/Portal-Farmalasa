import React, { useEffect, useState } from 'react';
import { Archive, AlertTriangle, Download, FileText, Receipt } from 'lucide-react';
import Button from '../common/Button';
import PdfZoomViewer from '../common/PdfZoomViewer';
import SegmentedControl from '../common/SegmentedControl';
import { LoadingState } from '../common/StateViews';
import { getSignedFileUrl, downloadStoredFile } from '../../utils/storageFiles';
import { descargarPaqueteDteVenta } from '../../data/librosIva';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ivaDelDte } from '../../utils/dteIva';

const fmt$ = (n) => formatMoney(n || 0);

// Detalle de un DTE de VENTA. Es el espejo del de compras y comparte con él el
// visor de PDF (`PdfZoomViewer`) y el esquema del JSON —los dos son documentos
// del Ministerio de Hacienda—, pero no el resto, y no por descuido:
//
//   · Acá el emisor somos NOSOTROS y el que importa es el RECEPTOR. En compras
//     es al revés. Reusar aquel encabezado pondría al frente el nombre de la
//     farmacia en las siete filas.
//   · El CCF (tipo 03) desglosa base + IVA; la factura de consumidor (01)
//     reporta el monto CON IVA adentro y manda `tributos` vacío. Con la misma
//     regla, ocho de diez documentos parecen no cuadrar — comprobado.
//   · Y lo que motiva el modal: `resumen.ivaRete1`, la retención, que en un
//     documento de compra no existe.
const FormSalesDteViewer = ({ formData }) => {
    const { document } = formData || {};
    const [tab, setTab] = useState('detalle');
    const [dte, setDte] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [bajandoTodo, setBajandoTodo] = useState(false);
    const [errorDescarga, setErrorDescarga] = useState('');

    useEffect(() => {
        if (!document?.json_path) { setLoading(false); setError('Este documento no tiene el JSON guardado.'); return; }
        let vivo = true;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const url = await getSignedFileUrl(document.json_path);
                if (!url) throw new Error('URL no disponible');
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (vivo) setDte(json);
            } catch (e) {
                if (vivo) setError(mensajeAmigable(e));
            } finally {
                if (vivo) setLoading(false);
            }
        })();
        return () => { vivo = false; };
    }, [document?.json_path]);

    useEffect(() => {
        if (!document?.pdf_path) { setPdfUrl(null); return; }
        let vivo = true;
        getSignedFileUrl(document.pdf_path).then(u => { if (vivo) setPdfUrl(u); });
        return () => { vivo = false; };
    }, [document?.pdf_path]);

    const bajarTodo = async () => {
        setBajandoTodo(true);
        setErrorDescarga('');
        try { await descargarPaqueteDteVenta(document); }
        catch (e) { setErrorDescarga(mensajeAmigable(e, 'No se pudo descargar el paquete')); }
        finally { setBajandoTodo(false); }
    };

    const items   = dte?.cuerpoDocumento || [];
    const resumen = dte?.resumen || {};
    const ident   = dte?.identificacion || {};
    const esCCF   = (ident.tipoDte || (document?.tipo_documento === 'CCF' ? '03' : '01')) === '03';
    // El IVA sale de `tributos` en el CCF; en la factura de consumidor no viene
    // desglosado y lo que el portal guardó es la parte de IVA del monto.
    //
    // Pasa por el helper compartido (2026-08-13) en vez de sumar `tributos`
    // entero: la suma cruda incluiría FOVIAL y COTRANS, que no son IVA. Hoy no
    // cambia ningún número —las ventas de la farmacia no llevan esos impuestos—
    // y por eso mismo es el momento de cerrarlo, antes de que exista el primer
    // documento que los traiga. La regla es la del sync, en un solo lugar.
    const iva = ivaDelDte(dte, 0) ?? 0;
    const codigo = String(dte?.identificacion?.codigoGeneracion || document?.codigo_generacion || '').toUpperCase();

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-surface-card-hover/50">
            <div className="p-6 border-b border-divider bg-surface-card shrink-0 shadow-sm z-base">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-chart-1/10 text-brand-text flex items-center justify-center shadow-inner shrink-0">
                            <Receipt size={24} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0">
                            {/* El receptor, no el emisor: en una venta el emisor
                                somos nosotros y sería el mismo nombre siempre. */}
                            <h3 className="text-lg font-black text-content">
                                {dte?.receptor?.nombre || document?.cliente || 'Documento'}
                            </h3>
                            <p className="text-caption font-bold text-content-2 uppercase tracking-widest mt-0.5">
                                {esCCF ? 'Crédito fiscal' : 'Factura de consumidor'}
                                {' · '}{ident.numeroControl || document?.numero_control || codigo}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {document?.pdf_path && (
                            <SegmentedControl
                                label="Vista del documento" size="sm" tone="neutro"
                                value={tab} onChange={setTab}
                                options={[{ value: 'detalle', label: 'Detalle' }, { value: 'pdf', label: 'PDF' }]}
                            />
                        )}
                        <Button variant="secondary" icon={Archive} disabled={bajandoTodo || (!document?.json_path && !document?.pdf_path)}
                            title="Descargar el PDF y el JSON en un ZIP" onClick={bajarTodo}>
                            {bajandoTodo ? 'Armando ZIP…' : 'Todo'}
                        </Button>
                        <Button variant="secondary" icon={Download} disabled={!document?.pdf_path}
                            onClick={() => downloadStoredFile(document.pdf_path, `${codigo}.pdf`)}>PDF</Button>
                        <Button icon={Download} disabled={!document?.json_path}
                            onClick={() => downloadStoredFile(document.json_path, `${codigo}.json`)}>JSON</Button>
                    </div>
                </div>

                {errorDescarga && <p className="mt-2 text-caption font-bold text-danger">{errorDescarga}</p>}

                {document?.anulada && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3">
                        <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" strokeWidth={2} />
                        <p className="text-label font-bold text-danger-text leading-snug">
                            Este documento está invalidado ante Hacienda. Su retención no se acredita
                            al declarar, aunque el Corte Z del período sí la incluya.
                        </p>
                    </div>
                )}
            </div>

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
                            <div><span className="text-content-3">Cliente: </span><span className="font-semibold text-content">{dte?.receptor?.nombre || document?.cliente || '—'}</span></div>
                            <div><span className="text-content-3">NIT / NRC: </span><span className="font-semibold text-content">{dte?.receptor?.nit || dte?.receptor?.numDocumento || '—'} / {dte?.receptor?.nrc || '—'}</span></div>
                            <div><span className="text-content-3">Fecha emisión: </span><span className="font-semibold text-content">{ident.fecEmi || document?.fecha || '—'} {ident.horEmi || ''}</span></div>
                            <div><span className="text-content-3">Sucursal: </span><span className="font-semibold text-content">{document?.sucursal || '—'}</span></div>
                            <div className="col-span-2"><span className="text-content-3">Código de generación: </span><span className="font-mono text-caption text-content">{codigo || '—'}</span></div>
                            <div className="col-span-2"><span className="text-content-3">Sello de recepción: </span><span className="font-mono text-caption text-content break-all">{dte?.selloRecibido || document?.sello_recepcion || '—'}</span></div>
                        </div>

                        {items.length > 0 ? (
                            <div className="overflow-x-auto mb-4">
                                <table className="w-full text-label">
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
                                            const linea = it.ventaGravada ?? it.ventaNoSuj ?? it.ventaExenta ?? ((it.cantidad || 0) * (it.precioUni || 0));
                                            return (
                                                <tr key={it.numItem ?? i}>
                                                    <td className="py-2 text-content-3 tabular-nums">{it.numItem ?? i + 1}</td>
                                                    <td className="py-2 text-content-2">{it.descripcion || '—'}</td>
                                                    <td className="py-2 text-center tabular-nums">{it.cantidad ?? '—'}</td>
                                                    <td className="py-2 text-right tabular-nums">{fmt$(it.precioUni)}</td>
                                                    <td className="py-2 text-right tabular-nums font-semibold">{fmt$(linea)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-label text-content-3 mb-4">Sin ítems detallados en el documento.</p>
                        )}

                        {/* El desglose respeta la forma de CADA tipo. En la factura
                            de consumidor el gravado ya trae el IVA adentro, así que
                            mostrar una línea de IVA en cero al lado sería afirmar
                            que no lo hubo. */}
                        <div className="flex flex-col items-end gap-1 text-body-sm pt-3 border-t border-divider">
                            <div className="flex justify-between w-64">
                                <span className="text-content-3">{esCCF ? 'Gravado' : 'Gravado (IVA incluido)'}</span>
                                <span className="tabular-nums">{fmt$(resumen.totalGravada)}</span>
                            </div>
                            {esCCF && (
                                <div className="flex justify-between w-64"><span className="text-content-3">IVA 13%</span><span className="tabular-nums">{fmt$(iva)}</span></div>
                            )}
                            {Number(resumen.ivaRete1) > 0 && (
                                <div className="flex justify-between w-64">
                                    <span className="text-content-3">Retención de IVA (Art. 162)</span>
                                    <span className="tabular-nums">-{fmt$(resumen.ivaRete1)}</span>
                                </div>
                            )}
                            <div className="flex justify-between w-64 font-black text-content text-body">
                                <span>Total</span>
                                <span className="tabular-nums">{fmt$(resumen.totalPagar ?? document?.total)}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormSalesDteViewer;
