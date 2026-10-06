// La semana del historial con flechas — el `PeriodStepper` de la bandeja del
// portal en el teléfono. La semana empieza el LUNES (`getLocalMonday`, la
// misma de todo el portal) y no deja pasar de la que corre. Tocar el rótulo
// vuelve a esta semana, que es a donde uno quiere volver después de mirar atrás.
//
// Recorta sólo el HISTORIAL: lo pendiente se ve entero sea de la semana que
// sea (lo decide la pantalla, no este control).
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { formatWeekRange, getLocalMonday, shiftWeek } from '@nucleo/utils/semana';
import { colorSistema } from '../Formulario';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { ICONO } from './iconos';

export default function PasoDeSemana({ semana, onCambiar }) {
  const actual = getLocalMonday();
  const esActual = semana === actual;
  const ir = (n) => { Haptics.selectionAsync().catch(() => {}); onCambiar(shiftWeek(semana, n)); };
  const flecha = (icono, onPress, deshabilitada, etiqueta) => (
    <Pressable onPress={onPress} disabled={deshabilitada} hitSlop={8} accessibilityRole="button" accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: deshabilitada ? 0.3 : pressed ? 0.5 : 1 })}>
      <Host matchContents><Icon name={icono} size={18} color={MARCA.azulClaro} /></Host>
    </Pressable>
  );
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {flecha(ICONO.anterior, () => ir(-1), false, 'Semana anterior')}
          <Pressable style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }} disabled={esActual}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(actual); }}
            accessibilityRole="button" accessibilityLabel="Ir a esta semana">
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{formatWeekRange(semana)}</Text>
            <Text style={{ color: esActual ? colorSistema.texto2 : MARCA.azulClaro, fontSize: 12, fontWeight: '600' }}>
              {esActual ? 'Esta semana' : 'Ir a esta semana'}
            </Text>
          </Pressable>
          {flecha(ICONO.siguiente, () => ir(1), esActual, 'Semana siguiente')}
        </View>
      </Vidrio>
    </View>
  );
}
