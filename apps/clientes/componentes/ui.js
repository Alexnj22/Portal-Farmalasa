// Las piezas de las pantallas de contenido (puntos, ofertas, inyecciones).
// Canon: superficies de VIDRIO sobre la aurora (Liquid Glass en iOS 26),
// texto en los colores del sistema (`label`; los secundarios, sólidos — ver sistema.js), el botón del
// sistema, y los colores del logo SÓLO para lo que es de la marca: lo que se
// gana (verde) y lo que se usa (magenta).
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BotonNativo from './BotonNativo';
import Icono from './Icono';
import Vidrio from './Vidrio';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';

// Los radios de esquina de la app (2026-10-13): la tarjeta de vidrio, la
// pieza mediana (fichas de producto, cajas) y la chica (botones, íconos).
export const RADIO = { chico: 12, medio: 18, tarjeta: 26 };

// Lo que ocupa la burbuja del chat (56 + su margen + un respiro), 2026-10-13:
// sin este espacio abajo, la burbuja tapaba la última tarjeta de la lista.
export const ESPACIO_BURBUJA = 88;

// `alFinal`: se llama al acercarse al final (listas paginadas, 2026-10-09).
// `conBurbuja`: deja abajo el lugar de la burbuja del chat (2026-10-13). Las
// pantallas donde la burbuja no va (componentes/BurbujaChat, `OCULTA`) pasan false.
export function Pantalla({ children, alRefrescar, refrescando = false, conPestanas = true, alFinal, conBurbuja = true }) {
  const ins = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Tope de ancho: en un iPad o en el navegador las tarjetas se estiraban
      // de borde a borde y una cifra quedaba a medio metro de su rótulo.
      contentContainerStyle={{
        padding: 16, paddingBottom: (conPestanas ? 24 : 32) + (Platform.OS === 'ios' ? 0 : ins.bottom) + (conBurbuja && Platform.OS !== 'web' ? ESPACIO_BURBUJA : 0), gap: 14,
        width: '100%', maxWidth: 560, alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={alFinal ? 250 : undefined}
      onScroll={alFinal ? ({ nativeEvent: e }) => {
        if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 700) alFinal();
      } : undefined}
      refreshControl={alRefrescar ? <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** Una tarjeta de vidrio. `tono` la tiñe (verde o magenta) cuando ES de la marca. */
export function Tarjeta({ children, estilo, tono }) {
  const t = useTema();
  // Con tono, el tinte de la marca va ENCIMA de un velo del fondo: sólo el
  // tinte dejaba el texto sobre magenta translúcido, difícil de leer.
  return (
    <Vidrio radio={RADIO.tarjeta} tinte={tono ? suave(tono, 0.22) : undefined}>
      <View style={[{ padding: 18, gap: 8 },
        tono && { backgroundColor: t.oscuro ? 'rgba(18,16,24,0.4)' : 'rgba(255,255,255,0.5)' }, estilo]}>{children}</View>
    </Vidrio>
  );
}

export function Titulo({ children, estilo }) {
  return <Text style={[{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }, estilo]}>{children}</Text>;
}

export function Texto({ children, nivel = 1, estilo, ...resto }) {
  const color = nivel === 1 ? colorSistema.texto : nivel === 2 ? colorSistema.texto2 : colorSistema.texto3;
  return <Text style={[{ fontSize: nivel === 1 ? 17 : 15, color, lineHeight: nivel === 1 ? 22 : 20, fontWeight: nivel === 1 ? '400' : '500' }, estilo]} {...resto}>{children}</Text>;
}

/**
 * El botón del sistema (SwiftUI / Material). `principal` va tintado con el
 * magenta del logo; `secundario` es el botón con borde; `peligro` el rojo
 * del sistema, como «Borrar» en cualquier app de iOS.
 */
export function Boton({ children, alTocar, tipo = 'principal', cargando = false, deshabilitado = false }) {
  const t = useTema();
  const variante = tipo === 'principal' ? 'filled' : tipo === 'peligro' ? 'text' : 'outlined';
  return (
    <BotonNativo etiqueta={cargando ? 'Un momento…' : String(children)} alTocar={alTocar} variante={variante}
      deshabilitado={deshabilitado || cargando} color={tipo === 'peligro' ? colorSistema.rojo : t.color.magenta} />
  );
}

export function Aviso({ children, tipo = 'error' }) {
  const color = tipo === 'error' ? colorSistema.rojo : tipo === 'exito' ? colorSistema.texto : colorSistema.naranja;
  return <Text style={{ color, fontSize: 15, textAlign: 'center', marginHorizontal: 8 }}>{children}</Text>;
}

export function Cargando() {
  return <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator /></View>;
}

// La pantalla sin nada que mostrar (rehecha 2026-10-12, «solo veo 2 textos,
// sin forma»): una tarjeta de vidrio con un ícono en su círculo de color, el
// título, la explicación y, si hay algo que hacer, el botón. `icono` es el
// nombre SF y `respaldo` el carácter para Android/web; sin ellos, una bandeja.
// `tono`: el color del círculo (por defecto, el magenta de la marca).
export function Vacio({ titulo, children, icono: iconoDado, respaldo: respaldoDado, tono, accion, alAccion }) {
  const t = useTema();
  // Un error de carga se reconoce por su título: ícono de conexión y gris.
  const error = !iconoDado && /^No se pud/.test(String(titulo ?? ''));
  const icono = iconoDado ?? (error ? 'wifi.exclamationmark' : 'tray');
  const respaldo = respaldoDado ?? (error ? '!' : '○');
  const c = tono ?? (error ? colorSistema.texto3 : t.color.magenta);
  return (
    <Tarjeta estilo={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, gap: 10 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: suave(c, t.oscuro ? 0.28 : 0.14),
        alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icono sf={icono} respaldo={respaldo} tam={30} color={c} />
      </View>
      <Titulo estilo={{ textAlign: 'center', fontSize: 20 }}>{titulo}</Titulo>
      {children ? <Texto nivel={2} estilo={{ textAlign: 'center', lineHeight: 21, maxWidth: 320 }}>{children}</Texto> : null}
      {accion && alAccion ? <View style={{ marginTop: 6, alignSelf: 'stretch' }}><Boton alTocar={alAccion}>{accion}</Boton></View> : null}
    </Tarjeta>
  );
}

// El rótulo de una sección (2026-10-13): 13 pt, mayúsculas, espaciado 0.4 y el
// gris secundario. Estaba escrito a mano en ~14 sitios. `n` agrega « · n».
export function Seccion({ children, n, estilo }) {
  return (
    <Text accessibilityRole="header"
      style={[{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }, estilo]}>
      {children}{n ? ` · ${n}` : ''}
    </Text>
  );
}

// Una píldora de filtro (2026-10-13; antes, una copia en Reservas y otra en
// Facturas). Mide 34 de alto y el `hitSlop` completa los 44 pt del dedo.
export function Chip({ texto, activo, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
      accessibilityRole="button" accessibilityState={{ selected: activo }}
      style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }],
        backgroundColor: activo ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)') })}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: activo ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}
