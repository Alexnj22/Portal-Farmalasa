// Fotos de evidencia: tomar con la cámara o elegir de la galería, hasta
// `max`, con su miniatura y una ✕ para quitarla. Entrega `[{ uri, tipo,
// nombre }]`; la subida la hace quien envía (`subirFotos`), y sólo al enviar:
// una foto elegida no es una foto guardada.
import { Alert, Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

const OPCIONES = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };

async function elegir(desdeCamara) {
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.');
    return null;
  }
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(OPCIONES) : await ImagePicker.launchImageLibraryAsync({ ...OPCIONES, selectionLimit: 1 });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'image/jpeg', nombre: a.fileName || `foto-${Date.now()}.jpg` };
}

export default function Fotos({ fotos, onCambiar, max = 3 }) {
  const agregar = async (camara) => {
    const f = await elegir(camara);
    if (f) { Haptics.selectionAsync().catch(() => {}); onCambiar([...fotos, f].slice(0, max)); }
  };
  const Boton = ({ texto, camara }) => (
    <Pressable onPress={() => agregar(camara)} disabled={fotos.length >= max}
      style={({ pressed }) => ({ flex: 1, minHeight: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1.2, borderColor: MARCA.azulClaro, opacity: fotos.length >= max ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      {fotos.length ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {fotos.map((f, i) => (
            <View key={f.uri}>
              <Image source={{ uri: f.uri }} style={{ width: 84, height: 84, borderRadius: 12 }} />
              <Pressable onPress={() => onCambiar(fotos.filter((_, j) => j !== i))} hitSlop={8}
                style={{ position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Boton texto="Tomar foto" camara />
        <Boton texto="De la galería" />
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fotos.length} de {max}</Text>
    </View>
  );
}

/** Sube las fotos y devuelve sus URL (formato público, como guarda la base). */
export async function subirFotos(fotos, { bucket, carpeta }) {
  const urls = [];
  for (const [i, f] of fotos.entries()) {
    const ext = (f.nombre.split('.').pop() || 'jpg').toLowerCase();
    const datos = await (await fetch(f.uri)).arrayBuffer();
    const url = await subirArchivo(bucket, `${carpeta}/${Date.now()}-${i}.${ext}`, datos, { contentType: f.tipo })
      .catch((e) => { throw new Error(`No se pudo subir la foto: ${e.message}`); });
    if (url) urls.push(url);
  }
  return urls;
}
