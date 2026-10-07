// Compartir un archivo de los reportes de Torogoz: el `{ headers, rows, nombre }`
// que arma el núcleo (`distribucionReportes`), por la hoja del sistema, anotado
// como salida de datos del módulo `distribucion` (igual que el `exportCsv` del
// portal).
import { compartirCsv } from '../../../fiscal/csv';
import { fallo } from '../../../Progreso';

export async function compartirArchivo(archivo, detalle = {}) {
  try {
    await compartirCsv({ headers: archivo.headers, rows: archivo.rows, nombre: String(archivo.nombre).replace(/\.csv$/, ''), modulo: 'distribucion', detalle });
  } catch {
    fallo('No se pudo armar el archivo', 'Intenta de nuevo.');
  }
}
