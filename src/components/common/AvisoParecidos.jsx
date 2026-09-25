import React from 'react';
import { Search } from 'lucide-react';
import Notice from './Notice';

/**
 * El aviso de la búsqueda aproximada (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md):
 * cuando nada coincide tal cual, la regla del portal muestra lo PARECIDO, y la
 * pantalla lo tiene que decir. Sin el aviso, «amoxisilina» mostrando
 * AMOXICILINA se lee como una coincidencia, y un resultado parecido pero
 * equivocado se elige sin sospechar.
 */
export default function AvisoParecidos({ texto, className }) {
    if (!texto?.trim()) return null;
    return (
        <Notice variant="warning" icon={Search} className={className}>
            Resultados similares para &ldquo;{texto.trim()}&rdquo; — no se encontraron coincidencias exactas
        </Notice>
    );
}
