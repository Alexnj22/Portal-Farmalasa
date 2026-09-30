// Las pestañas del Inicio (General · Comercial · RRHH · Operación), como las
// del portal: píldoras de vidrio que se desplazan. Decisión del usuario del
// 2026-09-30: «que sigan las pestañas para tener acceso a todo siempre».
import { Pressable, ScrollView, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';

export default function Pestanas({ opciones, activa, onCambiar }) {
  if (opciones.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {opciones.map((o) => {
        const esta = o.id === activa;
        return (
          <Pressable key={o.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); }}>
            <Vidrio radio={18} interactivo tinte={esta ? 'rgba(0,82,204,0.35)' : undefined}>
              <Text style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 15, fontWeight: esta ? '700' : '500',
                color: esta ? colorSistema.texto : colorSistema.texto2 }}>{o.label}</Text>
            </Vidrio>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
