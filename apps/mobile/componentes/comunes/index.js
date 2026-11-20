// Las piezas de la app: el equivalente de `components/common` del portal, con
// los mismos tokens. Una pieza nueva va acá y no dentro de una pantalla.
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Text, TextInput, View, useColorScheme } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import { suave, useTema } from '../../tema/tema';
import { relieve } from '../../tema/papel';

const TONOS = { success: ['exito', 'exitoTexto'], warning: ['aviso', 'avisoTexto'], danger: ['peligro', 'peligroTexto'] };

/** Una tarjeta, con tono opcional (success | warning | danger). */
// Línea Mostrador: la tarjeta lleva RELIEVE en vez de borde; con tono, es la
// ficha del tono al 10 % sin borde (Avisos A).
export function Tarjeta({ tono, style, children }) {
  const t = useTema();
  const oscuro = useColorScheme() === 'dark';
  const [base] = TONOS[tono] || [];
  return (
    <View style={[{
      backgroundColor: base ? suave(t.color[base], 0.1) : t.color.tarjeta,
      boxShadow: base ? undefined : relieve(oscuro),
      borderRadius: base ? 16 : t.radio.tarjeta, padding: base ? 12 : 16, gap: 8,
    }, style]}>{children}</View>
  );
}

// Línea Mostrador · Insignia «Punto vivo»: píldora del tono al 14 % con su
// punto; el punto late sólo en lo vivo (`vivo`).
export function Insignia({ tono, children, punto = false, vivo = false }) {
  const t = useTema();
  const [base, texto] = TONOS[tono] || [];
  const color = texto ? t.color[texto] : t.color.texto2;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: base ? suave(t.color[base], 0.14) : suave(t.color.texto3, 0.12) }}>
      {punto || vivo ? <PuntoVivo color={color} vivo={vivo} /> : null}
      <Text style={{ fontSize: t.texto.caption + 2, fontWeight: '600', color }}>{children}</Text>
    </View>
  );
}

/** El punto de una insignia: late (opacidad) sólo si `vivo`, y no late con
 *  «reducir movimiento». */
export function PuntoVivo({ color, vivo = false, tam = 6 }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!vivo) return undefined;
    let lazo = null;
    let vigente = true;
    AccessibilityInfo.isReduceMotionEnabled().then((quieto) => {
      if (quieto || !vigente) return;
      lazo = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]));
      lazo.start();
    }).catch(() => {});
    return () => { vigente = false; lazo?.stop(); };
  }, [vivo, v]);
  return <Animated.View style={{ width: tam, height: tam, borderRadius: tam / 2, backgroundColor: color, opacity: v }} />;
}

export function Aviso({ tono = 'warning', children }) {
  const t = useTema();
  const [base, texto] = TONOS[tono] || TONOS.warning;
  // Línea Mostrador · Avisos A: ficha del tono al 10 %, radio 16, sin borde;
  // el punto del tono y el texto en tinta 2.
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, backgroundColor: suave(t.color[base], 0.1) }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: t.color[texto] }} />
      <Text style={{ flex: 1, color: t.color.texto2, fontSize: t.texto.cuerpo + 1, fontWeight: '500' }}>{children}</Text>
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
