import { createContext } from 'react';

/**
 * El estado de salida de un diálogo, para el hijo que se anima solo.
 *
 * Con `animacionPropia`, `ModalShell` no anima nada — pero el hijo necesita
 * saber CUÁNDO empieza la salida, o la hoja desaparecería de golpe mientras la
 * entrada fue una gota. Un gesto que se abre con cuidado y se corta en seco se
 * siente roto, aunque cada mitad por separado esté bien.
 *
 * Vive en su propio archivo `.js` y no dentro de `ModalShell.jsx` por el mismo
 * motivo que `CanalDeVista`: un módulo que exporta un componente **y** otra cosa
 * rompe el fast-refresh de React, y el lint lo marca. Un contexto no es un
 * componente.
 */
export const EstadoDialogoCtx = createContext({ cerrando: false, salidaMs: 180, alCerrar: null });
