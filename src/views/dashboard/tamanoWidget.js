import { createContext, useContext, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// Cuánto mide un widget, y qué hace cuando no le alcanza (2026-10-21).
//
// ── El problema ────────────────────────────────────────────────────────────
// El alto de una tarjeta lo decide la rejilla (120px por renglón) y lo que va
// adentro no se enteraba. Con el tamaño que la persona eligió —o uno guardado
// de antes de que el widget tuviera mínimo— «Recetas pendientes» y «Reservas»
// quedaban en 1×1: el encabezado y medio ícono de un vacío cortado al borde.
// Reportado con captura: «que funcione en todos los tamaños».
//
// ── La respuesta es la de los widgets del teléfono ─────────────────────────
// Prohibir el tamaño chico no sirve: es una decisión de quien arma su tablero.
// Lo que sí se puede es que en el tamaño chico el widget diga OTRA cosa: su
// dato clave —el número y una línea— y que al tocarlo se abra el contenido
// completo en un modal, con espacio. Es el «vistazo».
//
// ── Por qué el contenido se monta UNA sola vez ─────────────────────────────
// El dato del vistazo lo calcula el propio widget (es el único que tiene la
// lista), así que el contenido tiene que estar montado aunque no se vea. Y al
// abrir el modal no puede montarse de nuevo: volvería a consultar y perdería
// lo que estuviera escrito. Por eso se portalea a un nodo PROPIO que se mueve
// físicamente entre un escondite y el cuerpo del modal — el contenedor del
// portal no cambia, así que React no lo vuelve a crear.
// ═══════════════════════════════════════════════════════════════════════════

/** { cols, rows, minCols, minRows, compacto } — o null fuera del tablero. */
export const TamanoWidgetCtx = createContext(null);
export const useTamanoWidget = () => useContext(TamanoWidgetCtx);

/** Lo provee `VistazoWidget`; el contenido publica ahí su dato clave. */
export const ResumenWidgetCtx = createContext(null);

/**
 * El widget declara su dato clave para el vistazo.
 *
 * `resumen`: { valor, texto, tono } — `valor` es el número grande (o null),
 * `texto` la línea que lo explica y `tono` (danger|warning|brand|success) sólo
 * cuando el número pide algo. Fuera de un vistazo no hace nada.
 */
export function useResumenWidget(resumen) {
    const publicar = useContext(ResumenWidgetCtx);
    const clave = resumen ? `${resumen.valor ?? ''}|${resumen.texto ?? ''}|${resumen.tono ?? ''}` : '';
    useEffect(() => {
        publicar?.(clave ? resumen : null);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave resume el objeto
    }, [publicar, clave]);
    useEffect(() => () => publicar?.(null), [publicar]);
}
