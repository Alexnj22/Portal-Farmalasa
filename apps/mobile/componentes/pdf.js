// Papel → PDF → hoja de compartir, para toda la app. El HTML es el MISMO que
// imprime el portal (sale del núcleo); acá sólo se convierte y se reparte.
//
// El archivo lleva un nombre legible («Boleta Ana Pérez · 2a quincena sep
// 2026.pdf»): `printToFileAsync` lo deja con un UUID, y eso es lo que vería
// quien lo recibe por WhatsApp o lo guarda en Archivos.
//
// Devuelve `true` si la persona lo compartió de verdad (no si cerró la hoja),
// para que quien llama anote el egreso sólo cuando el dato salió.
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';
import * as Print from 'expo-print';
import { Directory, File, Paths } from 'expo-file-system';

const limpio = (s) => String(s || 'documento').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function compartirPdf({ html, nombre }) {
  const { uri } = await Print.printToFileAsync({ html });
  let final = uri;
  try {
    const destino = new File(Paths.cache, `${limpio(nombre)}.pdf`);
    if (destino.exists) destino.delete();
    new File(uri).move(destino);
    final = destino.uri;
  } catch { /* sin renombrar: se comparte con el nombre de la impresora */ }
  const r = await Share.share({ url: final, title: nombre });
  return r.action === Share.sharedAction;
}

/** AirPrint con el mismo papel. Lanza si la persona no pudo imprimir. */
export function imprimirPapel(html) {
  return Print.printAsync({ html });
}

/**
 * Guardar el PDF donde la persona elija (Archivos, iCloud, una carpeta del
 * teléfono). Devuelve `true` si quedó guardado; `false` si cerró el selector.
 */
export async function guardarPdf({ html, nombre }) {
  const { uri } = await Print.printToFileAsync({ html });
  let carpeta;
  try { carpeta = await Directory.pickDirectoryAsync(); } catch { return false; }
  if (!carpeta) return false;
  const destino = new File(carpeta, `${limpio(nombre)}.pdf`);
  if (destino.exists) destino.delete();
  new File(uri).copy(destino);
  return true;
}

/**
 * UNA sola pregunta para un papel: imprimir, compartir el PDF o guardarlo.
 * `alTerminar(accion)` recibe 'imprimir' | 'compartir' | 'guardar' cuando el
 * papel de verdad salió (para anotar el egreso), y nada si se canceló.
 */
export function ofrecerPapel({ html, nombre, titulo = 'El papel', alTerminar, alFallar }) {
  const opciones = ['Imprimir', 'Compartir PDF', 'Guardar', 'Cancelar'];
  const hacer = async (i) => {
    try {
      if (i === 0) { await imprimirPapel(html); alTerminar?.('imprimir'); }
      if (i === 1 && await compartirPdf({ html, nombre })) alTerminar?.('compartir');
      if (i === 2 && await guardarPdf({ html, nombre })) alTerminar?.('guardar');
    } catch (e) { alFallar?.(e); }
  };
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: opciones, cancelButtonIndex: 3 }, (i) => { if (i < 3) hacer(i); });
  } else {
    Alert.alert(titulo, undefined, [
      { text: 'Imprimir', onPress: () => hacer(0) },
      { text: 'Compartir PDF', onPress: () => hacer(1) },
      { text: 'Guardar', onPress: () => hacer(2) },
    ], { cancelable: true });
  }
}

/**
 * La misma pregunta para PDF que YA están escritos en el teléfono (los del
 * pedido, que salen de la imprenta del portal y no de un HTML): «Imprimir»
 * (AirPrint) · «Compartir PDF» · «Guardar en Archivos» · «Ahora no».
 * `archivos` = [{ uri, nombre }]. Con varios (un PDF por sala, como el
 * portal): se imprimen uno tras otro, se comparten juntos en un ZIP y se
 * guardan todos en la carpeta que se elija.
 */
export function ofrecerArchivosPdf({ archivos, titulo = 'El papel', mensaje, nombreZip = 'Pedido', alTerminar, alFallar }) {
  const lista = (archivos ?? []).filter((a) => a?.uri);
  if (!lista.length) return;
  const opciones = ['Imprimir', lista.length > 1 ? `Compartir los ${lista.length} PDF` : 'Compartir PDF', 'Guardar en Archivos', 'Ahora no'];
  const hacer = async (i) => {
    try {
      if (i === 0) {
        for (const a of lista) await Print.printAsync({ uri: a.uri });
        alTerminar?.('imprimir');
      }
      if (i === 1) {
        let uri = lista[0].uri;
        let nombre = lista[0].nombre;
        if (lista.length > 1) {
          const { zipSync } = await import('fflate');
          const zip = zipSync(Object.fromEntries(lista.map((a) => [`${limpio(a.nombre)}.pdf`, [new File(a.uri).bytesSync(), { level: 0 }]])));
          const f = new File(Paths.cache, `${limpio(nombreZip)}.zip`);
          if (f.exists) f.delete();
          f.create();
          f.write(zip);
          uri = f.uri; nombre = nombreZip;
        }
        const r = await Share.share({ url: uri, title: nombre });
        if (r.action === Share.sharedAction) alTerminar?.('compartir');
      }
      if (i === 2) {
        let carpeta;
        try { carpeta = await Directory.pickDirectoryAsync(); } catch { return; }
        if (!carpeta) return;
        for (const a of lista) {
          const destino = new File(carpeta, `${limpio(a.nombre)}.pdf`);
          if (destino.exists) destino.delete();
          new File(a.uri).copy(destino);
        }
        alTerminar?.('guardar');
      }
    } catch (e) { alFallar?.(e); }
  };
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, message: mensaje, options: opciones, cancelButtonIndex: 3 }, (i) => { if (i < 3) hacer(i); });
  } else {
    Alert.alert(titulo, mensaje, [
      { text: 'Imprimir', onPress: () => hacer(0) },
      { text: opciones[1], onPress: () => hacer(1) },
      { text: 'Guardar en Archivos', onPress: () => hacer(2) },
      { text: 'Ahora no', style: 'cancel' },
    ], { cancelable: true });
  }
}
