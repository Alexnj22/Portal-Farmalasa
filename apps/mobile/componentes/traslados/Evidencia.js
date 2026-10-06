// Las fotos de evidencia de un envío o traslado (la avería que viajó con la
// caja): miniaturas que se amplían a pantalla completa. Las rutas guardadas son
// del bucket privado, así que se firman al mostrarlas (`getSignedFileUrl`),
// igual que `EvidenciaFotos` del portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';
import { colorSistema } from '../Formulario';

export default function Evidencia({ urls, titulo = 'Foto del daño' }) {
  const [firmadas, setFirmadas] = useState(null);
  const [ampliada, setAmpliada] = useState(null);
  const lista = useMemo(() => (Array.isArray(urls) ? urls.filter(Boolean) : []), [urls]);
  useEffect(() => {
    if (!lista.length) return undefined;
    let vivo = true;
    Promise.all(lista.map((u) => getSignedFileUrl(u).catch(() => null))).then((r) => { if (vivo) setFirmadas(r); });
    return () => { vivo = false; };
  }, [lista]);
  if (!lista.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{titulo}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(firmadas ?? lista.map(() => null)).map((src, i) => (src ? (
          <Pressable key={i} onPress={() => setAmpliada(src)} accessibilityLabel={`Ampliar foto ${i + 1}`}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Image source={{ uri: src }} style={{ width: 84, height: 84, borderRadius: 12 }} />
          </Pressable>
        ) : (
          <View key={i} style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.16)', alignItems: 'center', justifyContent: 'center' }}>
            {firmadas ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Sin foto</Text> : <ActivityIndicator />}
          </View>
        )))}
      </View>
      <Modal visible={!!ampliada} transparent animationType="fade" onRequestClose={() => setAmpliada(null)}>
        <Pressable onPress={() => setAmpliada(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          {ampliada ? <Image source={{ uri: ampliada }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <Text style={{ color: '#fff', fontSize: 15, marginTop: 16 }}>Toca para cerrar</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
