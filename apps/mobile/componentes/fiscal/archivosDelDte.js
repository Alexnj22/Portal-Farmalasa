// Los archivos guardados de un DTE (su JSON y su PDF) a la hoja de compartir:
// uno, o los dos en un ZIP — lo que en el portal son los botones de la tabla
// «IVA que nos retuvieron» (`bajarArchivo` / `descargarPaqueteDteVenta`). El
// PDF ya está guardado (lo armó quien lo emitió): no se vuelve a armar. Es una
// salida de datos y se anota con `registrarEgreso('dte_venta')`, como el portal.
import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { registrarEgreso } from '@nucleo/data/egreso';

const limpio = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '-');
export const baseDelDte = (r) => String(r?.codigo_generacion || r?.erp_invoice_id || 'dte').toUpperCase();

async function bajar(ruta) {
  const url = await getSignedFileUrl(ruta);
  if (!url) throw new Error('No se pudo abrir el archivo guardado.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo bajar el archivo (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function compartirBytes(bytes, nombre) {
  const f = new File(Paths.cache, limpio(nombre));
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  const r = await Share.share({ url: f.uri, title: nombre });
  return r.action === Share.sharedAction;
}

/** Uno de los dos archivos: `ext` es 'json' o 'pdf'. */
export async function compartirArchivoDelDte(r, ext) {
  const ruta = ext === 'json' ? r?.json_path : r?.pdf_path;
  if (!ruta) throw new Error(`El ${ext.toUpperCase()} de este documento no está guardado.`);
  const nombre = `${baseDelDte(r)}.${ext}`;
  if (await compartirBytes(await bajar(ruta), nombre)) {
    registrarEgreso('dte_venta', { formato: ext, filas: 1, detalle: { documento: baseDelDte(r), via: 'app' } });
  }
}

/** Los dos en un ZIP. */
export async function compartirPaqueteDelDte(r) {
  const base = baseDelDte(r);
  const entradas = {};
  for (const [ext, ruta] of [['json', r?.json_path], ['pdf', r?.pdf_path]]) {
    if (ruta) entradas[`${base}.${ext}`] = await bajar(ruta);
  }
  if (!Object.keys(entradas).length) throw new Error('Este documento no tiene archivos guardados.');
  if (await compartirBytes(zipSync(entradas), `${base}.zip`)) {
    registrarEgreso('dte_venta', { formato: 'zip', filas: Object.keys(entradas).length, detalle: { documento: base, via: 'app' } });
  }
}
