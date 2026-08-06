import React, { useState } from 'react';
import { User } from 'lucide-react';
import { webpSignedUrl } from '../../utils/storageFiles';

/**
 * LiquidAvatar — la foto redonda con sus iniciales de respaldo.
 *
 * Pide la foto en WEBP por defecto (2026-07-29). Medido antes: Personal › Listado
 * bajaba 4.1 MB en 25 fotos —168 a 199 kB cada una— para pintarlas en círculos de
 * 36 px. `webpSignedUrl` reescribe la URL ya firmada al endpoint de render, que
 * convierte solo: la misma foto pasa a ~20 kB, sin una petición extra y sin
 * pérdida visible al tamaño en que se muestra.
 *
 * `optimize={false}` trae el original — para cuando se necesita el archivo tal
 * cual (editor de foto, descarga).
 *
 * Si el render falla NO se cae a iniciales: primero reintenta con la URL
 * original. Solo si esa también falla se muestran las iniciales.
 */
const LiquidAvatar = ({ src, alt, fallbackText, className = "", optimize = true }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError]   = useState(false);
    // `false` mientras se intenta la miniatura; `true` tras un fallo de render.
    const [useOriginal, setUseOriginal] = useState(false);

    // Reset al cambiar de foto. Va en RENDER, no en un efecto: el proyecto
    // prohíbe setState dentro de useEffect (regla del React Compiler), y este es
    // el patrón que React documenta para ajustar estado cuando cambia una prop.
    const [prevSrc, setPrevSrc] = useState(src);
    if (src !== prevSrc) {
        setPrevSrc(src);
        setIsLoading(true);
        setHasError(false);
        setUseOriginal(false);
    }

    // Si no hay URL o hubo un error, mostramos las iniciales o el icono por defecto
    if (!src || hasError) {
        return (
            <div className={`relative flex items-center justify-center bg-surface-card-hover overflow-hidden ${className}`}>
                {fallbackText ? (
                    <span className="font-black uppercase text-brand-text tracking-tight">{fallbackText.charAt(0)}</span>
                ) : (
                    <User size={className.includes('w-20') || className.includes('w-24') ? 36 : 18} className="text-content-3" strokeWidth={2} />
                )}
            </div>
        );
    }

    const finalSrc = (optimize && !useOriginal) ? webpSignedUrl(src) : src;

    return (
        <div className={`relative overflow-hidden bg-surface-card-hover ${className}`}>
            {/* 🚨 SKELETON PRELOADER: Brillo animado mientras carga */}
            {isLoading && (
                <div className="absolute inset-0 z-0 bg-surface-card-hover">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[var(--shimmer-sweep)] to-transparent animate-[shimmer_1.5s_infinite]"></div>
                </div>
            )}

            {/* LA IMAGEN REAL (Oculta hasta que carga) */}
            <img
                src={finalSrc}
                alt={alt || "Avatar"}
                loading="lazy"
                decoding="async"
                onLoad={() => setIsLoading(false)}
                onError={() => {
                    // Un fallo del render no debe borrar la cara: se reintenta con la original.
                    if (optimize && !useOriginal) { setUseOriginal(true); return; }
                    setHasError(true);
                }}
                className={`absolute inset-0 w-full h-full object-cover z-base transition-opacity duration-[var(--dur-lento)] ease-in-out ${isLoading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}`}
            />
        </div>
    );
};

export default LiquidAvatar;
