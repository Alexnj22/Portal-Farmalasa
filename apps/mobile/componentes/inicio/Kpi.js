// Un número del día, como el KpiCard del portal: el ícono en un cuadro
// tintado, el rótulo, el número grande y una línea de apoyo. Si pide acción
// (`pide`), el número toma el color de estado. En vidrio sobre la aurora.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

export default function Kpi({ icono, rotulo, valor, apoyo, color, pide = false, onPress }) {
  return (
    <Pressable style={{ flex: 1 }} disabled={!onPress}
      onPress={onPress ? () => { Haptics.selectionAsync().catch(() => {}); onPress(); } : undefined}>
      {({ pressed }) => (
        <Vidrio radio={22} style={{ transform: [{ scale: pressed ? 0.97 : 1 }] }}>
          <View style={{ padding: 14, gap: 8, minHeight: 118 }}>
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
              <Host matchContents><Icon name={iconoDe(icono)} size={18} color={color} /></Host>
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{rotulo}</Text>
            <Text style={{ color: pide ? color : colorSistema.texto, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}
              numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
            {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{apoyo}</Text> : null}
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export function FilaDeKpis({ children }) {
  return <View style={{ flexDirection: 'row', gap: 12, marginHorizontal: 16 }}>{children}</View>;
}
