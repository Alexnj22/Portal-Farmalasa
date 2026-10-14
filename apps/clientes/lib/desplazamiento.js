// ¿Se está desplazando la pantalla? (2026-10-14, «el Inicio se siente lento»).
//
// Lo decorativo que se anima solo —el material de la tarjeta de socio, el
// giroscopio, la luz del cupón— se PAUSA mientras el dedo arrastra o la lista
// sigue de largo, y vuelve al soltarse. Un shader a tamaño de tarjeta que se
// recalcula en el mismo cuadro en que se compone el desplazamiento es lo que
// hacía perder cuadros.
//
// Cada `Pantalla` (componentes/ui.js) tiene su propio estado y lo reparte por
// contexto: el desplazamiento de OTRA pantalla no pausa nada de ésta. Los
// avisos salen de los eventos de arrastre y de inercia del ScrollView —cuatro
// por gesto—, nunca de `onScroll`, así que no cuesta trabajo de JavaScript por
// cuadro. Quien escucha elige con un selector qué le importa y sólo se repinta
// cuando eso cambia.
import { createContext, useContext, useEffect, useRef, useState } from 'react';

const QUIETO = { moviendo: false, y: Number.NEGATIVE_INFINITY, alto: 0 };
// Cuánto se espera tras soltar el dedo a ver si la lista sigue de largo
// (la inercia avisa en el mismo instante; esto es sólo un margen).
const ESPERA_INERCIA_MS = 120;

export function crearDesplazamiento() {
  const oyentes = new Set();
  let reloj = null;
  const d = {
    estado: QUIETO,
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f); },
    poner(cambios) {
      d.estado = { ...d.estado, ...cambios };
      oyentes.forEach((f) => f());
    },
    medir(e) {
      const n = e?.nativeEvent;
      return n ? { y: n.contentOffset?.y ?? 0, alto: n.layoutMeasurement?.height ?? 0 } : {};
    },
    empezar(e) { clearTimeout(reloj); d.poner({ moviendo: true, ...d.medir(e) }); },
    soltar(e) {
      const m = d.medir(e);
      clearTimeout(reloj);
      reloj = setTimeout(() => d.poner({ moviendo: false, ...m }), ESPERA_INERCIA_MS);
    },
    inercia() { clearTimeout(reloj); if (!d.estado.moviendo) d.poner({ moviendo: true }); },
    terminar(e) { clearTimeout(reloj); d.poner({ moviendo: false, ...d.medir(e) }); },
    soltarTodo() { clearTimeout(reloj); oyentes.clear(); },
  };
  return d;
}

export const ContextoDesplazamiento = createContext(null);

/**
 * Lo que `seleccionar(estado)` devuelve del desplazamiento de la pantalla que
 * contiene al componente. `estado`: { moviendo, y, alto } — `y` y `alto` son
 * los del último reposo (no se actualizan cuadro a cuadro). Fuera de una
 * `Pantalla`, el estado quieto.
 */
export function useDesplazamiento(seleccionar) {
  const d = useContext(ContextoDesplazamiento);
  const sel = useRef(seleccionar);
  sel.current = seleccionar;
  const [valor, setValor] = useState(() => seleccionar(d ? d.estado : QUIETO));
  useEffect(() => {
    if (!d) return undefined;
    const f = () => { const v = sel.current(d.estado); setValor(() => v); };
    f();
    return d.suscribir(f);
  }, [d]);
  return valor;
}

/** `true` mientras la pantalla se desplaza. */
export const useMoviendo = () => useDesplazamiento(moviendo);
function moviendo(e) { return e.moviendo; }
