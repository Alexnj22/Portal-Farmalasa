// La foto de un producto: se ve grande, se toca para verla entera y —con
// permiso del catálogo— se cambia tomándola o eligiéndola de la galería. El
// guardado es el del portal (`ExpandedProductRow.handlePhotoConfirm`): se
// reduce a 800 px en JPEG, se sube a `product-photos/<id>.jpg` (pisando la
// anterior) y se guarda la URL pública con un sello de tiempo para que nadie
// vea la vieja en caché.
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Modal, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { updateProductFoto } from '@nucleo/data/productos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

async function elegir(desdeCamara) {
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.');
    return null;
  }
  const op = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  return r.assets[0].uri;
}

export default function Foto({ productId, url, puedeCambiar, onCambiada }) {
  const [viendo, setViendo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  const cambiar = async (desdeCamara) => {
    const uri = await elegir(desdeCamara);
    if (!uri) return;
    setSubiendo(true);
    trabajando('Guardando la foto…');
    try {
      const ref = await ImageManipulator.manipulate(uri).resize({ width: 800 }).renderAsync();
      const hecha = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      const datos = await (await fetch(hecha.uri)).arrayBuffer();
      const publica = await subirArchivo('product-photos', `${productId}.jpg`, datos, { upsert: true, contentType: 'image/jpeg' });
      const conSello = `${publica}?t=${Date.now()}`;
      const { error } = await updateProductFoto(productId, conSello);
      if (error) throw error;
      onCambiada?.(conSello);
      listo('Foto guardada', 'Imagen actualizada.');
    } catch (e) {
      fallo('No se pudo guardar la foto', mensajeAmigable(e));
    } finally {
      setSubiendo(false);
    }
  };
  const menu = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Tomar foto', 'Elegir de la galería', 'Cancelar'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) cambiar(true); else if (i === 1) cambiar(false); },
    );
  };

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable onPress={() => (url ? setViendo(true) : puedeCambiar ? menu() : null)} onLongPress={puedeCambiar ? menu : undefined}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <View style={{ width: 200, height: 200, borderRadius: 24, overflow: 'hidden', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
          borderWidth: url ? 0 : 1.5, borderStyle: 'dashed', borderColor: colorSistema.separador }}>
          {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : (
            <Text style={{ color: '#8a8a8a', fontSize: 14, fontWeight: '600' }}>{puedeCambiar ? 'Agregar foto' : 'Sin foto'}</Text>
          )}
          {subiendo ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View> : null}
        </View>
      </Pressable>
      {puedeCambiar ? (
        <Pressable onPress={menu} disabled={subiendo} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{url ? 'Cambiar foto' : 'Tomar o elegir foto'}</Text>
        </Pressable>
      ) : null}
      <Modal visible={viendo} animationType="fade" transparent onRequestClose={() => setViendo(false)}>
        <Pressable onPress={() => setViendo(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {url ? <Image source={{ uri: url }} style={{ width: '100%', height: '75%' }} resizeMode="contain" /> : null}
          <Text style={{ color: '#fff', fontSize: 15, marginTop: 16 }}>Toca para cerrar</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
