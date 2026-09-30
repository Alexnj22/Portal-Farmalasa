// Abrir y descargar archivos en el teléfono.
//
// Abrir va por el visor del sistema (`expo-web-browser`: SFSafariViewController
// en iPhone, Custom Tabs en Android): el PDF de una factura o una boleta se ve
// dentro de la app y se comparte o guarda con su propio botón. Descargar a un
// archivo todavía no existe y lo DICE (lanza): que no se guarde un documento
// no puede parecer éxito.
import * as WebBrowser from 'expo-web-browser';
import { pendiente } from './_pendiente';

const abrir = (url) => WebBrowser.openBrowserAsync(url, {
  presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  dismissButtonStyle: 'close',
});

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
