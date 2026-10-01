import React from 'react';
import { ExternalLink, FileText, Film, Trash2, Link2, PenLine, Layers } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { tipoDeArchivo } from '@nucleo/utils/marketing';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { abrirEnPestanaNueva } from '@plataforma/descargas';

/**
 * Los diseños VIGENTES de una pieza: imagen o video en miniatura, y los
 * enlaces (Drive, Canva) como fila. Una versión reemplazada no se pinta acá
 * —vive en el comparador de versiones—. `firmadas` trae la URL firmada de cada
 * guardada: el bucket es privado y la guardada sola no se puede pintar.
 *
 * `marcasPorArchivo`: cuántos comentarios marcados tiene cada diseño.
 */
export default function Disenos({ archivos, firmadas, marcasPorArchivo = {}, onQuitar, onAnotar, onVersiones, compacto = false }) {
    const vigentes = (archivos || []).filter((a) => !a.reemplazado);
    if (!vigentes.length) return null;
    const medios = vigentes.filter((a) => a.url);
    const enlaces = vigentes.filter((a) => !a.url && a.enlace);

    return (
        <div className="space-y-2">
            {medios.length > 0 && (
                <div className={compacto ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 sm:grid-cols-3 gap-2'}>
                    {medios.map((a) => {
                        const src = firmadas?.get?.(a.url);
                        const tipo = tipoDeArchivo(a);
                        const marcas = marcasPorArchivo[a.id] || 0;
                        return (
                            <figure key={a.id} className="rounded-lg overflow-hidden border border-border-card bg-surface-input">
                                <div className="aspect-square relative">
                                    {tipo === 'imagen' && src && (
                                        <img src={src} alt={a.nombre || 'Diseño'} loading="lazy" className="w-full h-full object-cover" />
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
                                    <span className="absolute top-1 left-1 flex gap-1">
                                        {a.version > 1 && <Badge variant="info" size="sm">V{a.version}</Badge>}
                                        {marcas > 0 && <Badge variant="danger" size="sm">{marcas} marca{marcas === 1 ? '' : 's'}</Badge>}
                                    </span>
                                </div>
                                <figcaption className="flex items-center justify-end gap-1 px-1">
                                    {onAnotar && tipo === 'imagen' && src && (
                                        <Button variant="ghost" size="xs" iconOnly icon={PenLine}
                                            title="Comentar sobre el diseño" onClick={() => onAnotar(a)} />
                                    )}
                                    {onVersiones && (
                                        <Button variant="ghost" size="xs" iconOnly icon={Layers}
                                            title={a.version > 1 ? `Versiones (${a.version})` : 'Versiones y subir una nueva'}
                                            onClick={() => onVersiones(a)} />
                                    )}
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
