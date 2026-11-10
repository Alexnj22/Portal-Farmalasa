// Actualizaciones por aire que se ven al PRIMER arranque. Copia de la app de
// clientes (apps/clientes/lib/actualizacionAire.js, 2026-11-05), traída a la
// app del personal el 2026-11-10 a pedido del usuario: «sí, pon lo mismo».
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

const fondo = () => (Appearance.getColorScheme() === 'dark' ? '#000000' : '#F2F2F7');

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
    if (!r.isNew) return;
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
