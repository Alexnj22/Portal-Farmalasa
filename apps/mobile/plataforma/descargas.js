// Descargar y abrir archivos — pendiente en la app (irá por expo-sharing y
// expo-web-browser). Lanza: que no se abra un documento no puede parecer éxito.
import { pendiente } from './_pendiente';

export function descargarArchivo() { throw pendiente('descargar un archivo'); }
export function abrirEnPestanaNueva() { throw pendiente('abrir un documento'); }
export async function abrirEnPestanaCuandoLlegue() { throw pendiente('abrir un documento'); }
