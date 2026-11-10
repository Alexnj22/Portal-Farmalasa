// Lo que ocupa la franja de abajo de la pantalla (2026-11-10, «la burbuja del
// chat cubre cuando salen avisos»). Un aviso temporal que se pinta abajo
// —«Agregado · Ver carrito», «Aviso borrado · Deshacer»— anota hasta qué
// altura llega (medida desde el borde inferior de la pantalla), y la burbuja
// del chat sube por encima mientras esté y vuelve a bajar cuando se va. Es lo
// que hacen el FAB de Material con el snackbar y los botones flotantes de iOS.
import { useEffect } from 'react';
import { create } from 'zustand';

export const useEspacioAbajo = create((set) => ({
  // id → altura que ocupa, desde el borde inferior de la pantalla.
  ocupado: {},
  ocupar: (id, alto) => set((s) => (s.ocupado[id] === alto ? s : { ocupado: { ...s.ocupado, [id]: alto } })),
  soltar: (id) => set((s) => {
    if (!(id in s.ocupado)) return s;
    const ocupado = { ...s.ocupado };
    delete ocupado[id];
    return { ocupado };
  }),
}));

/** La altura más alta ocupada ahora (0 = la franja está libre). */
export const alturaOcupada = (s) => Math.max(0, ...Object.values(s.ocupado));

/**
 * Para un aviso que se pinta abajo: devuelve el `onLayout` que anota cuánto
 * ocupa (`desde` = su `bottom`), y lo suelta al desmontarse.
 */
export function useOcupaAbajo(id, desde) {
  const ocupar = useEspacioAbajo((s) => s.ocupar);
  const soltar = useEspacioAbajo((s) => s.soltar);
  useEffect(() => () => soltar(id), [id, soltar]);
  return (e) => ocupar(id, desde + e.nativeEvent.layout.height);
}
