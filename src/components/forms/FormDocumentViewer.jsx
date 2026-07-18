import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { getSignedFileUrl } from '../../utils/storageFiles';

const FormDocumentViewer = ({ formData }) => {
    const { url: storedUrl, title } = formData || {};

    // Los buckets sensibles son privados: la URL guardada es un identificador
    // que se convierte a URL firmada con expiración al momento de mostrar.
    // `key` marca a qué storedUrl pertenece el resultado — mientras no
    // coincidan, seguimos resolviendo (estado derivado, sin setState síncrono).
    const [signed, setSigned] = useState({ key: undefined, url: null });
    useEffect(() => {
        let alive = true;
        getSignedFileUrl(storedUrl).then((signedUrl) => {
            if (alive) setSigned({ key: storedUrl, url: signedUrl });
        });
        return () => { alive = false; };
    }, [storedUrl]);
    const resolving = signed.key !== storedUrl;
    const url = resolving ? null : signed.url;

    return (
        <div className="flex-1 min-h-0 flex flex-col bg-slate-50/50">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-[1.25rem] bg-blue-50 text-[#0052CC] flex items-center justify-center shadow-inner shrink-0">
                        <FileText size={24} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-slate-800 truncate">{title || 'Documento Adjunto'}</h3>
                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">Vista Previa de Archivo</p>
                    </div>
                </div>
                <a 
                    href={url} 
                    download 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center gap-2 px-5 py-3 bg-[#0052CC] hover:bg-[#003D99] text-white rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all shadow-[0_4px_14px_rgba(0,82,204,0.2)] active:scale-[0.97] shrink-0"
                >
                    <Download size={16} strokeWidth={2} /> Descargar
                </a>
            </div>
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-0">
                {resolving ? (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-slate-500 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm">
                        <Loader2 size={32} className="animate-spin mb-3 text-[#0052CC]" />
                        <p className="font-bold text-[11px] uppercase tracking-widest">Generando acceso seguro...</p>
                    </div>
                ) : url ? (
                    <div className="flex-1 min-h-0 w-full rounded-[1.5rem] border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                        {/* Usamos object/embed para mejor compatibilidad con PDFs en navegadores.
                            Fallback a iframe si falla.
                        */}
                        <object data={url} type="application/pdf" className="w-full h-full">
                            <iframe src={url} className="w-full h-full border-none" title="Visor de Documento">
                                <div className="p-8 text-center text-slate-500">
                                    <p>Tu navegador no soporta la visualización de este tipo de archivo.</p>
                                    <a href={url} target="_blank" rel="noreferrer" className="text-[#0052CC] underline mt-2 block">Haz clic aquí para abrirlo directamente</a>
                                </div>
                            </iframe>
                        </object>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-slate-500 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5}/>
                        <p className="font-bold text-sm">URL no disponible o archivo corrupto.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormDocumentViewer;