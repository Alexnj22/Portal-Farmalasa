// Las piezas de la app: el equivalente de `components/common` del portal, con
// los mismos tokens. Una pieza nueva va acá y no dentro de una pantalla.
import { Pressable, Text, TextInput, View } from 'react-native';
import { suave, useTema } from '../../tema/tema';

const TONOS = { success: ['exito', 'exitoTexto'], warning: ['aviso', 'avisoTexto'], danger: ['peligro', 'peligroTexto'] };

/** Una tarjeta, con tono opcional (success | warning | danger). */
export function Tarjeta({ tono, style, children }) {
  const t = useTema();
  const [base] = TONOS[tono] || [];
  return (
    <View style={[{
      backgroundColor: base ? suave(t.color[base], 0.08) : t.color.tarjeta,
      borderColor: base ? suave(t.color[base], 0.45) : t.color.borde,
      borderWidth: 1, borderRadius: t.radio.tarjeta, padding: 12, gap: 8,
    }, style]}>{children}</View>
  );
}

export function Insignia({ tono, children }) {
  const t = useTema();
  const [base, texto] = TONOS[tono] || [];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: base ? suave(t.color[base], 0.15) : suave(t.color.texto3, 0.12) }}>
      <Text style={{ fontSize: t.texto.caption + 2, fontWeight: '800', color: texto ? t.color[texto] : t.color.texto2 }}>{children}</Text>
    </View>
  );
}

export function Aviso({ tono = 'warning', children }) {
  const t = useTema();
  const [base, texto] = TONOS[tono] || TONOS.warning;
  return (
    <View accessibilityRole="alert" style={{ padding: 12, borderRadius: t.radio.tarjeta, backgroundColor: suave(t.color[base], 0.1), borderWidth: 1, borderColor: suave(t.color[base], 0.4) }}>
      <Text style={{ color: t.color[texto], fontSize: t.texto.cuerpo + 1, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function Titulo({ children, style }) {
  const t = useTema();
  return <Text style={[{ color: t.color.texto, fontSize: t.texto.cuerpo + 3, fontWeight: '800' }, style]}>{children}</Text>;
}

export function Texto({ children, tenue = false, style, ...props }) {
  const t = useTema();
  return <Text style={[{ color: tenue ? t.color.texto3 : t.color.texto2, fontSize: t.texto.cuerpo + 1 }, style]} {...props}>{children}</Text>;
}

/** Una casilla con blanco de dedo de 44 y acuse al tocar. */
export function Casilla({ marcada, onCambio, children, etiqueta }) {
  const t = useTema();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!marcada }} accessibilityLabel={etiqueta}
      onPress={() => onCambio(!marcada)}
      style={({ pressed }) => ({ minHeight: t.tam.toque, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: marcada ? t.color.marca : t.color.texto3, backgroundColor: marcada ? t.color.marca : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {marcada ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14, lineHeight: 16 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

/** Un campo corto para números con decimales (°C, % HR). Sin placeholder: un
 *  «0.0» gris se lee como un valor ya escrito. */
export function CampoNumero({ valor, onCambio, error = false, etiqueta, ancho = 84 }) {
  const t = useTema();
  return (
    <TextInput accessibilityLabel={etiqueta} value={valor || ''} keyboardType="decimal-pad"
      onChangeText={(v) => onCambio(v.replace(',', '.').replace(/[^0-9.-]/g, ''))}
      style={{ width: ancho, minHeight: t.tam.toque, textAlign: 'center', borderRadius: t.radio.control, borderWidth: error ? 2 : 1, borderColor: error ? t.color.peligro : t.color.borde, backgroundColor: t.color.tarjeta, color: t.color.texto, fontSize: t.texto.cuerpo + 4, fontVariant: ['tabular-nums'] }} />
  );
}

export function CampoTexto({ valor, onCambio, placeholder, error = false, etiqueta }) {
  const t = useTema();
  return (
    <TextInput accessibilityLabel={etiqueta} value={valor || ''} onChangeText={onCambio} placeholder={placeholder} multiline
      placeholderTextColor={t.color.texto3}
      style={{ minHeight: 64, borderRadius: t.radio.control, borderWidth: error ? 2 : 1, borderColor: error ? t.color.peligro : t.color.borde, backgroundColor: t.color.tarjeta, color: t.color.texto, padding: 10, fontSize: t.texto.cuerpo + 2, textAlignVertical: 'top' }} />
  );
}

/** Un botón de texto chico (para «Todas», «Anotar algo», el paso de fecha). */
export function BotonChico({ children, onPress, deshabilitado = false, etiqueta }) {
  const t = useTema();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={etiqueta} disabled={deshabilitado} onPress={onPress}
      style={({ pressed }) => ({ minHeight: t.tam.toque, minWidth: t.tam.toque, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', opacity: deshabilitado ? 0.35 : (pressed ? 0.6 : 1) })}>
      <Text style={{ color: t.color.marca, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>{children}</Text>
    </Pressable>
  );
}
