// Las piezas de la app: pocas y del sistema. Blanco de dedo de 44 pt
// (`tam.toque`) y acuse al tocar en todo lo que se toca.
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { suave, useTema } from '../tema/tema';

export function Pantalla({ children, alRefrescar, refrescando = false, conPestanas = true }) {
  const ins = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Tope de ancho: en un iPad o en el navegador las tarjetas se estiraban
      // de borde a borde y una cifra quedaba a medio metro de su rótulo.
      contentContainerStyle={{
        padding: 16, paddingBottom: (conPestanas ? 24 : 32) + ins.bottom, gap: 14,
        width: '100%', maxWidth: 560, alignSelf: 'center',
      }}
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
  const fondo = tipo === 'principal' ? t.color.magenta : tipo === 'peligro' ? 'transparent' : suave(t.color.magenta, t.oscuro ? 0.28 : 0.12);
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

export function Campo({ etiqueta, ayuda, estilo, onFocus, onBlur, ...props }) {
  const t = useTema();
  const [foco, setFoco] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: t.color.texto2 }}>{etiqueta}</Text>
      <TextInput
        placeholderTextColor={t.color.texto3}
        onFocus={(e) => { setFoco(true); onFocus?.(e); }}
        onBlur={(e) => { setFoco(false); onBlur?.(e); }}
        style={[{
          minHeight: t.tam.toque + 8, borderRadius: t.radio.control, paddingHorizontal: 16,
          fontSize: 17, color: t.color.texto,
          // El fondo de la PÁGINA y no el de la tarjeta: el campo va dentro de
          // una tarjeta y con el mismo color no se distingue dónde se escribe.
          backgroundColor: t.color.fondo,
          // El foco con el color de la marca, no el anillo azul del navegador.
          borderWidth: foco ? 2 : 1, borderColor: foco ? t.color.magenta : t.color.borde,
          paddingVertical: foco ? 0 : 1,
        }, Platform.OS === 'web' && { outlineStyle: 'none' }, estilo]}
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

/** Dos o tres opciones excluyentes, como el control segmentado del sistema. */
export function Segmentos({ opciones, valor, alCambiar }) {
  const t = useTema();
  return (
    <View style={{
      flexDirection: 'row', padding: 4, gap: 4, borderRadius: t.radio.control + 4,
      backgroundColor: suave(t.color.texto3, t.oscuro ? 0.25 : 0.12),
    }}>
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <Pressable
            key={o.valor}
            accessibilityRole="tab"
            accessibilityState={{ selected: activo }}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); alCambiar(o.valor); }}
            style={({ pressed }) => ({
              flex: 1, minHeight: t.tam.toque - 4, borderRadius: t.radio.control,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: activo ? t.color.tarjeta : 'transparent',
              shadowColor: '#000', shadowOpacity: activo ? 0.08 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: activo ? '700' : '500', color: activo ? t.color.texto : t.color.texto2 }}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
