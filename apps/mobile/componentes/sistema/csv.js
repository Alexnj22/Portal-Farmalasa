// Un CSV a la hoja de compartir — el mismo texto que descarga el portal
// (`buildCsvText`: BOM + `;` + CRLF, para que Excel en es-SV lo abra bien),
// escrito en un archivo con nombre legible. Es una salida de datos: se anota
// con `registrarEgreso` sólo si la persona lo compartió de verdad.
import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { buildCsvText } from '@nucleo/utils/csvExport';
import { registrarEgreso } from '@nucleo/data/egreso';

const limpio = (s) => String(s || 'datos').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function compartirCsv({ headers, rows, nombre, modulo }) {
  const archivo = new File(Paths.cache, `${limpio(nombre)}.csv`);
  if (archivo.exists) archivo.delete();
  archivo.create();
  archivo.write(buildCsvText(headers, rows));
  const r = await Share.share({ url: archivo.uri, title: nombre });
  if (r.action !== Share.sharedAction) return false;
  registrarEgreso(modulo, { formato: 'csv', filas: rows.length, detalle: { archivo: `${limpio(nombre)}.csv`, via: 'app' } });
  return true;
}
