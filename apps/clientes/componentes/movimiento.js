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
import { Platform } from 'react-native';

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
