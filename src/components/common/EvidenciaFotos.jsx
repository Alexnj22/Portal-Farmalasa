import React, { memo, useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { getSignedFileUrl } from '../../utils/storageFiles';
import PhotoLightbox from './PhotoLightbox';

/**
 * EvidenciaFotos — las fotos guardadas de una solicitud o de un envío.
 *
 * Canónico desde el 2026-08-24. Nació dentro de `DetalleSolicitud` para que
 * quien aprueba un descarte por daño pudiera ver el daño; el envío por «Avería»
 * necesita exactamente lo mismo del otro lado —Bodega abre la caja y decide si
 * se le reclama al proveedor—, así que se sacó acá antes de que existiera la
 * segunda copia. Su gemela de captura es `FotosDeEvidencia`, que es la tira del
 * formulario: ésta muestra lo que ya está subido, aquélla toma lo que todavía
 * no.
 *
 * ── Por qué firma en vez de pintar la URL ─────────────────────────────────
 * El bucket es PRIVADO y lo que se guarda es la URL en formato público, que
 * sirve como identificador y no como enlace (regla 10 de CLAUDE.md). Sin
 * firmar, las fotos salen rotas — y eso estuvo a punto de pasar: hasta el
 * 2026-08-10 `inventario-evidencia` faltaba en `PRIVATE_BUCKETS`, así que
 * `getSignedFileUrl` devolvía la URL cruda. No lo notó nadie porque hasta ese
 * día NINGUNA pantalla las mostraba.
 *
 * Las tres formas de una miniatura —firmada, firmando, no se pudo— se dibujan
 * las tres: una foto que no carga tiene que decirlo, porque su ausencia es
 * justo lo que quien decide no puede notar.
 *
 * ── Por qué la foto se abre ACÁ y no en otra pestaña ──────────────────────
 * La miniatura era un `<a target="_blank">`. Abrir la foto sacaba a quien
 * estaba decidiendo fuera del portal: la pantalla que dejaba atrás es un
 * formulario a medio contestar —qué renglón se queda y cuál se devuelve— y
 * volver de la pestaña de la foto es un viaje de ida y vuelta por el navegador
 * que en el teléfono ni siquiera es obvio. La foto es evidencia PARA esa
 * decisión, así que se mira sin soltarla. `PhotoLightbox` es el visor canónico
 * y vive en `z-flyout` (300), o sea por encima de `z-modal` (100): funciona
 * igual dentro del diálogo del tablero que en la vista de traslados.
 */
const EvidenciaFotos = memo(({ urls, titulo = 'Evidencia' }) => {
    const [firmadas, setFirmadas] = useState(null);
    const [ampliada, setAmpliada] = useState(null);   // { src, alt } | null

    useEffect(() => {
        let vivo = true;
        Promise.all((urls ?? []).map(u => getSignedFileUrl(u).catch(() => null)))
            .then(r => { if (vivo) setFirmadas(r); });
        return () => { vivo = false; };
    }, [urls]);

    if (!urls?.length) return null;

    return (
        <div>
            <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">{titulo}</p>
            <div className="flex flex-wrap gap-2">
                {(firmadas ?? urls.map(() => null)).map((src, i) => src ? (
                    <button key={i} type="button"
                        onClick={() => setAmpliada({ src, alt: `${titulo} ${i + 1}` })}
                        aria-label={`Ampliar ${titulo.toLowerCase()} ${i + 1}`}
                        className="w-16 h-16 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover
                                   transition-transform duration-[var(--dur-fast)] hover:scale-105 active:scale-[0.97]"
                        data-interactive>
                        <img src={src} alt={`${titulo} ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                ) : (
                    <div key={i} className="w-16 h-16 rounded-xl border border-divider bg-surface-card-hover
                                            flex items-center justify-center">
                        {firmadas ? <ImageOff size={16} className="text-content-3" strokeWidth={2} />
                                  : <div className="w-full h-full skeleton rounded-xl" />}
                    </div>
                ))}
            </div>

            <PhotoLightbox src={ampliada?.src} alt={ampliada?.alt ?? titulo}
                onClose={() => setAmpliada(null)} />
        </div>
    );
});
EvidenciaFotos.displayName = 'EvidenciaFotos';

export default EvidenciaFotos;
