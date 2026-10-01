import React from 'react';

/**
 * El encabezado de una sección dentro de una pestaña de Promociones.
 *
 * Cada pestaña titulaba distinto —Seguimiento con un rótulo en mayúsculas y
 * otro grande, Descuentos con un `h2` de cuerpo grande, Pagos con un `h3` de
 * subtítulo—, así que el mismo nivel se leía como tres niveles según dónde se
 * mirara (auditoría 2026-10-01). Escrito una vez, el módulo titula igual.
 *
 * @param titulo   lo que nombra la sección.
 * @param conteo   un número opcional al lado (cuántas hay).
 * @param sub      la aclaración corta, en gris.
 * @param children acciones de la sección, a la derecha (p. ej. Exportar).
 */
export default function TituloSeccion({ titulo, conteo, sub, children, as: Etiqueta = 'h3' }) {
    return (
        <div className="flex items-baseline gap-2 flex-wrap">
            <Etiqueta className="text-body-lg font-semibold text-content break-words">{titulo}</Etiqueta>
            {conteo != null && (
                <span className="text-caption text-content-3 tabular-nums">{conteo}</span>
            )}
            {sub && <span className="text-caption text-content-3">· {sub}</span>}
            {children && <span className="flex-1" />}
            {children}
        </div>
    );
}
