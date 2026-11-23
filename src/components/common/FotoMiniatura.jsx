import React, { useState } from 'react';
import { urlFotoChica } from '@nucleo/utils/fotoChica';

/**
 * La miniatura de la foto de un producto (2026-11-23): pide la copia chica
 * (`product-photos/chicas/<ruta>`, 400 px) en vez de la original, y si esa
 * copia no existe cae a la original. Diferida (`loading="lazy"`) y decodificada
 * fuera del hilo principal; `width`/`height` reservan el lugar.
 *
 * Recibe la dirección TAL COMO está en la base; la traducción vive en
 * `urlFotoChica`. `onError` es el de la pantalla: se llama sólo si falla
 * también la original.
 */
export default function FotoMiniatura({ src, lado = 48, alt = '', className = '', onError }) {
    const chica = urlFotoChica(src);
    // La dirección chica que falló, no un booleano: si cambia la foto, se
    // vuelve a intentar con la nueva.
    const [fallo, setFallo] = useState(null);
    const usar = chica && fallo !== chica ? chica : src;
    return (
        <img
            src={usar}
            alt={alt}
            width={lado}
            height={lado}
            loading="lazy"
            decoding="async"
            className={className}
            onError={(e) => { if (usar === chica) setFallo(chica); else onError?.(e); }}
        />
    );
}
