// Abrir y descargar archivos en el teléfono.
//
// Abrir iba por el visor del sistema (`expo-web-browser`: SFSafariViewController
// en iPhone, Custom Tabs en Android): el PDF de una factura o una boleta se ve
// dentro de la app y se comparte o guarda con su propio botón. Descargar a un
// archivo todavía no existe y lo DICE (lanza): que no se guarde un documento
// no puede parecer éxito.
//
// Desde el 2026-11-12 «abrir» va al visor PROPIO (`app/visor.js`), dentro de la
// app (usuario: «abre un navegador, no se abre dentro de la app»). Sólo lo que
// el visor no puede mostrar en Android (un .docx, una hoja de cálculo) sigue
// yendo al visor del sistema.
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { pendiente } from './_pendiente';

const extensionDe = (url) => (String(url || '').split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const SE_VE_EN_ANDROID = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);

const abrir = (url) => {
  if (Platform.OS === 'ios' || SE_VE_EN_ANDROID.has(extensionDe(url))) {
    router.push({ pathname: '/visor', params: { url } });
    return Promise.resolve();
  }
  return WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    dismissButtonStyle: 'close',
  });
};

export function descargarArchivo() { throw pendiente('descargar un archivo'); }

export async function abrirEnPestanaNueva(url) {
  if (!url) throw new Error('No hay documento que abrir.');
  await abrir(url);
}

/** Recibe la PROMESA de la URL (firmada en el momento) y abre al llegar. */
export async function abrirEnPestanaCuandoLlegue(urlPromesa) {
  const url = await urlPromesa;
  if (!url) throw new Error('No se pudo abrir el documento.');
  await abrir(url);
}
