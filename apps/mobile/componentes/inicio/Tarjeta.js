// Una sección del Inicio: vidrio sobre la aurora, con su título a la izquierda
// y «Ver todo ›» a la derecha. Tocarla anota el uso (el Inicio aprende) y abre
// su módulo. Vibración suave al tocar, como los controles del sistema.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

export function Titulo({ texto, icono, color, accion }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      {icono ? <Host matchContents><Icon name={iconoDe(icono)} size={16} color={color ?? colorSistema.texto2} /></Host> : null}
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>{texto}</Text>
      {accion ? <Text style={{ color: colorSistema.acento, fontSize: 14 }}>{accion} ›</Text> : null}
    </View>
  );
}

export default function Tarjeta({ titulo, icono, color, accion = 'Ver todo', onPress, children, sinTitulo = false }) {
  const tocar = onPress ? () => { Haptics.selectionAsync().catch(() => {}); onPress(); } : undefined;
  return (
    <Pressable onPress={tocar} disabled={!tocar} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.985 : 1 }] })}>
      <Vidrio radio={22}>
        <View style={{ padding: 16 }}>
          {sinTitulo ? null : <Titulo texto={titulo} icono={icono} color={color} accion={tocar ? accion : null} />}
          {children}
        </View>
      </Vidrio>
    </Pressable>
  );
}
