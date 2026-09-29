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
 *   2. Una pestaña fija con el texto, arriba al centro, por si el marco se
 *      lee como decoración.
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

      {/* La pestaña: colgada del borde de ARRIBA, al centro, pegada al marco.
          Vivía abajo a la izquierda y tapaba el pie del menú lateral —el
          usuario, la salida, el acceso a la distribuidora— (reportado el
          2026-09-28). Arriba al centro cae en el hueco que dejan los
          encabezados (título a la izquierda, acciones a la derecha), y como es
          parte del marco se lee como tal, no como un cartel suelto. Fondo
          opaco: encima del degradado un velo translúcido se lee flojo. */}
      <div className="hidden lg:flex absolute top-[var(--sa-top)] left-1/2 -translate-x-1/2 items-center gap-1.5 rounded-b-lg border border-t-0 border-warning/40 bg-surface-card px-2.5 py-0.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-solid" />
        <span className="text-micro font-bold uppercase tracking-[0.18em] text-warning-text leading-none py-0.5">
          Entorno de pruebas
        </span>
      </div>
      {/* En el teléfono, arriba al centro vive el nombre de la pantalla o la
          marca, y la pestaña los rozaba. Ahí va vertical, colgada del borde
          IZQUIERDO a media altura: cae en el margen lateral, que en el
          teléfono siempre queda libre. El texto va completo: las pruebas de
          navegador se niegan a correr si no lo ven (es su freno contra
          producción). */}
      <div className="lg:hidden absolute left-[var(--sa-left)] top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-r-lg border border-l-0 border-warning/40 bg-surface-card px-0.5 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-solid" />
        <span className="text-micro font-bold uppercase tracking-[0.18em] text-warning-text leading-none [writing-mode:vertical-rl] rotate-180">
          Entorno de pruebas
        </span>
      </div>
    </div>
  );
}
