import React, { memo } from 'react';
import HojaMovil from './HojaMovil';
import useMediaQuery from '../../hooks/useMediaQuery';

/**
 * CuerpoDialogo — el contenido de un diálogo, en la anatomía que corresponda.
 *
 * `ModalShell` resuelve la CAJA (dónde aparece, cómo entra, el material).
 * `HojaMovil` resuelve el cuerpo en el teléfono. Faltaba la pieza que elige
 * entre ese cuerpo y el de escritorio, y sin ella cada llamador escribía el
 * `useMediaQuery('(hover: none)')` y las dos ramas a mano — que es como
 * `ConfirmModal`, `PromptModal`, `ConfigPanel` y `LabsPanel` terminaron con
 * cuatro copias del mismo condicional.
 *
 * ── Las dos anatomías, y por qué son distintas ────────────────────────────
 * **Escritorio**: panel centrado y angosto. Ahí el ícono grande y el título al
 * medio funcionan porque el panel es un objeto que flota en un lienzo grande, y
 * centrarlo es lo que lo separa del fondo.
 *
 * **Teléfono**: hoja de ancho completo. El título centrado no tiene con qué
 * alinearse —el ojo entra por el borde izquierdo—, el ícono de 64px se come la
 * mitad del alto útil, y los botones en fila se reparten 390px. Todo eso lo
 * resuelve `HojaMovil`.
 *
 * No es una adaptación de una en la otra: son dos piezas con reglas propias,
 * porque el tamaño de pantalla y la forma de tocar son otras.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   <ModalShell open={!!fila} onClose={cerrar} surface={null} ariaLabel="…">
 *       <CuerpoDialogo titulo="¿Publicar 12 borradores?" icono={Upload}
 *           pie={<><Button …>Publicar</Button><Button variant="secondary" …/></>}>
 *           …contenido…
 *       </CuerpoDialogo>
 *   </ModalShell>
 *
 * `surface={null}` en el `ModalShell`: la superficie la pone el cuerpo, que es
 * quien sabe cuál de las dos anatomías está dibujando.
 */

const TONO_ESCRITORIO = {
    brand:   'text-brand-text border-brand/30',
    danger:  'text-danger border-danger/30',
    warning: 'text-warning-text border-warning/30',
    success: 'text-success border-success/30',
};

const CuerpoDialogo = memo(({
    titulo,
    subtitulo,
    icono: Icono,
    tono = 'brand',
    pie,
    children,
    // El ancho del panel de ESCRITORIO. En el teléfono no aplica: la hoja
    // siempre ocupa el ancho entero.
    anchoEscritorio = 'max-w-sm',
    className = '',
}) => {
    const enTactil = useMediaQuery('(hover: none)');

    if (enTactil) {
        return (
            <HojaMovil titulo={titulo} subtitulo={subtitulo} icono={Icono} tono={tono}
                pie={pie} className={className}>
                {children}
            </HojaMovil>
        );
    }

    /* ── El panel de escritorio TIENE tope de alto (2026-08-24) ──────────────
     * No lo tenía, y eso no es un detalle de estilo: sin tope, el panel crece
     * con su contenido hasta salirse de la pantalla, y **lo primero que se va
     * por abajo es el pie**, o sea los botones. Un diálogo cuyo botón de
     * cerrar quedó fuera de la ventana es un diálogo del que no se puede salir
     * sin la tecla Escape.
     *
     * Reportado sobre «Llevar productos», que crece con cada bolsa que uno
     * carga —así que el defecto aparece justo cuando el recorrido va largo—,
     * pero era de ESTE componente y por lo tanto de todos sus diálogos: la
     * lista de renglones de «Recibir traslado» crece igual.
     *
     * `88dvh` es el mismo tope que `LiquidModal` (su `TOPE_ALTO`) — el canon
     * del portal para un panel, y `dvh` y no `vh` porque en el navegador de un
     * teléfono la barra que aparece y desaparece cambia el alto real.
     *
     * El reparto es el de siempre: el contenido scrollea (`flex-1 min-h-0`) y
     * el pie no (`shrink-0`). Sin `min-h-0` un hijo de flex no se encoge por
     * debajo de su contenido y el `overflow` no llega a activarse nunca. */
    return (
        <div data-surface="modal"
            className={`w-full ${anchoEscritorio} mx-auto rounded-modal overflow-hidden
                max-h-[88dvh] flex flex-col ${className}`}>
            <div className="p-6 sm:p-8 flex flex-col items-center text-center flex-1 min-h-0 overflow-y-auto">
                {Icono && (
                    <div className={`w-14 h-14 rounded-2xl grid place-items-center mb-4 border
                        bg-surface-card-hover shadow-sm ${TONO_ESCRITORIO[tono] || TONO_ESCRITORIO.brand}`}>
                        <Icono size={26} strokeWidth={2.5} />
                    </div>
                )}
                {titulo && (
                    <h3 className="text-title-sm font-black uppercase tracking-tight mb-1 text-content text-balance">
                        {titulo}
                    </h3>
                )}
                {subtitulo && <p className="text-caption text-content-3 font-medium mb-2">{subtitulo}</p>}
                {children != null && (
                    <div className="w-full text-body text-content-2 leading-relaxed">{children}</div>
                )}
            </div>
            {pie && (
                // `flex-row-reverse`: la principal llega primera en el DOM —igual
                // que en la hoja— y acá eso la deja a la DERECHA, que es donde el
                // escritorio la espera. Una sola fuente de orden para las dos
                // anatomías, en vez de que el llamador escriba dos.
                <div className="shrink-0 px-5 py-4 border-t border-divider bg-surface-card-hover
                    flex flex-row-reverse gap-3 [&>*]:flex-1">
                    {pie}
                </div>
            )}
        </div>
    );
});

CuerpoDialogo.displayName = 'CuerpoDialogo';
export default CuerpoDialogo;
