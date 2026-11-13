// Las piezas de los formularios nativos (crear solicitudes, contestar,
// recibir): una sección de vidrio con su título, el campo de texto, la lista
// de opciones con palomita, el botón grande y el renglón «dato: valor». Todas
// iguales en toda la app, para que un formulario se sienta como el anterior.
import { useRef, useState } from 'react';
import { ActivityIndicator, Animated, InputAccessoryView, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { BARRA_NATIVA } from '../PilaDePestana';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { iconoDe } from '../../tema/iconos';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL, MARCA } from '../inicio/marca';
import IconoFijo from '../IconoFijo';

const ANDROID = Platform.OS === 'android';

/** Lo que se ve mientras llega una pantalla: siempre a la misma altura. */
// Android: el indicador de carga de Material 3 Expressive (la forma que va
// cambiando), en su contenedor tonal. iOS: el del sistema.
export { default as Cargando } from './Cargando';

/**
 * Una pantalla o lista sin nada que mostrar — LA forma de toda la app
 * (2026-11-11, usuario: «estandaricemos todas las pantallas en cómo muestran
 * que todo está al día; que se vean bonitos»). Un ícono grande en un círculo
 * teñido, el título y el detalle, centrados.
 *
 *   tono 'bien'   → al día / nada pendiente: verde, sello de palomita.
 *   tono 'neutro' → lista vacía o sin resultados: gris, el ícono que se pida
 *                   (`Search` para una búsqueda sin coincidencias).
 *   accion        → { texto, onPress }: un botón discreto debajo.
 *   enSeccion     → dentro de una sección o lista corta: una línea discreta.
 */
// Sin `tono` ni `icono`, se deducen del texto: así los ~120 vacíos que ya
// existían quedaron con la forma nueva sin tocar cada pantalla.
const AL_DIA = /al d[ií]a|nada pendiente|sin pendientes|todo confirmado|nada que revisar|sin incumplimientos|sin atrasos|sin saltos/i;
const BUSQUEDA = /b[uú]squeda|coincid|sin resultados|con ese nombre|para «/i;
const FILTRO = /filtro/i;

export function Vacio({ titulo, detalle, children, enSeccion = false, icono, tono, accion }) {
  if (enSeccion) return <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>{titulo ?? children}</Text>;
  const texto = typeof (titulo ?? children) === 'string' ? (titulo ?? children) : '';
  const bien = (tono ?? (AL_DIA.test(texto) ? 'bien' : 'neutro')) === 'bien';
  const color = bien ? MARCA.verde : colorSistema.texto2;
  const nombre = icono ?? (bien ? 'AlDia' : BUSQUEDA.test(texto) ? 'Search' : FILTRO.test(texto) ? 'Filtro' : 'Bandeja');
  return (
    <View style={{ alignItems: 'center', marginTop: 56, paddingHorizontal: 32, gap: 8 }} accessibilityRole="summary">
      <View style={{ width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
        backgroundColor: bien ? `${MARCA.verde}24` : FONDO_CONTROL, borderWidth: 1, borderColor: bien ? `${MARCA.verde}40` : colorSistema.separador }}>
        <IconoFijo name={iconoDe(nombre)} size={40} color={color} />
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600', textAlign: 'center' }}>{titulo ?? children}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 15, lineHeight: 20, textAlign: 'center' }}>{detalle}</Text> : null}
      {accion ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); accion.onPress?.(); }} accessibilityRole="button" hitSlop={8}
          style={({ pressed }) => ({ marginTop: 10, minHeight: 44, paddingHorizontal: 20, borderRadius: 22, justifyContent: 'center',
            backgroundColor: FONDO_CONTROL, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '600' }}>{accion.texto}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * La pantalla ENTERA cuando no hay qué mostrar: no se encontró el registro, no
 * se pudo leer o el cargo no alcanza (2026-11-12). Antes cada pantalla
 * devolvía un `<Aviso>` suelto: sin `Stack.Screen` el título era el nombre de
 * la ruta («asignar-cuenta») y, con la barra transparente, el texto quedaba
 * debajo de la hora. Acá va la barra con su título y el vacío canónico, bajo
 * la barra.
 *   titulo → el de la barra (lo que la pantalla diría si hubiera cargado)
 *   texto  → qué pasó
 */
export function PantallaSinDato({ titulo = '', texto, detalle, cargando = false }) {
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo, headerLargeTitle: false }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 40 }}>
        {cargando ? <Cargando /> : <Vacio titulo={texto} detalle={detalle} icono="Info" />}
      </ScrollView>
    </>
  );
}

/** Ficha para elegir entre pocas opciones, en línea. */
export function Ficha({ texto, activa, onPress, color = MARCA.azul, deshabilitada }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }} disabled={deshabilitada} accessibilityRole="button" accessibilityState={{ selected: !!activa }}
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
        backgroundColor: activa ? color : FONDO_CONTROL, opacity: deshabilitada ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 15, fontWeight: activa ? '700' : '500' }}>{texto}</Text>
    </Pressable>
  );
}

export function Seccion({ titulo, pie, children }) {
  return (
    <View style={{ gap: 7 }}>
      {titulo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>{titulo}</Text> : null}
      <Vidrio radio={20}><View style={{ padding: 14, gap: 10 }}>{children}</View></Vidrio>
      {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 16 }}>{pie}</Text> : null}
    </View>
  );
}

// Los teclados numéricos del iPhone no traen tecla para cerrarse: sin una
// barra con «Listo», el teclado se queda tapando el botón de enviar y hay que
// adivinar que se baja deslizando. Cada `Campo` numérico trae la suya
// (montada en la raíz no aparecía: la vista del teclado no la encontraba).
const NUMERICOS = new Set(['number-pad', 'decimal-pad', 'numeric', 'phone-pad']);
let siguiente = 0;

function BarraListo({ id }) {
  return (
    <InputAccessoryView nativeID={id}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 6,
        backgroundColor: colorSistema.fila, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: '600' }}>Listo</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

export function Campo({ multiline = true, style, ...props }) {
  const numerico = Platform.OS === 'ios' && NUMERICOS.has(props.keyboardType);
  const [id] = useState(() => `listo-${siguiente++}`);
  return (
    <>
      <TextInput placeholderTextColor={colorSistema.texto2} multiline={multiline}
        inputAccessoryViewID={numerico ? id : undefined} {...props}
        style={[{ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colorSistema.texto,
          backgroundColor: FONDO_CONTROL }, style]} />
      {numerico ? <BarraListo id={id} /> : null}
    </>
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
  // El toque se siente: un golpe leve en cada botón de acción de la app, así
  // ninguna pantalla tiene que acordarse de pedirlo.
  const tocar = onPress ? (e) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(e); } : undefined;
  // Android (Material 3 Expressive): al apretar, la píldora se vuelve más
  // cuadrada y vuelve con resorte, además de la onda. La forma la lleva una
  // capa animada que recorta; el Pressable de adentro sólo pone la onda.
  const forma = useRef(new Animated.Value(25)).current;
  const morfar = (a) => Animated.spring(forma, { toValue: a, useNativeDriver: false, speed: 40, bounciness: 8 }).start();
  const letra = ANDROID ? { color: borde ? color : '#fff', fontSize: 16, fontWeight: '600', letterSpacing: 0.1 }
    : { color: borde ? color : '#fff', fontSize: 17, fontWeight: '700' };
  if (ANDROID) {
    return (
      <Animated.View style={{ borderRadius: forma, overflow: 'hidden', opacity: deshabilitado ? 0.4 : 1,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color }}>
        <Pressable onPress={tocar} disabled={deshabilitado} accessibilityRole="button"
          onPressIn={() => morfar(12)} onPressOut={() => morfar(25)}
          android_ripple={{ color: borde ? `${color}33` : 'rgba(255,255,255,0.28)', foreground: true }}
          style={{ minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }}>
          <Text style={letra}>{texto}</Text>
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Pressable onPress={tocar} disabled={deshabilitado} accessibilityRole="button"
      // iOS: se achica al apretar.
      style={({ pressed }) => ({ minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color,
        opacity: deshabilitado ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Text style={letra}>{texto}</Text>
    </Pressable>
  );
}

export function Dato({ rotulo, valor, primero, fuerte }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingTop: primero ? 0 : 9, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      {/* El rótulo no se encoge: con un valor largo (un número de control) era
          el rótulo el que se partía letra por letra. Ahora el que baja de
          línea es el valor, y el rótulo guarda hasta 170 pt. */}
      <Text style={{ flexShrink: 0, maxWidth: 170, color: colorSistema.texto2, fontSize: 15 }}>{rotulo}</Text>
      <Text style={{ flexGrow: 1, flexShrink: 1, color: colorSistema.texto, fontSize: 15, fontWeight: fuerte ? '800' : '500', fontVariant: ['tabular-nums'], textAlign: 'right' }}>{valor ?? '—'}</Text>
    </View>
  );
}

/** Un aviso dentro de un formulario: freno (rojo), cuidado (ámbar) o nota. */
export function Aviso({ texto, tono = 'nota' }) {
  const color = tono === 'freno' ? MARCA.rojo : tono === 'cuidado' ? MARCA.ambar : colorSistema.texto2;
  return <Text style={{ color, fontSize: 14, fontWeight: tono === 'nota' ? '400' : '600', marginHorizontal: 4 }}>{texto}</Text>;
}

// Una pantalla que trabaja sobre UN registro (un pedido, una reserva) recibe su
// número en la dirección. Si llega sin él —un aviso o un enlace roto—, en vez
// de «Pedido #undefined» y un error de la base, el mismo vacío de PantallaSinDato.
// Se envuelve el componente entero para no cortar los hooks a mitad de camino.
export function exigeParametro(Pantalla, clave, { titulo, texto }) {
  function ConParametro(props) {
    const valor = useLocalSearchParams()[clave];
    if (!valor || valor === 'undefined' || valor === 'null') return <PantallaSinDato titulo={titulo} texto={texto} />;
    return <Pantalla {...props} />;
  }
  ConParametro.displayName = `Exige(${Pantalla.name || 'Pantalla'})`;
  return ConParametro;
}
