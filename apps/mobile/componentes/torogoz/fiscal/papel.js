// Los papeles de Torogoz en el teléfono: el ticket (venta, recibo, liquidación,
// cierre, estado de cuenta), la representación gráfica del documento y su
// archivo JSON. Lo que dicen sale del núcleo —`ticketDe…` y `documentoHtml`,
// leídos del JSON firmado—; acá sólo se convierten y se reparten.
//
// El ticket del portal va a la ticketera de la computadora. El teléfono no la
// tiene: lo manda a AirPrint o lo comparte como PDF, con el MISMO maquetador
// (`construirTicketHtml`) que pinta la vista previa del portal.
//
// Cada salida se ANOTA (`registrarEgreso`), y sólo cuando el dato salió de
// verdad: cerrar la hoja de compartir no es compartir.
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';
import * as Print from 'expo-print';
import { File, Paths } from 'expo-file-system';
import { construirTicketHtml, conCodigosDibujados } from '@nucleo/utils/ticketPrint';
import { jsonParaElCliente, nombreDelPdf, urlConsultaPublica } from '@nucleo/utils/distribucionDocumento';
import { documentoHtml } from '@nucleo/utils/distribucionDocumentoHtml';
import { MARCA_PAPEL } from '@nucleo/utils/distribucionMarca';
import { enviarCorreoDocumento } from '@nucleo/data/distribucion';
import { registrarEgreso } from '@nucleo/data/egreso';
import { compartirPdf, imprimirPapel } from '../../pdf';

/** El HTML del ticket, con sus códigos dibujados si los lleva. */
export async function htmlDelTicket(ticket) {
  return construirTicketHtml(await conCodigosDibujados(ticket));
}

/** La representación gráfica del documento (carta), en HTML para imprimir. */
export const htmlDelDocumento = (dte) => documentoHtml(dte, { marca: MARCA_PAPEL, urlConsulta: urlConsultaPublica(dte) });

const sinExtension = (n) => String(n).replace(/\.pdf$/i, '');

/** Comparte el documento como PDF. Devuelve true si salió. */
export async function compartirDocumento(dte) {
  const ok = await compartirPdf({ html: htmlDelDocumento(dte), nombre: sinExtension(nombreDelPdf(dte)) });
  if (ok) registrarEgreso('distribucion', { formato: 'pdf', filas: 1, detalle: { dte_id: dte.id, numero_control: dte.numero_control, via: 'app' } });
  return ok;
}

export async function imprimirDocumentoCarta(dte) {
  await imprimirPapel(htmlDelDocumento(dte));
  registrarEgreso('distribucion', { formato: 'impresion', filas: 1, detalle: { dte_id: dte.id, numero_control: dte.numero_control, via: 'app' } });
}

/** El ticket: a la impresora (AirPrint) o compartido como PDF. */
export async function imprimirTicket(ticket) {
  await imprimirPapel(await htmlDelTicket(ticket));
}
export async function compartirTicket(ticket, nombre) {
  return compartirPdf({ html: await htmlDelTicket(ticket), nombre });
}

/** El archivo JSON que se le entrega al cliente: el documento firmado, con su sello. */
export async function compartirJson(dte) {
  const nombre = `${String(dte.codigo_generacion).toUpperCase()}.json`;
  const archivo = new File(Paths.cache, nombre);
  if (archivo.exists) archivo.delete();
  archivo.create();
  archivo.write(JSON.stringify(jsonParaElCliente(dte), null, 2));
  const r = await Share.share({ url: archivo.uri, title: nombre });
  const ok = r.action === Share.sharedAction;
  if (ok) registrarEgreso('distribucion', { formato: 'json', filas: 1, detalle: { dte_id: dte.id, numero_control: dte.numero_control, via: 'app' } });
  return ok;
}

/**
 * Manda el documento al cliente por correo: el PDF se arma acá (en el teléfono,
 * con la hoja de `documentoHtml`) y viaja en base64, igual que desde el portal.
 */
export async function enviarDocumentoPorCorreo(dte, { destinatario = null } = {}) {
  const { base64 } = await Print.printToFileAsync({ html: htmlDelDocumento(dte), base64: true });
  if (!base64) throw new Error('No se pudo armar el PDF del documento.');
  return enviarCorreoDocumento(dte.id, base64, { destinatario });
}

/**
 * Una hoja de opciones del sistema. `opciones`: [{ texto, accion, destructiva? }].
 * En Android, la alerta (que admite tres botones: con más, usar la lista).
 */
export function elegir(titulo, opciones) {
  if (Platform.OS !== 'web') {   // en Android, la hoja de componentes/HojasAndroid
    const textos = [...opciones.map((o) => o.texto), 'Cancelar'];
    const destructiva = opciones.findIndex((o) => o.destructiva);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: titulo, options: textos, cancelButtonIndex: textos.length - 1, ...(destructiva >= 0 ? { destructiveButtonIndex: destructiva } : {}) },
      (i) => { if (i < opciones.length) opciones[i].accion(); },
    );
    return;
  }
  Alert.alert(titulo, undefined, [
    ...opciones.slice(0, 2).map((o) => ({ text: o.texto, style: o.destructiva ? 'destructive' : 'default', onPress: o.accion })),
    { text: 'Cancelar', style: 'cancel' },
  ]);
}
