// Fotos del cliente (2026-10-12): la receta de una reserva, una foto en el
// chat y la foto de perfil. Las tres van al mismo bucket privado y por el
// mismo camino:
//
//   1. elegir (cámara o galería) y achicar: el lado mayor a 1600 px, JPEG al
//      70 %. Una foto del teléfono pesa 3–5 MB; así queda en ~300 kB y sube
//      con señal mala;
//   2. pedirle al servidor una URL de subida firmada (`*_subir_url`). La RUTA
//      la decide el servidor, nunca la app;
//   3. subir el archivo a esa URL y confirmarlo con la acción del caso.
//
// Nunca lanza: devuelve `{ ok:false, mensaje }` con una frase que se puede mostrar.
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FS from 'expo-file-system/legacy';
import { sinBloquear } from './bloqueo';

const LADO_MAYOR = 1600;

/** «Tomar foto» o «Elegir de la galería». Devuelve 'camara' | 'galeria' | null. */
export function preguntarOrigen(titulo = 'Agregar foto', mensaje) {
  return new Promise((listo) => {
    Alert.alert(titulo, mensaje, [
      { text: 'Tomar foto', onPress: () => listo('camara') },
      { text: 'Elegir de la galería', onPress: () => listo('galeria') },
      { text: 'Cancelar', style: 'cancel', onPress: () => listo(null) },
    ], { cancelable: true, onDismiss: () => listo(null) });
  });
}

/**
 * Abre la cámara o la galería y devuelve `{ uri }` de la foto ya achicada,
 * `null` si la persona canceló, o `{ error }` con una frase.
 */
export async function elegirFoto(origen) {
  if (Platform.OS === 'web') return { error: 'Las fotos se suben desde el teléfono.' };
  // La cámara, la galería y sus permisos sacan a la app del primer plano: con
  // el bloqueo encendido, eso no es «irse» (lib/bloqueo, 2026-10-14).
  return sinBloquear(() => elegirFotoSinBloqueo(origen));
}

async function elegirFotoSinBloqueo(origen) {
  try {
    if (origen === 'camara') {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return { error: 'Permite el uso de la cámara en los ajustes del teléfono.' };
    } else {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted && p.accessPrivileges !== 'limited') return { error: 'Permite el acceso a tus fotos en los ajustes del teléfono.' };
    }
    const opciones = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
    const r = origen === 'camara' ? await ImagePicker.launchCameraAsync(opciones) : await ImagePicker.launchImageLibraryAsync(opciones);
    if (r.canceled || !r.assets?.[0]?.uri) return null;
    const a = r.assets[0];
    // Sólo se achica si hace falta (nunca se agranda una foto chica).
    const ancho = Number(a.width) || 0, alto = Number(a.height) || 0;
    const ctx = ImageManipulator.manipulate(a.uri);
    if (Math.max(ancho, alto) > LADO_MAYOR) ctx.resize(ancho >= alto ? { width: LADO_MAYOR } : { height: LADO_MAYOR });
    const imagen = await ctx.renderAsync();
    const chica = await imagen.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: chica.uri, ancho: chica.width, alto: chica.height };
  } catch {
    return { error: 'No se pudo abrir la foto. Intenta de nuevo.' };
  }
}

/**
 * Sube una foto ya achicada: pide la URL firmada con `accionUrl`/`datos`, sube
 * el archivo y devuelve `{ ok, ruta }` para confirmarlo con la acción del caso.
 */
export async function subirFoto(pedir, accionUrl, datos, uri) {
  const r = await pedir(accionUrl, datos);
  if (!r?.ok || !r.url) return { ok: false, mensaje: r?.mensaje ?? 'No se pudo preparar la subida. Revisa tu conexión.' };
  try {
    const s = await FS.uploadAsync(r.url, uri, {
      httpMethod: 'PUT',
      uploadType: FS.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    });
    if (s.status < 200 || s.status >= 300) return { ok: false, mensaje: 'La foto no se pudo subir. Intenta de nuevo.' };
    return { ok: true, ruta: r.ruta };
  } catch {
    return { ok: false, mensaje: 'La foto no se pudo subir. Revisa tu conexión e intenta de nuevo.' };
  }
}

/** La receta de una reserva (o de todo su pedido): subir y confirmar. */
export async function subirReceta(pedir, reservaId, uri) {
  const s = await subirFoto(pedir, 'receta_subir_url', { reserva_id: reservaId }, uri);
  if (!s.ok) return s;
  const c = await pedir('receta_confirmar', { reserva_id: reservaId, ruta: s.ruta });
  return c?.ok ? { ok: true } : { ok: false, mensaje: c?.mensaje ?? 'No se pudo enviar la receta. Intenta de nuevo.' };
}
