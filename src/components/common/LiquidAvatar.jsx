import React, { useState } from 'react';
import { User } from 'lucide-react';

const LiquidAvatar = ({ src, alt, fallbackText, className = "" }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    // Si no hay URL o hubo un error, mostramos las iniciales o el icono por defecto
    if (!src || hasError) {
        return (
            <div className={`relative flex items-center justify-center bg-surface-card-hover overflow-hidden ${className}`}>
                {fallbackText ? (
                    <span className="font-black uppercase text-brand tracking-tight">{fallbackText.charAt(0)}</span>
                ) : (
                    <User size={className.includes('w-20') || className.includes('w-24') ? 36 : 18} className="text-content-3" strokeWidth={2} />
                )}
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden bg-surface-card-hover ${className}`}>
            {/* 🚨 SKELETON PRELOADER: Brillo animado mientras carga */}
            {isLoading && (
                <div className="absolute inset-0 z-0 bg-surface-card-hover">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-[shimmer_1.5s_infinite]"></div>
                </div>
            )}

            {/* LA IMAGEN REAL (Oculta hasta que carga) */}
            <img 
                src={src} 
                alt={alt || "Avatar"} 
                loading="lazy" 
                onLoad={() => setIsLoading(false)}
                onError={() => setHasError(true)}
                className={`absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-500 ease-in-out ${isLoading ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}`}
            />
        </div>
    );
};

export default LiquidAvatar;