// El ZIP del período de facturas de compra desde el teléfono: los archivos los
// trae el núcleo (`archivosDelZipDelPeriodo`, el mismo manifiesto, reintentos y
// nota de errores que la descarga masiva del portal); acá se comprimen con
// `fflate` —el portal usa `client-zip`, que necesita el navegador— y salen por
// la hoja de compartir. Se anota sólo si de verdad se compartió.
import { Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';
import { anotarPaqueteDeCompra, anotarZipCompartido, archivosDelPaqueteDeCompra, archivosDelZipDelPeriodo, nombreZipFacturas } from '@nucleo/data/facturasCompra';

export async function compartirZipDeFacturas(ids, { onProgress, contexto = {} } = {}) {
  const r = await archivosDelZipDelPeriodo(ids, { onProgress });
  // Los PDF ya vienen comprimidos: nivel 0 ahorra minutos de CPU en el teléfono.
  const zip = zipSync(Object.fromEntries(r.entradas.map((e) => [e.name, [e.bytes, { level: e.name.endsWith('.pdf') ? 0 : 6 }]])));
  const f = new File(Paths.cache, nombreZipFacturas());
  if (f.exists) f.delete();
  f.create();
  f.write(zip);
  const s = await Share.share({ url: f.uri, title: f.name });
  if (s.action === Share.sharedAction) anotarZipCompartido({ ids, total: r.total, incluidos: r.incluidos, fallidos: r.fallidos, contexto: { via: 'app', ...contexto } });
  return { ...r, compartido: s.action === Share.sharedAction };
}

/**
 * El paquete de UN documento (JSON + PDF, y la prueba de anulación si la
 * tiene), como «Descargar» del portal, a la hoja de compartir.
 */
export async function compartirPaqueteDeCompra(row) {
  const { baseName, entradas } = await archivosDelPaqueteDeCompra(row);
  const zip = zipSync(Object.fromEntries(entradas.map((e) => [e.name, [e.bytes, { level: e.name.endsWith('.pdf') ? 0 : 6 }]])));
  const f = new File(Paths.cache, `${String(baseName).replace(/[\\/:*?"<>|]+/g, '-')}.zip`);
  if (f.exists) f.delete();
  f.create();
  f.write(zip);
  const s = await Share.share({ url: f.uri, title: f.name });
  if (s.action === Share.sharedAction) anotarPaqueteDeCompra(row, entradas.length, { via: 'app' });
  return s.action === Share.sharedAction;
}
