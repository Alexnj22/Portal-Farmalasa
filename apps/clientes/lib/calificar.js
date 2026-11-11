// Pedir la calificación con la ventanita nativa de Apple y Google
// (2026-11-11, `expo-store-review`). El sistema decide si de verdad la muestra
// (unas 3 veces al año por persona como mucho); nosotros sólo elegimos el
// momento: cuando la persona ya retiró una reserva, que es cuando la app le
// sirvió. Y desde acá no se vuelve a intentar antes de 120 días.
//
// El MÓDULO viaja en la compilación de la tienda; cuándo se pide se puede
// cambiar después por aire.
import * as StoreReview from 'expo-store-review';
import { guardar, leer } from './almacen';

const CLAVE = 'puntos_salud_calificacion_pedida';
const CADA_MS = 120 * 86400_000;
let enCurso = false;

export async function pedirCalificacion() {
  if (enCurso) return;
  enCurso = true;
  try {
    const ultima = Number(await leer(CLAVE).catch(() => 0)) || 0;
    if (Date.now() - ultima < CADA_MS) return;
    if (!(await StoreReview.isAvailableAsync().catch(() => false))) return;
    if (!(await StoreReview.hasAction().catch(() => false))) return;
    await guardar(CLAVE, Date.now()).catch(() => {});
    // Un respiro: que la pantalla termine de pintarse antes de la ventanita.
    setTimeout(() => { StoreReview.requestReview().catch(() => {}); }, 1500);
  } finally {
    enCurso = false;
  }
}
