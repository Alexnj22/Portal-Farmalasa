// Las piezas de las pantallas de contenido (puntos, ofertas, inyecciones).
// Canon: superficies de VIDRIO sobre la aurora (Liquid Glass en iOS 26),
// texto en los colores del sistema (`label`; los secundarios, sólidos — ver sistema.js), el botón del
// sistema, y los colores del logo SÓLO para lo que es de la marca: lo que se
// gana (verde) y lo que se usa (magenta).
import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, Text, View, RefreshControl } from 'react-native';
import IndicadorCarga from './IndicadorCarga';
import Presionable from './Presionable';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import BotonNativo from './BotonNativo';
import Icono from './Icono';
import Vidrio, { SinVidrio } from './Vidrio';
import { ContextoDesplazamiento, crearDesplazamiento } from '../lib/desplazamiento';
import { colorSistema } from './sistema';
import { suave, useTema } from '../tema/tema';

const ANDROID = Platform.OS === 'android';

// Los radios de esquina de la app (2026-10-13): la tarjeta de vidrio, la
// pieza mediana (fichas de producto, cajas) y la chica (botones, íconos).
// En Android, la escala de formas de Material 3: chica 8, mediana 12, grande 16.
export const RADIO = ANDROID ? { chico: 8, medio: 12, tarjeta: 16 } : { chico: 12, medio: 18, tarjeta: 26 };

// La escala tipográfica de Material 3 en Android (Roboto, 2026-10-13): Title
// Medium para títulos de tarjeta, Body Large / Body Medium para el texto y
// Title Small en el color de la marca para los rótulos de sección. En iPhone
// sigue la de iOS (17 / 15 y el rótulo en mayúsculas).
const TIPO = ANDROID
  ? { titulo: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0.15 },
      texto1: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0.5 },
      texto2: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0.25 } }
  : { titulo: { fontSize: 17, fontWeight: '600' },
      texto1: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
      texto2: { fontSize: 15, lineHeight: 20, fontWeight: '500' } };

// Lo que ocupa la burbuja del chat (56 + su margen + un respiro), 2026-10-13:
// sin este espacio abajo, la burbuja tapaba la última tarjeta de la lista.
export const ESPACIO_BURBUJA = 88;

// `alFinal`: se llama al acercarse al final (listas paginadas, 2026-10-09).
// `conBurbuja`: deja abajo el lugar de la burbuja del chat (2026-10-13). Las
// pantallas donde la burbuja no va (componentes/BurbujaChat, `OCULTA`) pasan false.
//
// `sinVidrio` (2026-10-14, «el Inicio se siente lento»): las tarjetas de esta
// pantalla van en el relleno translúcido que imita al vidrio, sin el vidrio
// vivo. Un Liquid Glass por tarjeta, desplazándose sobre la aurora, se vuelve
// a componer en cada cuadro; sobre un fondo quieto el relleno se ve igual. El
// vidrio queda para lo que no se mueve (la barra, los encabezados).
//
// El estado del desplazamiento (lib/desplazamiento.js) sale de los eventos de
// arrastre y de inercia: lo que se anima solo lo usa para pausarse mientras
// la lista se mueve.
// `sinBarra` (2026-10-20, Inicio: «siento que se pierde mucho espacio
// arriba»): la pantalla no tiene barra de título —su primer renglón hace de
// título— y el contenido arranca bajo la barra de estado. Al desplazar, un
// velo difuminado aparece detrás de la hora y la batería, como el de la barra
// del sistema; arriba de todo no se ve.
export function Pantalla({ children, alRefrescar, refrescando = false, conPestanas = true, alFinal, conBurbuja = true, sinVidrio = false, sinBarra = false }) {
  const [velo, setVelo] = useState(false);
  const ins = useSafeAreaInsets();
  const t = useTema();
  const desp = useRef(null);
  if (!desp.current) desp.current = crearDesplazamiento();
  const d = desp.current;
  useEffect(() => () => d.soltarTodo(), [d]);
  return (
    <ContextoDesplazamiento.Provider value={d}>
    <SinVidrio.Provider value={sinVidrio}>
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      // Tope de ancho: en un iPad o en el navegador las tarjetas se estiraban
      // de borde a borde y una cifra quedaba a medio metro de su rótulo.
      contentContainerStyle={{
        padding: 16, paddingBottom: (conPestanas ? 24 : 32) + (Platform.OS === 'ios' ? 0 : ins.bottom) + (conBurbuja && Platform.OS !== 'web' ? ESPACIO_BURBUJA : 0), gap: 14,
        // Sin barra, iOS ya corre el contenido bajo la barra de estado
        // (`automatic`); Android no: se suma a mano.
        ...(sinBarra ? { paddingTop: (Platform.OS === 'ios' ? 4 : ins.top + 8) } : null),
        width: '100%', maxWidth: 560, alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={d.empezar}
      onScrollEndDrag={d.soltar}
      onMomentumScrollBegin={d.inercia}
      onMomentumScrollEnd={d.terminar}
      scrollEventThrottle={sinBarra ? 32 : alFinal ? 250 : undefined}
      onScroll={alFinal || sinBarra ? ({ nativeEvent: e }) => {
        if (sinBarra) { const v = e.contentOffset.y > 4; if (v !== velo) setVelo(v); }
        if (alFinal && e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 700) alFinal();
      } : undefined}
      // `colors` y `progressBackgroundColor` sólo los lee Android: el círculo de
      // Material en la marca, sobre la superficie alta (2026-10-13).
      refreshControl={alRefrescar ? <RefreshControl refreshing={refrescando} onRefresh={alRefrescar}
        colors={[t.color.magenta]} progressBackgroundColor={ANDROID ? colorSistema.superficieAlta : undefined} /> : undefined}
    >
      {children}
    </ScrollView>
    {sinBarra && velo ? (
      Platform.OS === 'ios'
        ? <BlurView pointerEvents="none" intensity={60} tint="systemChromeMaterial" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ins.top }} />
        : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ins.top, backgroundColor: colorSistema.fondo }} />
    ) : null}
    </SinVidrio.Provider>
    </ContextoDesplazamiento.Provider>
  );
}

// El hueco entre tarjetas de `PantallaLista`: el mismo `gap` de `Pantalla`.
// Como separador y no como `gap` del contenedor: la lista virtual mete vistas
// de relleno donde no pinta filas, y el `gap` también las separaría.
const HUECO = 14;
function SeparadorLista() { return <View style={{ height: HUECO }} />; }

/**
 * `Pantalla` para una lista que puede crecer (2026-10-15): la misma pantalla
 * —márgenes, tope de ancho, títulos grandes, deslizar para refrescar, el lugar
 * de la burbuja y el estado del desplazamiento para lo que se pausa— pero en
 * una FlatList, que sólo pinta las filas cerca de la vista. `encabezado` es lo
 * que va arriba de la lista (con el mismo hueco que entre filas).
 */
export function PantallaLista({ datos, renderItem, keyExtractor, encabezado, alRefrescar, refrescando = false, conPestanas = true,
  conBurbuja = true, sinVidrio = false, initialNumToRender = 6, windowSize = 7, maxToRenderPerBatch = 4 }) {
  const ins = useSafeAreaInsets();
  const t = useTema();
  const desp = useRef(null);
  if (!desp.current) desp.current = crearDesplazamiento();
  const d = desp.current;
  useEffect(() => () => d.soltarTodo(), [d]);
  return (
    <ContextoDesplazamiento.Provider value={d}>
    <SinVidrio.Provider value={sinVidrio}>
    <FlatList
      data={datos}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      initialNumToRender={initialNumToRender}
      maxToRenderPerBatch={maxToRenderPerBatch}
      windowSize={windowSize}
      ItemSeparatorComponent={SeparadorLista}
      ListHeaderComponent={encabezado ? <View style={{ gap: HUECO, marginBottom: datos?.length ? HUECO : 0 }}>{encabezado}</View> : null}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: 16, paddingBottom: (conPestanas ? 24 : 32) + (Platform.OS === 'ios' ? 0 : ins.bottom) + (conBurbuja && Platform.OS !== 'web' ? ESPACIO_BURBUJA : 0),
        width: '100%', maxWidth: 560, alignSelf: 'center',
      }}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={d.empezar}
      onScrollEndDrag={d.soltar}
      onMomentumScrollBegin={d.inercia}
      onMomentumScrollEnd={d.terminar}
      refreshControl={alRefrescar ? <RefreshControl refreshing={refrescando} onRefresh={alRefrescar}
        colors={[t.color.magenta]} progressBackgroundColor={ANDROID ? colorSistema.superficieAlta : undefined} /> : undefined}
    />
    </SinVidrio.Provider>
    </ContextoDesplazamiento.Provider>
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
  return <Text style={[TIPO.titulo, { color: colorSistema.texto }, estilo]}>{children}</Text>;
}

export function Texto({ children, nivel = 1, estilo, ...resto }) {
  const color = nivel === 1 ? colorSistema.texto : nivel === 2 ? colorSistema.texto2 : colorSistema.texto3;
  return <Text style={[nivel === 1 ? TIPO.texto1 : TIPO.texto2, { color }, estilo]} {...resto}>{children}</Text>;
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

// La carga de una pantalla entera (2026-10-14): en Android el indicador de
// Material 3 Expressive —una forma que gira y se transforma—; en iPhone, la
// ruedita del sistema (componentes/IndicadorCarga).
export function Cargando() {
  return <View style={{ padding: 60, alignItems: 'center' }}><IndicadorCarga tam="grande" /></View>;
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
// Android: el subtítulo de lista de Material 3 (Title Small, en el color de
// la marca, sin mayúsculas).
export function Seccion({ children, n, estilo }) {
  const t = useTema();
  const base = ANDROID
    ? { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: t.color.magentaTexto, marginLeft: 4 }
    : { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 };
  return (
    <Text accessibilityRole="header" style={[base, estilo]}>
      {children}{n ? ` · ${n}` : ''}
    </Text>
  );
}

// Una píldora de filtro (2026-10-13; antes, una copia en Reservas y otra en
// Facturas). Mide 34 de alto y el `hitSlop` completa los 44 pt del dedo.
// Android: el «filter chip» de Material 3 — 32 dp de alto (48 con el
// `hitSlop`), esquinas de 8, contorno cuando no está elegido y relleno tonal
// con su ✓ cuando sí.
export function Chip({ texto, activo, alTocar }) {
  const t = useTema();
  if (ANDROID) {
    return (
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
        accessibilityRole="button" accessibilityState={{ selected: activo }}
        style={{ minHeight: 32, paddingLeft: activo ? 8 : 16, paddingRight: 16, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 8,
          borderWidth: activo ? 0 : 1, borderColor: colorSistema.contornoSuave,
          backgroundColor: activo ? suave(t.color.magenta, t.oscuro ? 0.38 : 0.16) : 'transparent' }}>
        {activo ? <Icono sf="checkmark" respaldo="✓" tam={18} color={colorSistema.texto} /> : null}
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: colorSistema.texto }}>{texto}</Text>
      </Presionable>
    );
  }
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
      accessibilityRole="button" accessibilityState={{ selected: activo }}
      style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }],
        backgroundColor: activo ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)') })}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: activo ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Presionable>
  );
}
