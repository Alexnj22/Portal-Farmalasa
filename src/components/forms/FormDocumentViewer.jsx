import React from 'react';
import { Download, FileText } from 'lucide-react';

const FormDocumentViewer = ({ formData }) => {
    const { url, title } = formData || {};

    return (
        <div className="flex flex-col h-full bg-slate-50/50">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-white shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-[1.25rem] bg-blue-50 text-[#007AFF] flex items-center justify-center shadow-inner shrink-0">
                        <FileText size={24} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-slate-800 truncate">{title || 'Documento Adjunto'}</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Vista Previa de Archivo</p>
                    </div>
                </div>
                <a 
                    href={url} 
                    download 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center gap-2 px-5 py-3 bg-[#007AFF] hover:bg-[#0066CC] text-white rounded-[1rem] font-black text-[11px] uppercase tracking-[0.15em] transition-all shadow-[0_4px_14px_rgba(0,122,255,0.2)] active:scale-95 shrink-0"
                >
                    <Download size={16} strokeWidth={2} /> Descargar
                </a>
            </div>
            <div className="flex-1 p-4 md:p-6 overflow-hidden">
                {url ? (
                    <div className="w-full h-full rounded-[1.5rem] border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
                        {/* Usamos object/embed para mejor compatibilidad con PDFs en navegadores. 
                            Fallback a iframe si falla.
                        */}
                        <object data={url} type="application/pdf" className="w-full h-full">
                            <iframe src={url} className="w-full h-full border-none" title="Visor de Documento">
                                <div className="p-8 text-center text-slate-500">
                                    <p>Tu navegador no soporta la visualización de este tipo de archivo.</p>
                                    <a href={url} target="_blank" rel="noreferrer" className="text-[#007AFF] underline mt-2 block">Haz clic aquí para abrirlo directamente</a>
                                </div>
                            </iframe>
                        </object>
                    </div>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-white rounded-[1.5rem] border border-slate-200 shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5}/>
                        <p className="font-bold text-sm">URL no disponible o archivo corrupto.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormDocumentViewer;