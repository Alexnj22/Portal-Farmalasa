// El escáner de documentos del SISTEMA: el de Notas en el iPhone (VisionKit) y
// el de Google en Android (ML Kit). Encuentra el papel en vivo, deja mover las
// cuatro esquinas, lo endereza y devuelve el JPEG ya recortado.
//
// Pedido del usuario (2026-10-22): «al subir una foto, no me permite editarla
// para confirmar las esquinas». La app subía la foto tal cual salía de la
// cámara; el portal sí tiene su editor (`EditorDeDocumento`). Se eligió el del
// sistema y no copiar el del portal: ve las esquinas mientras se apunta y
// endereza al instante, y como la app no tiene actualización por el aire
// (no hay expo-updates) las dos opciones pedían versión nueva igual.
//
// Es un módulo NATIVO: no existe en Expo Go, en la web ni en una versión de la
// app anterior a la que lo trae. Por eso se pide recién al usarlo y, si no
// está, `escanearDocumento` devuelve `{ disponible: false }` y quien llama cae
// a la cámara de siempre — nunca deja a nadie sin poder adjuntar un papel.

/**
 * @returns {Promise<{disponible: false} | {disponible: true, foto: {uri, tipo, tamano, nombre} | null}>}
 *   `foto: null` = la persona canceló.
 */
export async function escanearDocumento() {
  let escaner;
  try {
    // `require` y no `import`: el módulo lanza AL CARGARSE si la parte nativa
    // no está (`TurboModuleRegistry.getEnforcing`).
    escaner = require('react-native-document-scanner-plugin').default;
  } catch {
    return { disponible: false };
  }
  let r;
  try {
    // Una página: cada documento del expediente es un archivo (el DUI se sube
    // por caras). Calidad 85: el lector del DUI lee igual y pesa la mitad.
    r = await escaner.scanDocument({ maxNumDocuments: 1, croppedImageQuality: 85 });
  } catch (e) {
    // Android sin servicios de Google, o el escáner que no pudo abrir: se sigue
    // con la cámara. Cancelar no pasa por acá (vuelve con `status: 'cancel'`).
    console.warn('escanearDocumento:', e?.message || e);
    return { disponible: false };
  }
  const ruta = r?.status === 'cancel' ? null : r?.scannedImages?.[0];
  if (!ruta) return { disponible: true, foto: null };
  const uri = /^[a-z]+:\/\//i.test(ruta) ? ruta : `file://${ruta}`;
  return { disponible: true, foto: { uri, tipo: 'image/jpeg', tamano: null, nombre: 'documento.jpg' } };
}
