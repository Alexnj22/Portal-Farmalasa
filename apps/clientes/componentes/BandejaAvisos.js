// Las piezas de la bandeja de avisos (2026-10-14, «mejóralo visualmente»):
// la lista AGRUPADA del sistema —en iPhone el «inset grouped» de Ajustes y
// Mail, en Android la lista de Material 3 sobre su superficie— con secciones
// Hoy · Ayer · Esta semana · Anteriores. La usan la bandeja
// (app/notificaciones.js) y «Borradas recientemente»
// (app/notificaciones-borradas.js), así que un aviso se ve igual en las dos.
//
// Cada fila: el punto de «sin leer», el ícono de su clase en un círculo de su
// color, el título (en negrita si no se leyó), dos renglones del texto, la
// hora relativa y el chevron si lleva a algún lado. Deslizar:
//   · a la izquierda → «Borrar» (rojo, como en Mail);
//   · a la derecha → «Leída» / «No leída».
// Mantener presionado abre las mismas opciones en la hoja del sistema (en
// Android, la hoja inferior de Material 3 — componentes/HojasAndroid).
import { useRef } from 'react';
import { ActionSheetIOS, Alert, Platform, PlatformColor, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { estiloDeAviso } from './estiloDeAviso';
import { suave, useTema } from '../tema/tema';

const IOS = Platform.OS === 'ios';
const ANDROID = Platform.OS === 'android';
const DIA = 86400_000;
// Las esquinas del grupo: las del inset grouped de iOS 26 y la forma grande
// de Material 3.
export const RADIO_GRUPO = IOS ? 26 : 16;

// El fondo de la fila es OPACO a propósito: las acciones del deslizamiento
// viven DEBAJO de la fila, y con un fondo translúcido el rojo de «Borrar» se
// transparentaba con la fila quieta.
const fondoFila = () => (IOS ? PlatformColor('secondarySystemGroupedBackground') : colorSistema.superficie);
const fondoApretado = () => (IOS ? PlatformColor('systemGray5') : colorSistema.superficieAlta);
const tenue = () => (IOS ? PlatformColor('tertiaryLabel') : colorSistema.texto3);

const claveDia = (f) => `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;
const inicioDelDia = (f) => new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();

/** En qué sección cae una fecha: Hoy, Ayer, Esta semana (los 7 días) o Anteriores. */
export function seccionDe(iso) {
  const f = new Date(iso);
  const hoy = inicioDelDia(new Date());
  const d = inicioDelDia(f);
  if (d >= hoy) return 'Hoy';
  if (d >= hoy - DIA) return 'Ayer';
  if (d >= hoy - 6 * DIA) return 'Esta semana';
  return 'Anteriores';
}

/** La hora del aviso, relativa: «ahora», «hace 5 min», «hace 3 h», «ayer», «lun», «5 oct». */
export function horaRelativa(iso) {
  const f = new Date(iso);
  const min = Math.round((Date.now() - f.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const seccion = seccionDe(iso);
  if (seccion === 'Hoy') return `hace ${Math.round(min / 60)} h`;
  if (seccion === 'Ayer') return 'ayer';
  try {
    if (seccion === 'Esta semana') return f.toLocaleDateString('es-SV', { weekday: 'short' }).replace('.', '');
    return f.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', ...(f.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }).replace('.', '');
  } catch {
    return `${f.getDate()}/${f.getMonth() + 1}`;
  }
}

/**
 * Los avisos en filas para una FlatList: un encabezado por sección y, en cada
 * aviso, si es el primero o el último de su grupo (las esquinas redondeadas y
 * el separador dependen de eso). `fecha` elige qué fecha agrupa.
 */
export function seccionar(avisos, fecha = (a) => a.created_at) {
  const filas = [];
  let actual = null;
  for (const a of avisos) {
    const s = seccionDe(fecha(a));
    if (s !== actual) {
      if (filas.length) filas[filas.length - 1].ultimo = true;
      actual = s;
      filas.push({ clase: 'seccion', clave: `s:${s}`, titulo: s, primeraSeccion: filas.length === 0 });
      filas.push({ clase: 'aviso', clave: `a:${a.id}`, aviso: a, primero: true, ultimo: false });
    } else {
      filas.push({ clase: 'aviso', clave: `a:${a.id}`, aviso: a, primero: false, ultimo: false });
    }
  }
  if (filas.length) filas[filas.length - 1].ultimo = true;
  return filas;
}

/** El rótulo de la sección: grande en iPhone (iOS 26), Title Small de marca en Android. */
export function EncabezadoSeccion({ titulo, primera }) {
  const t = useTema();
  return ANDROID ? (
    <Text accessibilityRole="header"
      style={{ color: t.oscuro ? '#E2A3E0' : '#981D97', fontSize: 14, fontWeight: '500', letterSpacing: 0.1, marginLeft: 16, marginTop: primera ? 4 : 20, marginBottom: 8 }}>
      {titulo}
    </Text>
  ) : (
    <Text accessibilityRole="header"
      style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700', marginLeft: 6, marginTop: primera ? 4 : 22, marginBottom: 8 }}>
      {titulo}
    </Text>
  );
}

// «¿Seguro?» nativo; en la vista previa web `Alert` con botones no hace nada.
export function confirmar(titulo, mensaje, boton, alAceptar, destructivo = true) {
  if (Platform.OS === 'web') {
    if (typeof globalThis.confirm === 'function' && globalThis.confirm(`${titulo}\n\n${mensaje}`)) alAceptar();
    return;
  }
  Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, style: destructivo ? 'destructive' : 'default', onPress: alAceptar },
  ]);
}

/** La hoja de opciones del sistema (en Android la dibuja componentes/HojasAndroid). */
export function hojaDeOpciones({ titulo, opciones }) {
  if (Platform.OS === 'web') return; // en la vista previa web, las acciones van por el deslizamiento
  const lista = [...opciones.map((o) => o.texto), 'Cancelar'];
  const destructivos = opciones.map((o, i) => (o.destructivo ? i : -1)).filter((i) => i >= 0);
  ActionSheetIOS.showActionSheetWithOptions({
    title: titulo, options: lista, cancelButtonIndex: lista.length - 1,
    destructiveButtonIndex: destructivos.length === 1 ? destructivos[0] : destructivos,
  }, (i) => { if (i != null && i < opciones.length) opciones[i].alElegir(); });
}

// La snackbar de «Deshacer» / «Recuperada»: en Android la de Material 3
// (esquinas de 4, superficie invertida); en iPhone, la píldora de siempre.
export function estiloSnack(t) {
  return ANDROID
    ? { radio: 4, fondo: t.oscuro ? '#E6E0E9' : '#322F35', texto: t.oscuro ? '#322F35' : '#F5EFF7', accion: t.oscuro ? '#981D97' : '#E2A3E0' }
    : { radio: 999, fondo: t.oscuro ? '#2C2A31' : '#1C1B1F', texto: '#FFFFFF', accion: t.oscuro ? t.color.magentaTexto : '#FF8AD8' };
}

/** Una acción del deslizamiento: llena el alto de la fila, el ícono crece con el gesto. */
function Accion({ progreso, color, sf, respaldo, texto, etiqueta, alTocar }) {
  const animado = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progreso.value, [0, 1], [0.55, 1], 'clamp') }],
    opacity: interpolate(progreso.value, [0, 0.35, 1], [0, 0.6, 1], 'clamp'),
  }));
  return (
    <Presionable onPress={alTocar} accessibilityRole="button" accessibilityLabel={etiqueta}
      style={{ width: 88, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ alignItems: 'center', gap: 4 }, animado]}>
        <Icono sf={sf} respaldo={respaldo} tam={20} color="#FFFFFF" />
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>{texto}</Text>
      </Animated.View>
    </Presionable>
  );
}

/**
 * Un aviso de la lista agrupada.
 *   · `alAbrir` — tocarlo (abre su destino y lo marca leído; NO lo borra).
 *   · `alAlternarLeido(a, leido)` — deslizar a la derecha o el menú.
 *   · `alBorrar(a)` — deslizar a la izquierda o el menú.
 *   · `accesorio` — en lugar del chevron (p. ej. «Recuperar» en las borradas).
 * Sin `alBorrar` ni `alAlternarLeido` la fila no se desliza.
 */
export function FilaAviso({ a, primero, ultimo, leido = true, alAbrir, alAlternarLeido, alBorrar, accesorio, detalleHora }) {
  const t = useTema();
  const e = estiloDeAviso(t, a.tipo);
  const deslizable = useRef(null);
  const cerrar = () => deslizable.current?.close();
  const nueva = !leido;
  const radios = {
    borderTopLeftRadius: primero ? RADIO_GRUPO : 0, borderTopRightRadius: primero ? RADIO_GRUPO : 0,
    borderBottomLeftRadius: ultimo ? RADIO_GRUPO : 0, borderBottomRightRadius: ultimo ? RADIO_GRUPO : 0,
  };
  const opciones = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const lista = [];
    if (alAlternarLeido) lista.push({ texto: leido ? 'Marcar como no leída' : 'Marcar como leída', alElegir: () => alAlternarLeido(a, !leido) });
    if (a.url && alAbrir) lista.push({ texto: 'Abrir', alElegir: () => alAbrir(a) });
    if (alBorrar) lista.push({ texto: 'Borrar', destructivo: true, alElegir: () => alBorrar(a) });
    if (lista.length) hojaDeOpciones({ titulo: a.titulo, opciones: lista });
  };
  const acciones = [];
  if (alAlternarLeido) acciones.push({ name: 'leido', label: leido ? 'Marcar como no leída' : 'Marcar como leída' });
  if (alBorrar) acciones.push({ name: 'borrar', label: 'Borrar' });

  const contenido = (
    <Presionable onPress={alAbrir ? () => alAbrir(a) : undefined} onLongPress={alBorrar || alAlternarLeido ? opciones : undefined} delayLongPress={380}
      accessibilityRole={alAbrir ? 'button' : undefined}
      accessibilityLabel={`${nueva ? 'No leída. ' : ''}${a.titulo}. ${a.cuerpo}. ${detalleHora ?? horaRelativa(a.created_at)}`}
      accessibilityHint={a.url ? 'Abre el aviso' : undefined}
      accessibilityActions={acciones}
      onAccessibilityAction={(ev) => {
        if (ev.nativeEvent.actionName === 'borrar') alBorrar?.(a);
        else if (ev.nativeEvent.actionName === 'leido') alAlternarLeido?.(a, !leido);
      }}
      style={({ pressed }) => ({ backgroundColor: pressed && alAbrir ? fondoApretado() : fondoFila() })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 4, paddingRight: 14, paddingVertical: 12, minHeight: 72 }}>
        {/* El punto de «sin leer», a la izquierda como en Mail. */}
        <View style={{ width: 18, alignItems: 'center', paddingTop: 15 }}>
          {nueva ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.color.magenta }} /> : null}
        </View>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: e.fuerte, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Icono sf={e.sf} respaldo={e.respaldo} tam={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.6}
              style={{ flex: 1, fontSize: ANDROID ? 16 : 17, fontWeight: nueva ? '700' : (ANDROID ? '500' : '600'), color: colorSistema.texto, letterSpacing: ANDROID ? 0.15 : -0.2 }}>
              {a.titulo}
            </Text>
            <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 13, fontWeight: nueva ? '600' : '400', color: nueva ? t.color.magentaTexto : colorSistema.texto3 }}>
              {detalleHora ?? horaRelativa(a.created_at)}
            </Text>
          </View>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.6}
            style={{ fontSize: ANDROID ? 14 : 15, lineHeight: 20, letterSpacing: ANDROID ? 0.25 : 0, color: colorSistema.texto2 }}>
            {a.cuerpo}
          </Text>
        </View>
        {accesorio ?? (a.url ? (
          <View style={{ alignSelf: 'center', paddingLeft: 8 }}>
            <Icono sf="chevron.right" respaldo="›" tam={13} color={tenue()} />
          </View>
        ) : null)}
      </View>
      {/* El separador, sangrado hasta el texto como en la lista del sistema. */}
      {ultimo ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colorSistema.separador, marginLeft: 72 }} />}
    </Presionable>
  );

  return (
    <Animated.View exiting={FadeOut.duration(160)}
      // Las esquinas del grupo recortan también las acciones del deslizamiento.
      style={[radios, { overflow: 'hidden', backgroundColor: fondoFila() }]}>
      {alBorrar || alAlternarLeido ? (
        <ReanimatedSwipeable
          ref={deslizable}
          friction={1.6}
          leftThreshold={64}
          rightThreshold={64}
          overshootLeft={false}
          overshootRight={false}
          onSwipeableWillOpen={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }}
          renderLeftActions={alAlternarLeido ? (progreso) => (
            <Accion progreso={progreso} color={leido ? t.color.magenta : '#0A84FF'}
              sf={leido ? 'envelope.badge.fill' : 'envelope.open.fill'} respaldo={leido ? '●' : '○'}
              texto={leido ? 'No leída' : 'Leída'} etiqueta={leido ? 'Marcar como no leída' : 'Marcar como leída'}
              alTocar={() => { cerrar(); alAlternarLeido(a, !leido); }} />
          ) : undefined}
          renderRightActions={alBorrar ? (progreso) => (
            <Accion progreso={progreso} color={IOS ? PlatformColor('systemRed') : '#B3261E'} sf="trash.fill" respaldo="✕"
              texto="Borrar" etiqueta="Borrar este aviso" alTocar={() => { cerrar(); alBorrar(a); }} />
          ) : undefined}
        >
          {contenido}
        </ReanimatedSwipeable>
      ) : contenido}
    </Animated.View>
  );
}

/** El color suave del círculo de un estado vacío o de una pastilla. */
export const velo = (t, color) => suave(color, t.oscuro ? 0.28 : 0.14);
