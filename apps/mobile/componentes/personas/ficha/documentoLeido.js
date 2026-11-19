// Subir un documento del expediente Y leerlo, como el portal
// (`EmployeeFormModal`, subida de un documento): el archivo va a la carpeta que
// dice el núcleo (`carpetaDelDocumento`: un papel colectivo como el acuse del
// MTPS va a `compartidos/`) y, si tiene algo que leerse, pasa por la MISMA
// lectura (`analizarDocumento`, que recibe la ruta del archivo ya subido, no
// los bytes). Qué se toma de la lectura —vencimiento, anualidad del CSSP,
// certificado médico por año, número de la acreditación y los nombres de un
// papel colectivo— lo decide `resultadoDeLectura` (núcleo).
//
// Elegir sigue siendo `elegirOrigen`: el escáner del sistema, la galería o un
// PDF, validado contra lo que acepta el bucket.
import { Alert } from 'react-native';
import { getStoragePathFromUrl, subirArchivo } from '@nucleo/utils/storageFiles';
import { problemaDelArchivo } from '@nucleo/utils/expedienteDeSucursal';
import { analizarDocumento } from '@nucleo/data/ia';
import { carpetaDelDocumento, hayQueLeerDocumento, pedidoDeLectura, resultadoDeLectura } from '@nucleo/utils/lecturaDeDocumento';
import { elegirOrigen, extDe } from '../../sucursal/elegirArchivo';

const azar = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Elige, sube y lee. Devuelve null si se canceló o el archivo no entra (ya se
 * dijo por qué). Lanza si la subida falla; una lectura que falla NO lanza: el
 * archivo ya subió y se guarda sin lo leído, como en el portal.
 *
 * @param {object} p
 * @param {string} p.category
 * @param {string|number|null} p.empleadoId  null en un alta
 * @param {object} [p.anterior]  la entrada que había (no se hereda su vencimiento si tenía archivo)
 * @param {object} [p.ficha]     para no pisar un número de registro ya escrito
 * @param {(texto: string) => void} [p.alAvanzar]  «Leyendo el documento…»
 * @returns {Promise<null | { subida: { url: string, file_name: string, uploaded_at: string },
 *   expiryDate: string|null, numero: { campo: string, valor: string }|null, personas: string[] }>}
 */
export async function elegirSubirYLeer({ category, empleadoId, anterior, ficha, alAvanzar }) {
  const f = await elegirOrigen();
  if (!f) return null;
  const body = await (await fetch(f.uri)).arrayBuffer();
  const problema = problemaDelArchivo({ tipo: f.tipo, tamano: body.byteLength });
  if (problema) { Alert.alert('Ese archivo no entra', problema); return null; }
  const ext = extDe(f.nombre, f.tipo);
  alAvanzar?.('Subiendo el documento…');
  const url = await subirArchivo('documents', `${carpetaDelDocumento(category, empleadoId)}/${azar()}.${ext}`, body, { contentType: f.tipo });
  if (!url) throw new Error('La subida no devolvió una URL.');
  const stored = getStoragePathFromUrl(url);
  let lectura = null;
  if (stored && hayQueLeerDocumento(category)) {
    alAvanzar?.('Leyendo el documento…');
    try {
      lectura = await analizarDocumento(pedidoDeLectura(category, stored));
    } catch (e) {
      lectura = { data: null, error: e };
    }
  }
  return {
    subida: { url, file_name: f.nombre || `documento.${ext}`, uploaded_at: new Date().toISOString() },
    ...resultadoDeLectura({ category, anterior, lectura, ficha }),
  };
}
