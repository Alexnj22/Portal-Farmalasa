// Las piezas de los formularios nativos (crear solicitudes, contestar,
// recibir): una sección de vidrio con su título, el campo de texto, la lista
// de opciones con palomita, el botón grande y el renglón «dato: valor». Todas
// iguales en toda la app, para que un formulario se sienta como el anterior.
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

export function Seccion({ titulo, pie, children }) {
  return (
    <View style={{ gap: 7 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>{titulo}</Text> : null}
      <Vidrio radio={20}><View style={{ padding: 14, gap: 10 }}>{children}</View></Vidrio>
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 16 }}>{pie}</Text> : null}
    </View>
  );
}

export function Campo({ multiline = true, style, ...props }) {
  return (
    <TextInput placeholderTextColor={colorSistema.texto2} multiline={multiline} {...props}
      style={[{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colorSistema.texto,
        backgroundColor: 'rgba(127,127,127,0.16)' }, style]} />
  );
}

/** Una lista de opciones con palomita (una sola elegida). */
export function Opciones({ opciones, valor, onCambiar, color = MARCA.azulClaro }) {
  return (
    <View>
      {opciones.map((o, i) => {
        const id = typeof o === 'string' ? o : o.id;
        const rotulo = typeof o === 'string' ? o : o.label;
        const detalle = typeof o === 'string' ? null : o.detalle;
        return (
          <Pressable key={id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(id); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingVertical: 6,
              borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
              {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
            </View>
            {valor === id ? <Text style={{ color, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function BotonGrande({ texto, color = MARCA.azul, onPress, deshabilitado, borde = false }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Text style={{ color: borde ? color : '#fff', fontSize: 17, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export function Dato({ rotulo, valor, primero, fuerte }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingTop: primero ? 0 : 9, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>{rotulo}</Text>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: fuerte ? '800' : '500', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' }}>{valor ?? '—'}</Text>
    </View>
  );
}

/** Un aviso dentro de un formulario: freno (rojo), cuidado (ámbar) o nota. */
export function Aviso({ texto, tono = 'nota' }) {
  const color = tono === 'freno' ? MARCA.rojo : tono === 'cuidado' ? MARCA.ambar : colorSistema.texto2;
  return <Text style={{ color, fontSize: 14, fontWeight: tono === 'nota' ? '400' : '600', marginHorizontal: 4 }}>{texto}</Text>;
}
