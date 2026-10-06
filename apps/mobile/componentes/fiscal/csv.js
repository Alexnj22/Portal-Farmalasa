// Un CSV a la hoja de compartir: el MISMO texto que descarga el portal
// (`buildCsvText`, núcleo: separador `;`, BOM y CRLF, que es lo que abre bien
// Excel y lo que compara el anexo), guardado con su nombre y repartido con la
// hoja del sistema. Es una salida de datos: se anota con `registrarEgreso`
// sólo si de verdad se compartió.
import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { buildCsvText } from '@nucleo/utils/csvExport';
import { registrarEgreso } from '@nucleo/data/egreso';

export async function compartirCsv({ headers, rows, nombre, modulo, detalle = {} }) {
  const archivo = `${String(nombre).replace(/[\\/:*?"<>|]+/g, '-')}.csv`;
  const f = new File(Paths.cache, archivo);
  if (f.exists) f.delete();
  f.create();
  f.write(buildCsvText(headers, rows));
  const r = await Share.share({ url: f.uri, title: archivo });
  if (r.action === Share.sharedAction) {
    registrarEgreso(modulo, { formato: 'csv', filas: Array.isArray(rows) ? rows.length : null, detalle: { archivo, via: 'app', ...detalle } });
    return true;
  }
  return false;
}
