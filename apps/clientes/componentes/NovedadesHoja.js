// «Qué hay de nuevo» en la web (la vista previa de `expo start --web`,
// 2026-10-14). En el teléfono van las hojas del sistema:
// NovedadesHoja.ios.js (SwiftUI) y NovedadesHoja.android.js (Material 3).
import { Modal, Pressable, Text, View } from 'react-native';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton } from './ui';
import { useTema } from '../tema/tema';

export default function NovedadesHoja({ novedades, alCerrar }) {
  const t = useTema();
  return (
    <Modal transparent visible animationType="slide" onRequestClose={alCerrar}>
      <Pressable onPress={alCerrar} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colorSistema.superficie, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 18, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colorSistema.texto }}>{novedades.titulo ?? 'Qué hay de nuevo'}</Text>
          {novedades.cosas.slice(0, 3).map((c) => (
            <View key={c.titulo} style={{ flexDirection: 'row', gap: 14 }}>
              <Icono sf={c.sf} respaldo="•" tam={22} color={t.color.magentaTexto} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }}>{c.titulo}</Text>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>{c.detalle}</Text>
              </View>
            </View>
          ))}
          <Boton alTocar={alCerrar}>Continuar</Boton>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
