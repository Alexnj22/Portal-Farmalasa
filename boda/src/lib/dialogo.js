import { useEffect } from 'react';

/*
 * Ventanas a pantalla completa (sobre, visor, presentación) con <dialog>
 * nativo: showModal() deja el resto de la página inerte, atrapa el foco y lo
 * anuncia como diálogo. Al cerrar, el foco vuelve a donde estaba.
 * El scroll de fondo se bloquea con UN contador para todo el sitio (dos
 * ventanas a la vez no se desbloquean una a la otra).
 */
let bloqueos = 0;
export function bloquearScroll() {
  bloqueos += 1;
  if (bloqueos === 1) document.documentElement.classList.add('sin-scroll');
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    bloqueos = Math.max(0, bloqueos - 1);
    if (!bloqueos) document.documentElement.classList.remove('sin-scroll');
  };
}

/** Abre el <dialog> de `ref` como modal mientras el componente vive. */
export function useDialogo(ref, { activo = true } = {}) {
  useEffect(() => {
    const d = ref.current;
    if (!activo || !d) return undefined;
    const antes = document.activeElement;
    try { if (!d.open) d.showModal?.(); } catch (e) { console.warn('showModal', e); }
    const liberar = bloquearScroll();
    return () => {
      liberar();
      try { if (d.open) d.close(); } catch { /* ya cerrado */ }
      if (antes && typeof antes.focus === 'function' && document.contains(antes)) antes.focus({ preventScroll: true });
    };
  }, [ref, activo]);
}
