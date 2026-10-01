import React from 'react';
import { ExternalLink, FileText, Film, Trash2, Link2 } from 'lucide-react';
import Button from '../../components/common/Button';
import { tipoDeArchivo } from '@nucleo/utils/marketing';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { abrirEnPestanaNueva } from '@plataforma/descargas';

/**
 * Los diseños de una pieza: imagen o video en miniatura, y los enlaces
 * (Drive, Canva) como fila. `firmadas` trae la URL firmada de cada guardada:
 * el bucket es privado y la guardada sola no se puede pintar.
 */
export default function Disenos({ archivos, firmadas, onQuitar, compacto = false }) {
    if (!archivos?.length) return null;
    const medios = archivos.filter((a) => a.url);
    const enlaces = archivos.filter((a) => !a.url && a.enlace);

    return (
        <div className="space-y-2">
            {medios.length > 0 && (
                <div className={compacto ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 sm:grid-cols-3 gap-2'}>
                    {medios.map((a) => {
                        const src = firmadas?.get?.(a.url);
                        const tipo = tipoDeArchivo(a);
                        return (
                            <figure key={a.id} className="rounded-lg overflow-hidden border border-border-card bg-surface-input">
                                <div className="aspect-square">
                                {tipo === 'imagen' && src && (
                                    <img src={src} alt={a.nombre || 'Diseño'} loading="lazy"
                                        className="w-full h-full object-cover" />
                                )}
                                {tipo === 'video' && src && (
                                    <video src={src} controls preload="metadata" playsInline className="w-full h-full object-cover" />
                                )}
                                {(!src || tipo === 'pdf' || tipo === 'otro') && (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-content-3">
                                        {tipo === 'video' ? <Film size={22} /> : <FileText size={22} />}
                                        <span className="text-micro text-center truncate max-w-full">{a.nombre || 'Archivo'}</span>
                                    </div>
                                )}
                                </div>
                                <figcaption className="flex items-center justify-end gap-1 px-1">
                                    <Button variant="ghost" size="xs" iconOnly icon={ExternalLink}
                                        title={`Abrir ${a.nombre || 'el diseño'}`} onClick={() => openStoredFile(a.url)} />
                                    {onQuitar && (
                                        <Button variant="ghost" size="xs" iconOnly icon={Trash2}
                                            title={`Quitar ${a.nombre || 'el diseño'}`} onClick={() => onQuitar(a)} />
                                    )}
                                </figcaption>
                            </figure>
                        );
                    })}
                </div>
            )}
            {enlaces.map((a) => (
                <div key={a.id} className="flex items-center gap-2 min-w-0">
                    <Link2 size={14} className="text-content-3 shrink-0" />
                    <Button variant="ghost" size="xs" className="min-w-0 max-w-full justify-start"
                        title={a.enlace} onClick={() => abrirEnPestanaNueva(a.enlace)}>
                        <span className="truncate">{a.nombre || a.enlace}</span>
                    </Button>
                    {onQuitar && (
                        <Button variant="ghost" size="xs" iconOnly icon={Trash2}
                            title={`Quitar ${a.nombre || 'el enlace'}`} onClick={() => onQuitar(a)} className="ml-auto" />
                    )}
                </div>
            ))}
        </div>
    );
}
