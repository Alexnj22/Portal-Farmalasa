// Actualizaciones por aire que se ven al PRIMER arranque (2026-11-05).
//
// Usuario: «ya con esto podremos hacer cambios siempre por aire?» — sí, pero
// por defecto expo-updates baja el paquete al abrir y lo usa la vez SIGUIENTE:
// había que cerrar y abrir dos veces, y eso se leía como «no llegó».
//
// Acá la app pregunta ella misma al abrir y al volver a primer plano (cada 15
// minutos como mucho) y, si bajó un paquete nuevo, recarga EN ESE MOMENTO —
// pero sólo si fue enseguida (hasta 12 s después de abrir o de volver):
// recargar a alguien en medio de un juego o de un formulario sería peor que
// esperar. Si tardó más, queda pendiente y se aplica al próximo regreso.
//
// La recarga tapa la pantalla con el color de fondo de la app mientras arranca
// el paquete nuevo (un instante), sin pantalla blanca.
import { AppState, Appearance, Platform } from 'react-native';
import * as Updates from 'expo-updates';

const ESPERA = 1500; // deja respirar el arranque antes de ir a la red
const VENTANA = 12_000; // hasta cuándo se puede recargar sin molestar
const CADA = 15 * 60 * 1000;

let instalado = false;
let ultima = 0;
let pendiente = false;
let desde = Date.now(); // el último «abrió o volvió»

const fondo = () => (Appearance.getColorScheme() === 'dark' ? '#0A090E' : '#F5F4F8');

async function recargar() {
  try { await Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: fondo(), fade: true } }); } catch { /* sigue con el de ahora */ }
}

async function revisar() {
  if (pendiente) { await recargar(); return; }
  if (Date.now() - ultima < CADA) return;
  ultima = Date.now();
  try {
    const hay = await Updates.checkForUpdateAsync();
    if (!hay.isAvailable) return;
    const r = await Updates.fetchUpdateAsync();
    // `isNew` es false si el paquete YA estaba bajado (2026-11-11): la propia
    // librería lo baja sola al arrancar (`checkAutomatically: ON_LOAD`) y casi
    // siempre le gana a esta revisión. Entonces nunca recargaba y el cambio
    // recién se veía al cerrar y abrir. Lo que importa es si el paquete que
    // corre es el último: si no lo es, se recarga igual.
    const ultimo = hay.manifest?.id ?? r.manifest?.id ?? null;
    if (!r.isNew && (!ultimo || ultimo === Updates.updateId)) return;
    if (Date.now() - desde <= VENTANA && AppState.currentState === 'active') await recargar();
    else pendiente = true;
  } catch { /* sin red o sin servidor: lo bajará el próximo arranque */ }
}

/** Se llama una vez desde la raíz. Devuelve cómo desinstalarlo. */
export function vigilarActualizacionesPorAire() {
  if (instalado || __DEV__ || Platform.OS === 'web' || !Updates.isEnabled) return () => {};
  instalado = true;
  const reloj = setTimeout(revisar, ESPERA);
  const sub = AppState.addEventListener('change', (estado) => {
    if (estado !== 'active') return;
    desde = Date.now();
    setTimeout(revisar, ESPERA);
  });
  return () => { clearTimeout(reloj); sub.remove(); instalado = false; };
}
