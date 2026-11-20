// Las piezas de los formularios nativos (crear solicitudes, contestar,
// recibir): una sección de vidrio con su título, el campo de texto, la lista
// de opciones con palomita, el botón grande y el renglón «dato: valor». Todas
// iguales en toda la app, para que un formulario se sienta como el anterior.
import { useRef, useState } from 'react';
import { Animated, Appearance, InputAccessoryView, Keyboard, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import Indicador from '../Indicador';
import { Stack, useLocalSearchParams } from 'expo-router';
import { BARRA_NATIVA } from '../PilaDePestana';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { iconoDe } from '../../tema/iconos';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL, MARCA, tintaSobre } from '../inicio/marca';
import IconoFijo from '../IconoFijo';
import { MAYUSCULAS } from '../../tema/mayusculas';
import { papel, pozo, relieve } from '../../tema/papel';

const ANDROID = Platform.OS === 'android';
const IOS = Platform.OS === 'ios';
// iPhone, línea Mostrador: el modo se lee al pintar para el relieve y el pozo.
const oscuroAhora = () => Appearance.getColorScheme() === 'dark';

/** Lo que se ve mientras llega una pantalla: siempre a la misma altura. */
// Android: el indicador de carga de Material 3 Expressive (la forma que va
// cambiando), en su contenedor tonal. iOS: el del sistema.
import Cargando from './Cargando';
export { Cargando };

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
  // iPhone, línea Mostrador · Vacíos A «Círculo hundido»: el ícono en un pozo
  // redondo de 72 con sombra interior; el tono lo tiñe al 14 %.
  const o = oscuroAhora();
  const circulo = IOS
    ? { width: 72, height: 72, borderRadius: 36, backgroundColor: bien ? `${MARCA.verde}24` : papel(o).hundida, boxShadow: pozo(o) }
    : { width: 88, height: 88, borderRadius: 44, backgroundColor: bien ? `${MARCA.verde}24` : FONDO_CONTROL, borderWidth: 1, borderColor: bien ? `${MARCA.verde}40` : colorSistema.separador };
  return (
    <View style={{ alignItems: 'center', marginTop: 56, paddingHorizontal: 32, gap: 8 }} accessibilityRole="summary">
      <View style={[{ alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, circulo]}>
        <IconoFijo name={iconoDe(nombre)} size={IOS ? 32 : 40} color={color} />
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '600', letterSpacing: IOS ? -0.3 : 0, textAlign: 'center' }}>{titulo ?? children}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 15, lineHeight: 20, textAlign: 'center', maxWidth: 300 }}>{detalle}</Text> : null}
      {accion ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); accion.onPress?.(); }} accessibilityRole="button" hitSlop={8}
          style={({ pressed }) => ({ marginTop: 10, minHeight: 44, paddingHorizontal: 20, borderRadius: 999, justifyContent: 'center',
            backgroundColor: IOS ? papel(o).superficie : FONDO_CONTROL, boxShadow: IOS ? relieve(o, 'control') : undefined,
            opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
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
      // iPhone, línea Mostrador: píldora con relieve; la elegida, sólida.
      style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
        backgroundColor: activa ? (IOS ? deAccion(color) : color) : (IOS ? papel(oscuroAhora()).superficie : FONDO_CONTROL),
        boxShadow: IOS ? relieve(oscuroAhora(), 'control') : undefined,
        opacity: deshabilitada ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 15, fontWeight: activa ? '700' : '500' }}>{texto}</Text>
    </Pressable>
  );
}

export function Seccion({ titulo, pie, children }) {
  return (
    <View style={{ gap: 7 }}>
      {titulo ? <Text style={ANDROID
        // Android: el subtítulo de lista de Material 3 — primario, 14, medio.
        ? { color: colorSistema.acento, fontSize: 14, fontWeight: '500', marginLeft: 16 }
        : { color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: MAYUSCULAS, letterSpacing: 0.4, marginLeft: 16 }}>{titulo}</Text> : null}
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

// `onSiguiente`: el teclado numérico del iPhone no tiene tecla de avance, y
// llenar una lista de cantidades (el conteo) era tocar afuera para cerrar y
// tocar el campo siguiente, por cada renglón. Con él, la barra ofrece
// «Siguiente» además de «Listo».
function BarraListo({ id, onSiguiente }) {
  return (
    <InputAccessoryView nativeID={id}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 24, paddingHorizontal: 16, paddingVertical: 6,
        backgroundColor: colorSistema.fila, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        {onSiguiente ? (
          <Pressable onPress={onSiguiente} hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: '600' }}>Siguiente</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: onSiguiente ? '400' : '600' }}>Listo</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

// Android: el campo «relleno» de Material 3 — contenedor tonal con las
// esquinas de arriba redondeadas y una línea abajo que se vuelve primaria y
// más gruesa al escribir (2026-11-13). iPhone: el campo gris redondeado.
function CampoAndroid({ multiline, style, onFocus, onBlur, ...props }) {
  const [foco, setFoco] = useState(false);
  return (
    <TextInput placeholderTextColor={colorSistema.texto2} multiline={multiline} {...props}
      cursorColor={colorSistema.acento} selectionColor={`${String(colorSistema.acento).slice(0, 7)}55`}
      selectionHandleColor={colorSistema.acento}
      onFocus={(e) => { setFoco(true); onFocus?.(e); }} onBlur={(e) => { setFoco(false); onBlur?.(e); }}
      style={[{ minHeight: 52, borderTopLeftRadius: 4, borderTopRightRadius: 4, paddingHorizontal: 16, paddingVertical: 14,
        fontSize: 16, color: colorSistema.texto, backgroundColor: colorSistema.relleno,
        borderBottomWidth: foco ? 2 : 1, borderBottomColor: foco ? colorSistema.acento : colorSistema.texto2 }, style]} />
  );
}

export function Campo({ multiline = true, style, onSiguiente, ...props }) {
  const numerico = Platform.OS === 'ios' && NUMERICOS.has(props.keyboardType);
  const [id] = useState(() => `listo-${siguiente++}`);
  // Android: la tecla de acción del teclado hace de «Siguiente».
  if (ANDROID) {
    return <CampoAndroid multiline={multiline} style={style} {...props}
      {...(onSiguiente ? { returnKeyType: 'next', submitBehavior: 'submit', onSubmitEditing: (e) => { props.onSubmitEditing?.(e); onSiguiente(); } } : null)} />;
  }
  return (
    <>
      <TextInput placeholderTextColor={colorSistema.texto2} multiline={multiline}
        inputAccessoryViewID={numerico ? id : undefined} {...props}
        // Línea Mostrador · Campos B «Pozo»: papel hundido con sombra interior;
        // píldora si es de una línea, 22 si es de varias.
        style={[{ minHeight: 44, borderRadius: multiline ? 22 : 999, paddingHorizontal: 16, paddingVertical: 11, fontSize: 16, color: colorSistema.texto,
          backgroundColor: papel(oscuroAhora()).hundida, boxShadow: pozo(oscuroAhora()) }, style]} />
      {numerico ? <BarraListo id={id} onSiguiente={onSiguiente} /> : null}
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
            {ANDROID ? (
              // Android: el botón de opción de Material 3, no la palomita de iOS.
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
                borderColor: valor === id ? colorSistema.acento : colorSistema.texto2 }}>
                {valor === id ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorSistema.acento }} /> : null}
              </View>
            ) : valor === id ? <Text style={{ color, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// En Android el color por omisión es el primario del sistema (Material You).
// iPhone, línea Mostrador: la ACCIÓN va en la marca. El verde queda para el
// éxito, no para un botón (Diálogos C: «Aprobar» se pinta con la marca), y la
// marca-texto (`azulClaro`, clara en oscuro) como relleno se vuelve la marca.
function deAccion(color) {
  if (!IOS) return color;
  return color === MARCA.verde || color === MARCA.azulClaro ? MARCA.azul : color;
}

export function BotonGrande({ texto, color: pedido = ANDROID ? colorSistema.acento : MARCA.azul, onPress, deshabilitado, borde = false }) {
  const color = deAccion(pedido);
  // El toque se siente: un golpe leve en cada botón de acción de la app, así
  // ninguna pantalla tiene que acordarse de pedirlo.
  const tocar = onPress ? (e) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(e); } : undefined;
  // Android (Material 3 Expressive): al apretar, la píldora se vuelve más
  // cuadrada y vuelve con resorte, además de la onda. La forma la lleva una
  // capa animada que recorta; el Pressable de adentro sólo pone la onda.
  const forma = useRef(new Animated.Value(25)).current;
  const morfar = (a) => Animated.spring(forma, { toValue: a, useNativeDriver: false, speed: 40, bounciness: 8 }).start();
  const letra = ANDROID ? { color: borde ? color : tintaSobre(color), fontSize: 16, fontWeight: '600', letterSpacing: 0.1 }
    : { color: borde ? color : '#fff', fontSize: 17, fontWeight: '700' };
  if (ANDROID) {
    return (
      <Animated.View style={{ borderRadius: forma, overflow: 'hidden', opacity: deshabilitado ? 0.4 : 1,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color }}>
        <Pressable onPress={tocar} disabled={deshabilitado} accessibilityRole="button"
          onPressIn={() => morfar(12)} onPressOut={() => morfar(25)}
          android_ripple={{ color: borde ? `${String(color).slice(0, 7)}33` : 'rgba(255,255,255,0.28)', foreground: true }}
          style={{ minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 }}>
          <Text style={letra}>{texto}</Text>
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Pressable onPress={tocar} disabled={deshabilitado} accessibilityRole="button"
      // iOS: se achica al apretar.
      // Línea Mostrador · Botón B «Brillo»: píldora, aro de luz interior y
      // resplandor del color; apretado, escala .96; apagado, .45.
      style={({ pressed }) => ({ minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
        backgroundColor: borde ? 'transparent' : color, borderWidth: borde ? 1.5 : 0, borderColor: color,
        boxShadow: borde || deshabilitado || typeof color !== 'string' ? undefined
          : `inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08), 0 8px 20px -8px ${color}99`,
        opacity: deshabilitado ? 0.45 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
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
  // iPhone, línea Mostrador · Avisos A: el freno y el cuidado son una ficha del
  // tono al 10 %, radio 16, con el ícono en un círculo de 28 del tono y el
  // texto en tinta 2. La nota sigue siendo una línea discreta.
  if (IOS && tono !== 'nota') {
    return (
      <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: `${color}1A` }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${color}2E`, alignItems: 'center', justifyContent: 'center' }}>
          <IconoFijo name={iconoDe('AlertTriangle')} size={15} color={color} />
        </View>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14, fontWeight: '500', lineHeight: 19 }}>{texto}</Text>
      </View>
    );
  }
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
