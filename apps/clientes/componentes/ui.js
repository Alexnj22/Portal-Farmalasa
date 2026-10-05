// Las piezas de la app: pocas y del sistema. Blanco de dedo de 44 pt
// (`tam.toque`) y acuse al tocar en todo lo que se toca.
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { suave, useTema } from '../tema/tema';

export function Pantalla({ children, alRefrescar, refrescando = false, conPestanas = true }) {
  const ins = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: (conPestanas ? 24 : 32) + ins.bottom, gap: 14 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={alRefrescar ? <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Tarjeta({ children, estilo, tono }) {
  const t = useTema();
  return (
    <View style={[{
      backgroundColor: tono ? suave(tono, t.oscuro ? 0.18 : 0.1) : t.color.tarjeta,
      borderColor: tono ? suave(tono, 0.35) : t.color.borde,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderRadius: t.radio.tarjeta,
      padding: 16,
      gap: 8,
    }, estilo]}>
      {children}
    </View>
  );
}

export function Titulo({ children, estilo }) {
  const t = useTema();
  return <Text style={[{ fontSize: 17, fontWeight: '700', color: t.color.texto }, estilo]}>{children}</Text>;
}

export function Texto({ children, nivel = 1, estilo, ...resto }) {
  const t = useTema();
  const color = nivel === 1 ? t.color.texto : nivel === 2 ? t.color.texto2 : t.color.texto3;
  return <Text style={[{ fontSize: nivel === 1 ? 15 : 14, color, lineHeight: 20 }, estilo]} {...resto}>{children}</Text>;
}

export function Boton({ children, alTocar, tipo = 'principal', cargando = false, deshabilitado = false }) {
  const t = useTema();
  const fondo = tipo === 'principal' ? t.color.magenta : tipo === 'peligro' ? 'transparent' : suave(t.color.magenta, 0.12);
  const texto = tipo === 'principal' ? '#FFFFFF' : tipo === 'peligro' ? t.color.peligro : t.color.magentaTexto;
  const apagado = deshabilitado || cargando;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={apagado}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar?.(); }}
      style={({ pressed }) => ({
        minHeight: t.tam.toque + 4,
        borderRadius: t.radio.control,
        backgroundColor: fondo,
        borderWidth: tipo === 'peligro' ? 1 : 0,
        borderColor: suave(t.color.peligro, 0.5),
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
        opacity: apagado ? 0.5 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {cargando ? <ActivityIndicator color={texto} /> : <Text style={{ color: texto, fontSize: 16, fontWeight: '600' }}>{children}</Text>}
    </Pressable>
  );
}

export function Campo({ etiqueta, ayuda, ...props }) {
  const t = useTema();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.color.texto2 }}>{etiqueta}</Text>
      <TextInput
        placeholderTextColor={t.color.texto3}
        style={{
          minHeight: t.tam.toque + 4, borderRadius: t.radio.control, paddingHorizontal: 14,
          fontSize: 17, color: t.color.texto, backgroundColor: t.color.tarjeta,
          borderWidth: 1, borderColor: t.color.borde,
        }}
        {...props}
      />
      {ayuda ? <Text style={{ fontSize: 13, color: t.color.texto3 }}>{ayuda}</Text> : null}
    </View>
  );
}

export function Aviso({ children, tipo = 'error' }) {
  const t = useTema();
  const c = tipo === 'error' ? t.color.peligro : tipo === 'exito' ? t.color.verde : t.color.aviso;
  const ct = tipo === 'error' ? t.color.peligroTexto : tipo === 'exito' ? t.color.verdeTexto : t.color.avisoTexto;
  return (
    <View style={{ backgroundColor: suave(c, 0.12), borderRadius: t.radio.control, padding: 12 }}>
      <Text style={{ color: ct, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Cargando() {
  const t = useTema();
  return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={t.color.magenta} /></View>;
}

export function Vacio({ titulo, children }) {
  return (
    <Tarjeta estilo={{ alignItems: 'center', paddingVertical: 28 }}>
      <Titulo estilo={{ textAlign: 'center' }}>{titulo}</Titulo>
      <Texto nivel={2} estilo={{ textAlign: 'center' }}>{children}</Texto>
    </Tarjeta>
  );
}

export function Casilla({ marcada, alCambiar, children }) {
  const t = useTema();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcada }}
      onPress={() => alCambiar(!marcada)}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: t.tam.toque, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{
        width: 24, height: 24, borderRadius: 7, marginTop: 1,
        borderWidth: 2, borderColor: marcada ? t.color.magenta : t.color.texto3,
        backgroundColor: marcada ? t.color.magenta : 'transparent', alignItems: 'center', justifyContent: 'center',
      }}>
        {marcada ? <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: t.color.texto2 }}>{children}</Text>
    </Pressable>
  );
}
