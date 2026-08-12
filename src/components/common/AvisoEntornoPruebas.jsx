import React from 'react';
import { ES_PRUEBAS } from '../../entorno';

/**
 * Marca la pantalla cuando el portal NO está hablando con la base real.
 *
 * El riesgo de tener dos entornos no es probar: es confundirlos. Por eso son dos
 * señales redundantes y las dos permanentes — un aviso que se cierra deja de
 * avisar justo en la sesión larga, que es cuando uno se olvida:
 *
 *   1. Un marco delgado alrededor del viewport. Se ve desde cualquier vista, con
 *      cualquier scroll, y no ocupa lugar en el layout.
 *   2. Una píldora fija con el texto, por si el marco se lee como decoración.
 *
 * Ambas son `pointer-events-none` y viven en `z-confirm` (99999, el techo del
 * proyecto): se pintan por encima de modales y toasts sin robarles un solo clic.
 *
 * No nombra la base, ni el proveedor, ni el branch: la pantalla habla del portal
 * (CLAUDE.md, «la pantalla habla del PORTAL, nunca del sistema de origen»).
 */
export default function AvisoEntornoPruebas() {
  if (!ES_PRUEBAS) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-confirm">
      {/* Marco: un ring hacia adentro, sin caja propia ni sombra que tape nada. */}
      <div className="absolute inset-0 ring-2 ring-inset ring-warning/40" />

      {/* Píldora. Abajo a la izquierda: la esquina más libre del layout —el
          sidebar llega arriba y los toasts entran por la derecha. */}
      {/* Fondo opaco (`bg-surface-card` como color, no como tarjeta) en vez de
          vidrio: encima del degradado ambiental un velo translúcido se lee
          flojo, y es justo el cartel que no puede pasar desapercibido. */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-warning/40 bg-surface-card px-3 py-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-solid" />
        <span className="text-caption font-bold uppercase tracking-[0.18em] text-warning-text">
          Entorno de pruebas
        </span>
      </div>
    </div>
  );
}
