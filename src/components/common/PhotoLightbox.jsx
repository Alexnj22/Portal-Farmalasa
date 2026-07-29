import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';

// Visor de una foto a pantalla completa.
//
// Existía tres veces (auditoría 2026-07-29): `TabCatalogo.PhotoLightbox`,
// `WidgetInventorySearch.Lightbox` y el `zoomPhoto` inline de `TabMinMax`. Las
// tres pintaban lo mismo con distinto scrim, distinto z-index y distinto radio,
// y **dos de las tres no cerraban con Escape** — se abría la foto de un
// producto y la única salida era el clic. Éste es el de `TabCatalogo`, que era
// el completo, promovido a canónico.
//
// `alt` es obligatorio a propósito: la foto es el contenido acá, no decoración.
// Las tres versiones traían `alt=""`, que para una imagen que el usuario abrió
// deliberadamente es justo lo contrario de lo que corresponde.
export default function PhotoLightbox({ src, alt, onClose, zClass = 'z-flyout' }) {
    useEffect(() => {
        if (!src) return;
        const handler = e => { if (e.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [src, onClose]);

    if (!src) return null;

    return createPortal(
        <div
            className={`fixed inset-0 ${zClass} flex items-center justify-center`}
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', backgroundColor: 'var(--scrim)' }}
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onClick={onClose}
        >
            <div
                className="relative max-w-[90vw] max-h-[90vh] rounded-3xl overflow-hidden shadow-[var(--shadow-elevation-4)]"
                style={{ animation: 'lightbox-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both' }}
                onClick={e => e.stopPropagation()}
            >
                <img src={src} alt={alt} className="block max-w-[90vw] max-h-[90vh] object-contain" />
                <Button icon={X} iconOnly size="md" variant="ghost" onClick={onClose} aria-label="Cerrar la foto" className="absolute top-3 right-3" />
            </div>
        </div>,
        document.body
    );
}
