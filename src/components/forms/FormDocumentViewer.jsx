import React, { useEffect, useState } from 'react';
import { Skeleton } from '../common/StateViews';
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
        <div className="flex-1 min-h-0 flex flex-col bg-surface-card-hover/50">
            <div className="flex items-center justify-between p-6 border-b border-divider bg-surface-card shrink-0 shadow-sm z-base">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-chart-1/10 text-brand-text flex items-center justify-center shadow-inner shrink-0">
                        <FileText size={24} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-content truncate">{title || 'Documento Adjunto'}</h3>
                        <p className="text-caption font-bold text-content-2 uppercase tracking-widest mt-0.5">Vista Previa de Archivo</p>
                    </div>
                </div>
                <a 
                    href={url} 
                    download 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex items-center gap-2 px-5 py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl font-black text-label uppercase tracking-[0.15em] transition-all shadow-[var(--shadow-glow-brand)] active:scale-[0.97] shrink-0"
                >
                    <Download size={16} strokeWidth={2} /> Descargar
                </a>
            </div>
            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden min-h-0">
                {resolving ? (
                    <div className="flex-1 min-h-0 w-full bg-surface-card rounded-3xl border border-divider shadow-sm p-6">
                        <Skeleton h="100%" rounded="1rem" />
                    </div>
                ) : url ? (
                    <div className="flex-1 min-h-0 w-full rounded-3xl border border-divider bg-surface-card shadow-sm overflow-hidden flex flex-col">
                        {/* Era un <object type="application/pdf"> con el <iframe> de
                            respaldo adentro. La CSP lleva `object-src 'none'` (v2.528.0),
                            así que el <object> nunca cargaba: siempre terminaba cayendo
                            al respaldo. Se deja el <iframe> a secas — no se afloja la
                            directiva, que es de las que valen. Su contenido de respaldo
                            también se fue: ningún navegador actual lo pinta, y el botón
                            de descarga del encabezado ya cubre ese caso. */}
                        <iframe src={url} className="w-full h-full border-none" title="Visor de documento" />
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center text-content-3 bg-surface-card rounded-3xl border border-divider shadow-sm border-dashed">
                        <FileText size={48} className="mb-4 opacity-30" strokeWidth={1.5}/>
                        <p className="font-bold text-sm">URL no disponible o archivo corrupto.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormDocumentViewer;