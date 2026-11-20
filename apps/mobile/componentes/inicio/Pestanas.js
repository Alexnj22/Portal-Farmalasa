// Las pestañas del Inicio (General · Comercial · RRHH · Operación), como las
// del portal: píldoras de vidrio que se desplazan. Decisión del usuario del
// 2026-09-30: «que sigan las pestañas para tener acceso a todo siempre».
import { Platform, ScrollView, Text } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import * as Haptics from 'expo-haptics';
import FichasAndroid from './FichasAndroid';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from './marca';
import { papel, relieve } from '../../tema/papel';
import { usePreferenciaDeTema } from '../../tema/preferencia';
import { useColorScheme } from 'react-native';

export default function Pestanas({ opciones, activa, onCambiar }) {
  const conVidrio = usePreferenciaDeTema((s) => s.estilo === 'vidrio');
  const oscuro = useColorScheme() === 'dark';
  if (opciones.length < 2) return null;
  if (Platform.OS === 'android') return <FichasAndroid opciones={opciones} activa={activa} onCambiar={onCambiar} />;
  // Papel / Sólido (línea Mostrador · «Chip de filtro»): píldora con relieve;
  // la elegida, la marca sólida con texto blanco.
  if (!conVidrio) {
    const p = papel(oscuro);
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 6, gap: 8 }}>
        {opciones.map((o) => {
          const esta = o.id === activa;
          return (
            <Pressable key={o.id} accessibilityRole="tab" accessibilityState={{ selected: esta }}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); }}
              style={({ pressed }) => ({ borderRadius: 999, backgroundColor: esta ? p.marca : p.superficie, boxShadow: relieve(oscuro, 'control'),
                transform: [{ scale: pressed ? 0.96 : 1 }] })}>
              <Text style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 15, fontWeight: esta ? '600' : '500',
                color: esta ? '#FFFFFF' : p.tinta2 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {opciones.map((o) => {
        const esta = o.id === activa;
        return (
          <Pressable key={o.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); }}>
            <Vidrio radio={18} interactivo tinte={esta ? `${MARCA.azul}59` : undefined}>
              <Text style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 15, fontWeight: esta ? '700' : '500',
                color: esta ? colorSistema.texto : colorSistema.texto2 }}>{o.label}</Text>
            </Vidrio>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
