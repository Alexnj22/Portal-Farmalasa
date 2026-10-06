// Papel → PDF → hoja de compartir, para toda la app. El HTML es el MISMO que
// imprime el portal (sale del núcleo); acá sólo se convierte y se reparte.
//
// El archivo lleva un nombre legible («Boleta Ana Pérez · 2a quincena sep
// 2026.pdf»): `printToFileAsync` lo deja con un UUID, y eso es lo que vería
// quien lo recibe por WhatsApp o lo guarda en Archivos.
//
// Devuelve `true` si la persona lo compartió de verdad (no si cerró la hoja),
// para que quien llama anote el egreso sólo cuando el dato salió.
import { Share } from 'react-native';
import * as Print from 'expo-print';
import { File, Paths } from 'expo-file-system';

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
