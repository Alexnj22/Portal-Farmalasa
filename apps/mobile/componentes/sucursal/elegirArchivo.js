// Elegir un archivo para el expediente de la sala (foto, galería o PDF) y
// dejarlo como lo espera `updateBranch`: `{ name, body: ArrayBuffer,
// contentType }`, el «archivo de la app» que `esArchivoPorSubir` reconoce.
// Valida contra lo que acepta el bucket `documents` (núcleo:
// `problemaDelArchivo`) antes y después de leerlo. Devuelve null si la persona
// cancela o el archivo no entra (y ya se le dijo por qué).
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { problemaDelArchivo, TIPOS_DEL_EXPEDIENTE } from '@nucleo/utils/expedienteDeSucursal';

export const extDe = (nombre, tipo) => {
  const e = String(nombre || '').split('.').pop()?.toLowerCase();
  if (e && e.length <= 5 && e !== String(nombre).toLowerCase()) return e;
  return { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[tipo] || 'jpg';
};

async function desdeFotos(camara) {
  const permiso = camara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) { Alert.alert('Sin permiso', camara ? 'La app necesita la cámara.' : 'La app necesita tus fotos.'); return null; }
  const op = { mediaTypes: ['images'], quality: 0.7 };
  const r = camara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const tipo = a.mimeType || 'image/jpeg';
  return { uri: a.uri, tipo, tamano: a.fileSize ?? null, nombre: a.fileName || `foto.${extDe('', tipo)}` };
}

async function desdeArchivos() {
  const r = await DocumentPicker.getDocumentAsync({ type: TIPOS_DEL_EXPEDIENTE, copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'application/pdf', tamano: a.size ?? null, nombre: a.name || 'documento.pdf' };
}

const OPCIONES = ['Tomar foto', 'Elegir de la galería', 'Elegir un archivo (PDF)'];
const preguntar = () => new Promise((resolve) => {
  const elegir = async (i) => { try { resolve(i === 2 ? await desdeArchivos() : i === 0 || i === 1 ? await desdeFotos(i === 0) : null); } catch { resolve(null); } };
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ options: [...OPCIONES, 'Cancelar'], cancelButtonIndex: 3 }, elegir);
  } else {
    Alert.alert('Adjuntar', '', [...OPCIONES.map((t, i) => ({ text: t, onPress: () => elegir(i) })), { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) }]);
  }
});

/** Lo elegido, sin leer todavía: `{ uri, tipo, tamano, nombre }`, o null. */
export async function elegirOrigen() {
  const f = await preguntar();
  if (!f) return null;
  const problema = problemaDelArchivo(f);
  if (problema) { Alert.alert('Ese archivo no entra', problema); return null; }
  return f;
}

/** Lee lo elegido y lo deja como archivo de la app, con el nombre base que se le dé. */
export async function leerComoArchivo(f, base) {
  const body = await (await fetch(f.uri)).arrayBuffer();
  const problema = problemaDelArchivo({ tipo: f.tipo, tamano: body.byteLength });
  if (problema) { Alert.alert('Ese archivo no entra', problema); return null; }
  return { name: `${base}.${extDe(f.nombre, f.tipo)}`, body, contentType: f.tipo };
}

/** Elegir y leer de una vez. */
export async function elegirArchivo(base) {
  const f = await elegirOrigen();
  return f ? leerComoArchivo(f, base) : null;
}
