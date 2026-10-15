// Los resortes de la app (2026-10-14), en un solo sitio.
//
// Android usa el sistema de movimiento de Material 3 Expressive: todo es un
// resorte definido por rigidez y razón de amortiguamiento. «Espacial» mueve
// cosas (posición, tamaño, forma) y puede pasarse apenas; «efectos» (color,
// opacidad, escala chica) no rebota. Los valores son los de la especificación
// (`MotionScheme.expressive`): rápido 1400, por defecto 700, lento 300.
// Reanimated pide `damping`, no la razón: damping = 2·ζ·√(k·m).
//
// iOS usa resortes críticos, cortos y SIN rebote — lo del sistema.
import { useContext, useEffect } from 'react';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { ContextoDesplazamiento } from '../lib/desplazamiento';

const resorte = (rigidez, razon) => ({ stiffness: rigidez, damping: 2 * razon * Math.sqrt(rigidez), mass: 1 });

export const M3 = {
  espacialRapido: resorte(1400, 0.9),
  espacial: resorte(700, 0.9),
  espacialLento: resorte(300, 0.9),
  efectosRapido: resorte(3800, 1),
  efectos: resorte(1600, 1),
};

export const IOS = {
  presion: resorte(900, 1),
  suelta: resorte(500, 1),
  entrada: resorte(260, 1),
};

/** El resorte de apretar y soltar algo, según el sistema. */
export const PRESION = Platform.OS === 'android' ? M3.efectosRapido : IOS.presion;
export const SUELTA = Platform.OS === 'android' ? M3.espacialRapido : IOS.suelta;

/**
 * `true` mientras la pantalla se desplaza, como VALOR COMPARTIDO de Reanimated
 * (2026-10-15). Es el mismo estado que `useMoviendo` (lib/desplazamiento.js),
 * pero no repinta a quien lo usa: lo leen los worklets —el reloj del material,
 * el giroscopio, la luz que pasa— en el hilo de la interfaz. Con el booleano,
 * la tarjeta de socio entera (dos lienzos de material, dos de luz y el logo)
 * se volvía a pintar dos veces por cada gesto de desplazamiento.
 * Fuera de una `Pantalla`, siempre `false`.
 */
export function useMoviendoValor() {
  const d = useContext(ContextoDesplazamiento);
  const v = useSharedValue(d ? d.estado.moviendo : false);
  useEffect(() => {
    if (!d) return undefined;
    // Sólo se escribe al CAMBIAR (cuatro avisos por gesto, dos cambios).
    let antes = null;
    const f = () => { const m = d.estado.moviendo; if (m !== antes) { antes = m; v.value = m; } };
    f();
    return d.suscribir(f);
  }, [d, v]);
  return v;
}
