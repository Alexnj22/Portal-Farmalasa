// Fotos de evidencia: tomar con la cámara o elegir de la galería, hasta
// `max`, con su miniatura y una ✕ para quitarla. Entrega `[{ uri, tipo,
// nombre }]`; la subida la hace quien envía (`subirFotos`), y sólo al enviar:
// una foto elegida no es una foto guardada.
//
// Con `pdf`, además se puede adjuntar un PDF (la boleta de incapacidad: el
// portal acepta «PDF, JPG o PNG»). El PDF entra en la misma lista con su
// `tipo` y se muestra como una tarjeta con el nombre, no como miniatura.
//
// Con `documento` (una boleta, un comprobante), «Tomar foto» abre el escáner
// del sistema (`escanearDocumento`): encuentra el papel, deja mover las cuatro
// esquinas y lo endereza, como el editor del portal. Sin el módulo nativo cae
// a la cámara de siempre. De la galería, en Android se puede recortar.
// Pedido del usuario (2026-11-17, Meter dinero): los botones «casi invisibles»
// (contorno fino) y la foto que no se ajustaba.
import { Alert, Image, Platform, Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL, MARCA, tintaSobre } from '../inicio/marca';
import IconoFijo from '../IconoFijo';
import { iconoDe } from '../../tema/iconos';
import { escanearDocumento } from '../escanearDocumento';

const OPCIONES = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };

async function elegir(desdeCamara, documento = false) {
  if (desdeCamara && documento) {
    const r = await escanearDocumento();
    if (r.disponible) return r.foto;
  }
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.');
    return null;
  }
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(OPCIONES) : await ImagePicker.launchImageLibraryAsync({ ...OPCIONES, selectionLimit: 1,
    // Android trae un recorte libre; el del iPhone es cuadrado y cortaría la boleta.
    allowsEditing: documento && Platform.OS === 'android' });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'image/jpeg', nombre: a.fileName || `foto-${Date.now()}.jpg` };
}

const TOPE_PDF = 10 * 1024 * 1024;

async function elegirPdf() {
  const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  if (a.size != null && a.size > TOPE_PDF) { Alert.alert('Ese archivo no entra', 'El archivo pasa de 10 MB.'); return null; }
  return { uri: a.uri, tipo: a.mimeType || 'application/pdf', nombre: a.name || `documento-${Date.now()}.pdf` };
}

const esPdf = (f) => String(f?.tipo || '').includes('pdf') || /\.pdf$/i.test(String(f?.nombre || ''));

export default function Fotos({ fotos, onCambiar, max = 3, pdf = false, documento = false }) {
  const agregar = async (camara) => {
    const f = camara === 'pdf' ? await elegirPdf() : await elegir(camara, documento);
    // Con una sola foto de documento, la nueva REEMPLAZA a la anterior (el
    // freno del monto pide «otra foto»: antes había que quitarla primero).
    if (f) { Haptics.selectionAsync().catch(() => {}); onCambiar(documento && max === 1 ? [f] : [...fotos, f].slice(0, max)); }
  };
  const lleno = !(documento && max === 1) && fotos.length >= max;
  // El primero va relleno (la acción de siempre) y los demás tonales: los dos
  // se leen en claro y en oscuro, con su ícono.
  const Boton = ({ texto, camara, icono, principal }) => {
    const fondo = principal ? MARCA.azul : FONDO_CONTROL;
    const tinta = principal ? tintaSobre(MARCA.azul) : colorSistema.texto;
    return (
      <Pressable onPress={() => agregar(camara)} disabled={lleno} accessibilityRole="button"
        style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: 16, paddingHorizontal: 10, flexDirection: 'row', gap: 8,
          alignItems: 'center', justifyContent: 'center', backgroundColor: fondo,
          opacity: lleno ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <IconoFijo name={iconoDe(icono)} size={20} color={principal ? tinta : MARCA.azulClaro} />
        <Text numberOfLines={1} style={{ color: tinta, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
      </Pressable>
    );
  };
  const grande = documento && max === 1;
  return (
    <View style={{ gap: 10 }}>
      {fotos.length ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {fotos.map((f, i) => (
            <View key={f.uri} style={grande ? { flex: 1 } : null}>
              {esPdf(f) ? (
                <View style={{ width: 84, height: 84, borderRadius: 12, padding: 6, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: colorSistema.acentoTinte, borderWidth: 0.5, borderColor: colorSistema.separador }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '800' }}>PDF</Text>
                  <Text numberOfLines={2} style={{ color: colorSistema.texto2, fontSize: 10, textAlign: 'center' }}>{f.nombre}</Text>
                </View>
              ) : grande ? (
                <Image source={{ uri: f.uri }} resizeMode="contain"
                  style={{ width: '100%', height: 220, borderRadius: 14, backgroundColor: FONDO_CONTROL }} />
              ) : <Image source={{ uri: f.uri }} style={{ width: 84, height: 84, borderRadius: 12 }} />}
              <Pressable onPress={() => onCambiar(fotos.filter((_, j) => j !== i))} hitSlop={8}
                style={{ position: 'absolute', top: grande ? 8 : -6, right: grande ? 8 : -6, width: grande ? 32 : 24, height: grande ? 32 : 24, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Boton texto={grande && fotos.length ? 'Otra foto' : 'Tomar foto'} camara icono={documento ? 'Escaner' : 'Camara'} principal />
        <Boton texto="Galería" icono="Galeria" />
        {pdf ? <Boton texto="PDF" camara="pdf" icono="ReceiptText" /> : null}
      </View>
      {max > 1 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fotos.length} de {max}</Text> : null}
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
