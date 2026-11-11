// Cuenta › Pestaña rápida: elegir qué módulo va en la barra de abajo.
// Sólo los que el cargo puede ver. Ver componentes/pestanaRapida.js.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { usePestanaRapida } from '../componentes/pestanaRapida';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import Vidrio from '../componentes/Vidrio';
import { colorSistema } from '../componentes/Formulario';
import { useTema } from '../tema/tema';
import { iconoDe } from '../tema/iconos';

export default function ElegirPestanaRapida() {
  const { user, hasPermission } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const tema = useTema();
  const { actual, permitidas, poner } = usePestanaRapida(user, hasPermission, salas);
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pestaña rápida' }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, paddingHorizontal: 4 }}>
          El módulo que aparece en la barra de abajo, entre Menú y Cuenta.
        </Text>
        <Vidrio radio={20}>
          <View style={{ paddingVertical: 2 }}>
            {permitidas.map((o, i) => (
              <Pressable key={o.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); poner(o.id); router.back(); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 14,
                  backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 50,
                  borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17 }}>{o.label}</Text>
                  {actual?.id === o.id ? <Host matchContents><Icon name={iconoDe('Check')} size={17} color={tema.color.marca} /></Host> : null}
                </View>
              </Pressable>
            ))}
          </View>
        </Vidrio>
      </ScrollView>
    </>
  );
}
