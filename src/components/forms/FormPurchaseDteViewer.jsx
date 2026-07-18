import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2, Receipt } from 'lucide-react';
import { getSignedFileUrl, openStoredFile } from '../../utils/storageFiles';
import { dteTypeLabel } from '../../utils/dteTypes';

const fmt$ = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

    const items = dte?.cuerpoDocumento || dte?.detalle || [];
    const resumen = dte?.resumen || {};

    return (
        <div className="flex flex-col h-full bg-slate-50/50">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-[1.25rem] bg-blue-50 text-[#0052CC] flex items-center justify-center shadow-inner shrink-0">
                        <Receipt size={24} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-slate-800 truncate">
                            {document?.supplier_nombre || document?.emisor_nombre || 'Documento'}
                        </h3>
                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-0.5 truncate">
                            {dteTypeLabel(document?.tipo_dte)} · {document?.numero_control || document?.codigo_generacion}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {document?.pdf_path && (
                        <div className="flex rounded-[1rem] bg-slate-100 p-1">
                            <button
                                onClick={() => setTab('detalle')}
                                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${tab === 'detalle' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
                            >
                                Detalle
                            </button>
                            <button
                                onClick={() => setTab('pdf')}
                                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${tab === 'pdf' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
                            >
                                PDF
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => openStoredFile(document?.json_path)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-[#0052CC] hover:bg-[#003D99] text-white rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all active:scale-[0.97]"
                    >
                        <Download size={14} strokeWidth={2} /> JSON
                    </button>
                </div>
            </div>

            <div className="flex-1 p-4 md:p-6 overflow-hidden">
                {tab === 'pdf' && pdfUrl ? (
                    <div className="w-full h-full rounded-[1.5rem] border border-slate-200 bg-white shadow-sm overflow-hidden">
                        <object data={pdfUrl} type="application/pdf" className="w-full h-full">
                            <iframe src={pdfUrl} className="w-full h-full border-none" title="Visor PDF" />
                        </object>
                    </div>
                ) : loading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm">
                        <Loader2 size={32} className="animate-spin mb-3 text-[#0052CC]" />
                        <p className="font-bold text-[11px] uppercase tracking-widest">Cargando detalle…</p>
                    </div>
                ) : error ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5} />
                        <p className="font-bold text-sm">No se pudo cargar el detalle ({error}).</p>
                    </div>
                ) : (
                    <div className="w-full h-full overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white shadow-sm p-6">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 pb-4 mb-4 border-b border-slate-100 text-[12px]">
                            <div><span className="text-slate-500">Emisor: </span><span className="font-semibold text-slate-800">{dte?.emisor?.nombre || document?.emisor_nombre || '—'}</span></div>
                            <div><span className="text-slate-500">NIT / NRC: </span><span className="font-semibold text-slate-800">{dte?.emisor?.nit || document?.emisor_nit || '—'} / {dte?.emisor?.nrc || document?.emisor_nrc || '—'}</span></div>
                            <div><span className="text-slate-500">Receptor: </span><span className="font-semibold text-slate-800">{dte?.receptor?.nombre || '—'}</span></div>
                            <div><span className="text-slate-500">Fecha emisión: </span><span className="font-semibold text-slate-800">{dte?.identificacion?.fecEmi || document?.fecha_emision || '—'}</span></div>
                        </div>

                        {items.length > 0 ? (
                            <div className="overflow-x-auto mb-4">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="border-b border-slate-200 text-slate-500 font-semibold">
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
                                                    <td className="py-2 text-slate-500 tabular-nums">{it.numItem ?? i + 1}</td>
                                                    <td className="py-2 text-slate-700">{it.descripcion || '—'}</td>
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
                            <p className="text-[11px] text-slate-500 mb-4">Sin ítems detallados en el documento.</p>
                        )}

                        <div className="flex flex-col items-end gap-1 text-[12px] pt-3 border-t border-slate-100">
                            <div className="flex justify-between w-56"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{fmt$(resumen.subTotal ?? resumen.totalGravada)}</span></div>
                            <div className="flex justify-between w-56"><span className="text-slate-500">IVA</span><span className="tabular-nums">{fmt$(resumen.totalIva ?? document?.total_iva)}</span></div>
                            <div className="flex justify-between w-56 font-black text-slate-800 text-[13px]"><span>Total</span><span className="tabular-nums">{fmt$(resumen.totalPagar ?? resumen.montoTotalOperacion ?? document?.monto_total)}</span></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormPurchaseDteViewer;
