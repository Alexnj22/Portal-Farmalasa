// Subir, reemplazar o quitar un documento del expediente de la sala, desde el
// teléfono. Va por el MISMO `updateBranch` del portal: el archivo se versiona
// (el anterior pasa a `old/` y queda como HISTÓRICO en `branch_documents`) y
// en `settings` se guarda la URL formato-public, nunca una firmada. Qué
// renglón se sube y qué acepta el bucket lo decide el núcleo
// (`expedienteDeSucursal`). Los de enfermería y los documentos propios siguen
// en el portal.
import { ActionSheetIOS, Alert, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ajustesConArchivo, problemaDelArchivo, seQuitaDesdeLaApp, seSubeDesdeLaApp, TIPOS_DEL_EXPEDIENTE } from '@nucleo/utils/expedienteDeSucursal';
import { sucursalConCambios } from '@nucleo/utils/edicionDeSucursal';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

const extDe = (nombre, tipo) => {
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

const preguntar = () => new Promise((resolve) => ActionSheetIOS.showActionSheetWithOptions(
  { options: ['Tomar foto', 'Elegir de la galería', 'Elegir un archivo (PDF)', 'Cancelar'], cancelButtonIndex: 3 },
  async (i) => {
    try { resolve(i === 3 ? null : i === 2 ? await desdeArchivos() : await desdeFotos(i === 0)); } catch { resolve(null); }
  },
));

function Accion({ texto, color, onPress }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export default function AccionesDelDocumento({ b, d }) {
  const updateBranch = useStaffStore((s) => s.updateBranch);
  if (!seSubeDesdeLaApp(d.id)) return null;

  const guardar = async (archivo, titulo) => {
    const base = sucursalConCambios(b);
    const settings = ajustesConArchivo(base.settings, d.id, archivo);
    if (!settings) return;
    trabajando(archivo ? 'Subiendo el documento…' : 'Quitando el documento…');
    try {
      await updateBranch(b.id, { ...base, settings });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, d.title);
    } catch (e) {
      fallo(archivo ? 'No se pudo subir' : 'No se pudo quitar', mensajeAmigable(e, 'Intenta de nuevo.'));
    }
  };

  const subir = async () => {
    const f = await preguntar();
    if (!f) return;
    const problema = problemaDelArchivo(f);
    if (problema) { Alert.alert('Ese archivo no entra', problema); return; }
    Alert.alert(d.url ? 'Reemplazar el documento' : 'Subir el documento',
      d.url ? `«${d.title}» se reemplaza; el anterior queda en el historial de la sucursal.` : `Se guarda «${d.title}» en el expediente de ${b.name}.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: d.url ? 'Reemplazar' : 'Subir', onPress: async () => {
          try {
            const body = await (await fetch(f.uri)).arrayBuffer();
            if (problemaDelArchivo({ tipo: f.tipo, tamano: body.byteLength })) { Alert.alert('Ese archivo no entra', problemaDelArchivo({ tipo: f.tipo, tamano: body.byteLength })); return; }
            await guardar({ name: `${d.id}.${extDe(f.nombre, f.tipo)}`, body, contentType: f.tipo }, d.url ? 'Documento reemplazado' : 'Documento guardado');
          } catch (e) { fallo('No se pudo leer el archivo', e?.message || ''); }
        } },
      ]);
  };

  const quitar = () => Alert.alert('Quitar el documento', `«${d.title}» deja de estar en el expediente; queda en el historial de la sucursal.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: () => guardar(null, 'Documento quitado') },
  ]);

  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <Accion texto={d.url ? 'Reemplazar' : 'Subir'} color={MARCA.azulClaro} onPress={subir} />
      {d.url && seQuitaDesdeLaApp(d.id) ? <Accion texto="Quitar" color={MARCA.rojo} onPress={quitar} /> : null}
    </View>
  );
}
