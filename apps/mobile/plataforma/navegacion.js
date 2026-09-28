// La navegación — la versión del TELÉFONO, sobre expo-router.
import { router } from 'expo-router';

export function irA(ruta) { router.replace(ruta); }
/** En la web recarga la página; acá vuelve a la entrada, que relee todo. */
export function recargar() { router.replace('/'); }
/** La dirección pública del portal, para enlaces que se abren en otro equipo. */
export const origen = () => 'https://portal.farmasalud.lat';
