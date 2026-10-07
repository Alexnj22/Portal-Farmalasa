// Un paquete (ZIP) a la hoja de compartir: los archivos `{ name, texto }` que
// arma el núcleo, comprimidos con `fflate` —el portal usa `client-zip`, que
// necesita las secuencias del navegador—, guardados con su nombre y repartidos
// con la hoja del sistema. Es una salida de datos: se anota con
// `registrarEgreso` sólo si de verdad se compartió.
import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { strToU8, zipSync } from 'fflate';
import { registrarEgreso } from '@nucleo/data/egreso';

export async function compartirZip({ entradas, nombre, modulo, detalle = {} }) {
  const zip = zipSync(Object.fromEntries(entradas.map((e) => [e.name, strToU8(e.texto)])));
  const archivo = String(nombre).replace(/[\\/:*?"<>|]+/g, '-');
  const f = new File(Paths.cache, archivo);
  if (f.exists) f.delete();
  f.create();
  f.write(zip);
  const r = await Share.share({ url: f.uri, title: archivo });
  if (r.action === Share.sharedAction) {
    registrarEgreso(modulo, { formato: 'zip', filas: entradas.length, detalle: { archivo, via: 'app', ...detalle } });
    return true;
  }
  return false;
}
