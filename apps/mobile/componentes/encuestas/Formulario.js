// El cuestionario de una encuesta a clientes, NATIVO — la versión de la app de
// `FormularioEncuesta` en modo entrevista: una pregunta por pantalla, las
// preguntas condicionadas aparecen o desaparecen según lo contestado, y al
// final el paso opcional de los datos del cliente con su consentimiento.
//
// El recorrido, lo obligatorio y la regla del contacto salen del núcleo
// (`encuestasClientes`): lo mismo que recorre el cliente en el QR o la tablet.
// No sabe guardar: `onEnviar(respuestas, contacto, segundos)` lo hace quien lo
// monta; si lanza, el error se muestra y nada se pierde.
//
// Ocupa la pantalla ENTERA (2026-11-19, usuario: «hay como saltos o scroll de
// la pantalla solos, no se ve una estética cuidada»). Antes vivía dentro del
// ScrollView de quien lo montaba y saltaba por tres lados:
//   · al pasar de pregunta se quedaba el desplazamiento de la anterior: la
//     siguiente aparecía a media pantalla, o se movía sola al acortarse;
//   · «Marcó 8 de 10» y «Llevas 2» nacían debajo al tocar y empujaban todo;
//   · los botones iban al final del contenido y bailaban con cada pregunta.
// Ahora el progreso queda fijo arriba, los botones fijos abajo (y encima del
// teclado), cada pregunta tiene su propio desplazamiento que nace arriba, y lo
// que aparece al marcar ya tiene su lugar reservado. Además las opciones sin
// marcar tenían la letra blanca fija: en tema claro casi no se leían.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Keyboard, LayoutAnimation, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Presionable as Pressable } from '../Tocable';
import Interruptor from '../Interruptor';
import IconoFijo from '../IconoFijo';
import * as Haptics from 'expo-haptics';
import { ACUERDO, CARITAS, MAX_NUMERO, MAX_TEXTO, motivoParaNoGuardarContacto, opcionesConTexto, primeraSinContestar, recorrido, maximoDe, alternarOpcion, textoDeMaximo, exclusivasDe, guionDeEscala, escalaDePregunta } from '@nucleo/utils/encuestasClientes';
import { nuevaReferencia } from '@nucleo/data/encuestasClientes';
import { colorSistema } from '../Formulario';
import { Aviso, Campo, Vacio } from '../formulario/Piezas';
import { iconoDe } from '../../tema/iconos';
import { MAYUSCULAS } from '../../tema/mayusculas';
import { FONDO_CONTROL, MARCA } from '../inicio/marca';

const IOS = Platform.OS === 'ios';
const tocar = () => Haptics.selectionAsync().catch(() => {});
// El borde va SIEMPRE (transparente si no está marcada): si sólo lo llevara la
// marcada, la fila crecería al tocarla.
const BORDE = 1.5;

/** El círculo (una) o el cuadro (varias) de la izquierda de cada opción. */
function Marca({ elegida, multiple }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: multiple ? 7 : 12, borderWidth: 2,
      borderColor: elegida ? MARCA.azulClaro : colorSistema.separador, backgroundColor: elegida ? MARCA.azulClaro : 'transparent',
      alignItems: 'center', justifyContent: 'center' }}>
      {elegida ? (multiple
        ? <IconoFijo name={iconoDe('Check')} size={14} color="#fff" />
        : <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: '#fff' }} />) : null}
    </View>
  );
}

/** Una opción de lista: su marca, el texto a la izquierda, toda la fila se toca. */
function Fila({ activa, multiple, onPress, children }) {
  return (
    <Pressable onPress={() => { tocar(); onPress(); }} accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked: !!activa }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16,
        backgroundColor: activa ? `${MARCA.azulClaro}24` : FONDO_CONTROL,
        borderWidth: BORDE, borderColor: activa ? MARCA.azulClaro : 'transparent',
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}>
      <Marca elegida={activa} multiple={multiple} />
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, lineHeight: 21, fontWeight: activa ? '600' : '400' }}>{children}</Text>
    </Pressable>
  );
}

/** Un cuadro de una cuadrícula (escala, caritas, sí/no). */
function Cuadro({ activa, onPress, etiqueta, alto = 54, children }) {
  return (
    <Pressable onPress={() => { tocar(); onPress(); }} accessibilityRole="radio" accessibilityState={{ checked: !!activa }} accessibilityLabel={etiqueta}
      style={({ pressed }) => ({
        flex: 1, minHeight: alto, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 6,
        backgroundColor: activa ? MARCA.azul : FONDO_CONTROL, borderWidth: BORDE, borderColor: activa ? MARCA.azul : 'transparent',
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}>
      {typeof children === 'string'
        ? <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{children}</Text>
        : children(activa)}
    </Pressable>
  );
}

/** El renglón de abajo de una respuesta: SIEMPRE ocupa su lugar, haya texto o no. */
const Nota = ({ texto }) => (
  <Text style={{ minHeight: 20, color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{texto || ' '}</Text>
);

// Toda pregunta de puntaje —recomendación 0–10 y las «opción única» de números
// seguidos (1…10)— pintada igual que en el portal: mismas filas (la segunda
// empieza en el 6 en las dos), mismo color al marcar y las puntas SIEMPRE.
function Escala({ e, valor, onChange }) {
  const marcada = e.opciones.find((o) => o.id === valor);
  const mitad = e.opciones.length > 6 ? Math.ceil(e.opciones.length / 2) : e.opciones.length;
  const filas = [e.opciones.slice(0, mitad), e.opciones.slice(mitad)].filter((f) => f.length);
  const punta = marcada && marcada.n === e.min && e.etiquetaMin ? `: ${e.etiquetaMin}` : marcada && marcada.n === e.max && e.etiquetaMax ? `: ${e.etiquetaMax}` : '';
  return (
    <View style={{ gap: 8 }}>
      {filas.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          {f.map((o) => <Cuadro key={o.id} activa={valor === o.id} etiqueta={`${o.n} de ${e.max}`} onPress={() => onChange(o.id)}>{String(o.n)}</Cuadro>)}
          {/* La segunda fila más corta no se estira: los cuadros quedan iguales. */}
          {Array.from({ length: mitad - f.length }, (_, k) => <View key={`h${k}`} style={{ flex: 1 }} />)}
        </View>
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 2 }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '500' }}>{`${e.min} = ${e.etiquetaMin || 'lo más bajo'}`}</Text>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '500', textAlign: 'right' }}>{`${e.max} = ${e.etiquetaMax || 'lo más alto'}`}</Text>
      </View>
      <Nota texto={marcada ? `Marcó ${marcada.n} de ${e.max}${punta}.` : null} />
    </View>
  );
}

function Respuesta({ p, valor, onChange }) {
  switch (p.tipo) {
    case 'nps':
      // La misma escala que satisfacción y confianza (`escalaDePregunta`): con
      // semáforo y filas 0–6 / 7–10 parecía que se puntuaba distinto.
      return <Escala e={escalaDePregunta(p)} valor={valor} onChange={onChange} />;
    case 'csat': {
      // Con su rótulo: sin él 🙁, 😐 y 🙂 se parecen demasiado.
      const marcada = CARITAS.find((c) => c.valor === valor);
      return (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{CARITAS.map((c) => (
            <Cuadro key={c.valor} activa={valor === c.valor} onPress={() => onChange(c.valor)} etiqueta={c.label} alto={84}>
              {(activa) => (<>
                <Text style={{ fontSize: 28 }}>{c.emoji}</Text>
                <Text style={{ color: activa ? '#fff' : colorSistema.texto2, fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>{c.label}</Text>
              </>)}
            </Cuadro>
          ))}</View>
          <Nota texto={marcada ? `Marcó: ${marcada.label.toLowerCase()}.` : null} />
        </View>
      );
    }
    case 'likert':
      return <View style={{ gap: 8 }}>{ACUERDO.map((l, i) => <Fila key={l} activa={valor === i + 1} onPress={() => onChange(i + 1)}>{l}</Fila>)}</View>;
    case 'si_no':
      return (
        <View style={{ flexDirection: 'row', gap: 10 }}>{[[true, 'Sí'], [false, 'No']].map(([v, l]) => (
          <Cuadro key={l} activa={valor === v} onPress={() => onChange(v)} alto={64}>{l}</Cuadro>
        ))}</View>
      );
    case 'unica': {
      const e = escalaDePregunta(p);
      if (e) return <Escala e={e} valor={valor} onChange={onChange} />;
      return <View style={{ gap: 8 }}>{opcionesConTexto(p).map((o) => <Fila key={o.id} activa={valor === o.id} onPress={() => onChange(o.id)}>{o.texto}</Fila>)}</View>;
    }
    case 'multiple': {
      const m = Array.isArray(valor) ? valor : [];
      const maximo = maximoDe(p);
      const exclusivas = exclusivasDe(p);
      return (
        <View style={{ gap: 8 }}>
          {opcionesConTexto(p).map((o) => (
            <Fila key={o.id} multiple activa={m.includes(o.id)} onPress={() => onChange(alternarOpcion(m, o.id, maximo, exclusivas))}>{o.texto}</Fila>
          ))}
        </View>
      );
    }
    case 'ranking': {
      const ops = opcionesConTexto(p);
      const orden = Array.isArray(valor) && valor.length === ops.length ? valor : ops.map((o) => o.id);
      const mover = (i, d) => { const j = i + d; if (j < 0 || j >= orden.length) return; tocar(); const n = [...orden]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
      const flecha = (activa, texto, onPress) => (
        <Pressable disabled={!activa} onPress={onPress} hitSlop={4}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: FONDO_CONTROL, opacity: activa ? (pressed ? 0.6 : 1) : 0.3 })}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 18, fontWeight: '700' }}>{texto}</Text>
        </Pressable>
      );
      return (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Usa las flechas para cambiar el orden. Si ya está como lo dijo, sigue.</Text>
          {orden.map((id, i) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, minHeight: 56, borderRadius: 16, backgroundColor: FONDO_CONTROL }}>
              <Text style={{ width: 22, color: MARCA.azulClaro, fontSize: 16, fontWeight: '700' }}>{i + 1}</Text>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{ops.find((o) => o.id === id)?.texto ?? ''}</Text>
              {flecha(i > 0, '↑', () => mover(i, -1))}
              {flecha(i < orden.length - 1, '↓', () => mover(i, 1))}
            </View>
          ))}
        </View>
      );
    }
    case 'numero':
      return <Campo multiline={false} keyboardType="number-pad" value={valor == null ? '' : String(valor)} style={{ minHeight: 54, fontSize: 18, borderRadius: 16 }}
        onChangeText={(t) => { const d = t.replace(/\D/g, ''); if (d === '') onChange(''); else if (Number(d) <= MAX_NUMERO) onChange(Number(d)); }} placeholder="Escriba la cantidad" />;
    default:
      return <Campo value={valor || ''} maxLength={MAX_TEXTO} style={{ minHeight: 110, borderRadius: 16, paddingTop: 14, textAlignVertical: 'top' }}
        onChangeText={(t) => onChange(t.slice(0, MAX_TEXTO))} placeholder="Lo que respondió, con sus palabras" />;
  }
}

// La ayuda escrita en la encuesta que la pantalla ya dice: «Seleccione hasta
// tres opciones» junto al contador, y «1 = nada · 10 = muy» junto a las
// puntas de la escala. Repetida, sólo era ruido.
function ayudaVisible(p) {
  if (!p.ayuda) return null;
  const e = escalaDePregunta(p);
  if (e && e.etiquetaMin && e.etiquetaMax) return null;
  if (p.tipo === 'multiple' && maximoDe(p) && /hasta/i.test(p.ayuda)) return null;
  return p.ayuda;
}

/** Lo de arriba de una pregunta de varias: cuántas puede marcar y cuántas lleva. */
function cuentaDeVarias(p, valor) {
  if (p.tipo !== 'multiple') return null;
  const maximo = maximoDe(p);
  const n = Array.isArray(valor) ? valor.length : 0;
  if (maximo) return `${textoDeMaximo(maximo)}${n ? ` Llevas ${n}.` : ''}`;
  return n ? `Marca todas las que diga. Llevas ${n}.` : 'Marca todas las que diga.';
}

const duracionTexto = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

/** Los botones de abajo: «atrás» redondo y la acción principal a lo ancho. */
function Pie({ atras, children }) {
  const { bottom } = useSafeAreaInsets();
  const [teclado, setTeclado] = useState(0);
  // iPhone: el pie sube con el teclado, al mismo ritmo. En Android lo hace la
  // ventana sola (adjustResize).
  useEffect(() => {
    if (!IOS) return undefined;
    const mover = (e, alto) => {
      LayoutAnimation.configureNext({ duration: e?.duration || 250, update: { type: LayoutAnimation.Types.keyboard } });
      setTeclado(alto);
    };
    const a = Keyboard.addListener('keyboardWillShow', (e) => mover(e, e.endCoordinates.height));
    const b = Keyboard.addListener('keyboardWillHide', (e) => mover(e, 0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10,
      paddingBottom: teclado ? teclado + 10 : Math.max(bottom, 12) + 4 }}>
      {atras ? (
        <Pressable onPress={atras} accessibilityRole="button" accessibilityLabel="Atrás" hitSlop={4}
          style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: FONDO_CONTROL, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
          <IconoFijo name={iconoDe('ChevronLeft')} size={22} color={colorSistema.texto} />
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}

function Boton({ texto, onPress, secundario = false, apagado = false, ocupado = false }) {
  return (
    <Pressable onPress={ocupado ? undefined : () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      accessibilityRole="button" accessibilityState={{ disabled: ocupado }}
      style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
        backgroundColor: secundario ? FONDO_CONTROL : MARCA.azul, opacity: apagado || ocupado ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: secundario ? colorSistema.texto : '#fff', fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{texto}</Text>
    </Pressable>
  );
}

// La tarjeta de cada paso. No es `Vidrio`: el Liquid Glass no se pintaba en
// las pantallas con campo de texto (la pregunta 1 y los datos del cliente) y
// sí en las demás, así que la entrevista cambiaba de cara a media marcha.
const Tarjeta = ({ children, borde }) => (
  <View style={{ padding: 18, gap: 12, borderRadius: 24, backgroundColor: 'rgba(127,127,127,0.12)',
    borderWidth: BORDE, borderColor: borde || 'rgba(127,127,127,0.18)' }}>{children}</View>
);

const Chip = ({ texto, color, fondo }) => (
  <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: fondo }}>
    <Text style={{ color, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: MAYUSCULAS }}>{texto}</Text>
  </View>
);

export default function Formulario({ encuesta, onEnviar, onEntregarMuestra, onReiniciar, onSalir, contexto, instruccion }) {
  const secciones = useMemo(() => (encuesta?.cuestionario?.secciones || []).filter((s) => (s.preguntas || []).length), [encuesta?.cuestionario]);
  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState({});
  const [faltante, setFaltante] = useState(null);
  const [enContacto, setEnContacto] = useState(false);
  const [contacto, setContacto] = useState({ consiente: false, telefono: '', nombre: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(undefined);
  const [duracion, setDuracion] = useState(null);
  // Desde la primera respuesta; y una referencia por respuesta para que un
  // reintento tras un corte de red no la guarde dos veces.
  const inicio = useRef(null);
  const referencia = useRef(nuevaReferencia());

  const { visibles, limpias } = useMemo(() => recorrido(encuesta?.cuestionario, respuestas), [encuesta?.cuestionario, respuestas]);
  // En el teléfono, UNA pregunta por pantalla (como el portal en teléfono):
  // cada paso lleva su sección para mostrar el título arriba.
  const pasos = secciones.flatMap((s) => visibles.filter((q) => q.seccionId === s.id).map((q) => ({ seccion: s, pregunta: q })));
  const actual = pasos[paso] || null;
  const terminado = resultado !== undefined;
  const progreso = terminado ? 1 : (enContacto ? pasos.length : paso) / (pasos.length + 1);
  const incentivo = encuesta?.incentivo_tipo === 'puntos' && encuesta?.incentivo_puntos ? `Si deja su teléfono, recibe ${encuesta.incentivo_puntos} puntos.`
    : encuesta?.incentivo_tipo === 'muestra' ? `Si deja su teléfono, entrégale: ${encuesta.incentivo_descripcion || 'la muestra médica'}.` : null;
  const clave = terminado ? 'fin' : enContacto ? 'contacto' : actual?.pregunta.id ?? 'vacio';

  // La barra de progreso avanza deslizándose, no a saltos.
  const barra = useRef(new Animated.Value(progreso)).current;
  useEffect(() => {
    Animated.timing(barra, { toValue: progreso, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progreso, barra]);

  // Cada pantalla entra desde el lado hacia el que se va (adelante: derecha).
  const sentido = useRef(1);
  const entrada = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    entrada.setValue(0);
    Animated.timing(entrada, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [clave, entrada]);

  // Sin contestar una obligatoria: la tarjeta se sacude y lo dice.
  const sacudida = useRef(new Animated.Value(0)).current;
  const sacudir = () => {
    sacudida.setValue(0);
    Animated.sequence([10, -8, 6, -4, 0].map((x) => Animated.timing(sacudida, { toValue: x, duration: 55, useNativeDriver: true }))).start();
  };

  const reiniciar = () => {
    sentido.current = 1;
    setPaso(0); setRespuestas({}); setFaltante(null); setEnContacto(false); setContacto({ consiente: false, telefono: '', nombre: '' });
    setError(null); setResultado(undefined); setDuracion(null); inicio.current = null; referencia.current = nuevaReferencia();
    onReiniciar?.();
  };
  const atras = () => {
    Keyboard.dismiss(); sentido.current = -1; setFaltante(null); setError(null);
    if (enContacto) setEnContacto(false); else setPaso((x) => Math.max(0, x - 1));
  };
  const siguiente = () => {
    // Un «ordenar» que no se tocó ya muestra un orden completo: ese orden es la respuesta.
    let conOrden = respuestas;
    if (actual?.pregunta.tipo === 'ranking') {
      const ops = opcionesConTexto(actual.pregunta);
      const r = conOrden[actual.pregunta.id];
      if (!(Array.isArray(r) && r.length === ops.length)) { conOrden = { ...conOrden, [actual.pregunta.id]: ops.map((o) => o.id) }; setRespuestas(conOrden); }
    }
    if (actual) {
      const f = primeraSinContestar([actual.pregunta], conOrden);
      if (f) { setFaltante(f.id); sacudir(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
    }
    Keyboard.dismiss(); sentido.current = 1; setFaltante(null);
    if (paso + 1 >= pasos.length) setEnContacto(true); else setPaso(paso + 1);
  };
  const enviar = async (conDatos) => {
    if (conDatos) { const m = motivoParaNoGuardarContacto(contacto); if (m) { setError(m); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; } }
    Keyboard.dismiss(); setError(null); setEnviando(true);
    const segundos = Math.round((Date.now() - (inicio.current ?? Date.now())) / 1000);
    try {
      const r = await onEnviar(limpias, conDatos ? { consiente: true, telefono: contacto.telefono.trim(), nombre: contacto.nombre.trim() } : null, segundos, referencia.current);
      sentido.current = 1; setDuracion(segundos); setResultado(r || null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) { setError(e?.message || 'No se pudo enviar. Intenta de nuevo.'); }
    setEnviando(false);
  };
  const salir = () => {
    if (!onSalir) return;
    if (terminado || !Object.keys(respuestas).length) { onSalir(); return; }
    Alert.alert('¿Salir de la entrevista?', 'Lo que contestó el cliente se pierde.', [
      { text: 'Seguir', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: onSalir },
    ]);
  };

  if (!secciones.length) return <Vacio titulo="Todavía no hay preguntas para mostrar." />;
  const inc = resultado?.incentivo;
  const p = actual?.pregunta;
  const ultima = paso + 1 >= pasos.length;
  const contestada = p ? !primeraSinContestar([p], respuestas) : true;
  const animada = {
    opacity: entrada,
    transform: [{ translateX: Animated.add(entrada.interpolate({ inputRange: [0, 1], outputRange: [sentido.current * 32, 0] }), sacudida) }],
  };
  const titulo = { color: colorSistema.texto, fontSize: 22, fontWeight: '700', lineHeight: 28, letterSpacing: -0.2 };

  return (
    <View style={{ flex: 1 }}>
      {/* Arriba, fijo: dónde se está, el avance y la sección. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10, gap: 10 }}>
        {contexto || onSalir ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 }}>
            {contexto ? <IconoFijo name={iconoDe('MapPin')} size={15} color={colorSistema.texto2} /> : null}
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>{contexto || ''}</Text>
            {onSalir && !terminado ? (
              <Pressable onPress={salir} accessibilityRole="button" accessibilityLabel="Salir de la entrevista" hitSlop={8}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: FONDO_CONTROL, opacity: pressed ? 0.6 : 1 })}>
                <IconoFijo name={iconoDe('X')} size={12} color={colorSistema.texto} />
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>Salir</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: FONDO_CONTROL, overflow: 'hidden' }}>
          <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: terminado ? MARCA.verde : MARCA.azulClaro,
            width: barra.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 18 }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: MAYUSCULAS }} numberOfLines={1}>
            {terminado ? 'Listo' : enContacto ? 'Datos del cliente' : actual?.seccion.titulo || encuesta?.nombre || ''}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
            {terminado ? '' : enContacto ? 'Último paso' : `${paso + 1} de ${pasos.length}`}
          </Text>
        </View>
      </View>

      {/* En medio: la pantalla del paso, con su propio desplazamiento que nace arriba. */}
      <ScrollView key={clave} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
        <Animated.View style={[{ gap: 14, flexGrow: 1 }, animada]}>
          {terminado ? (
            <View style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32 }}>
              <View style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
                backgroundColor: `${MARCA.verde}26`, borderWidth: 1, borderColor: `${MARCA.verde}55` }}>
                <IconoFijo name={iconoDe('Check')} size={44} color={MARCA.verde} />
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 }}>Respuesta guardada</Text>
              {duracion ? <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`La entrevista duró ${duracionTexto(duracion)}.`}</Text> : null}
              <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
                {inc?.tipo === 'puntos' && inc.estado === 'acreditado' ? <Aviso texto={`Se acreditaron ${inc.puntos} puntos en la cuenta del cliente.`} /> : null}
                {inc?.tipo === 'puntos' && inc.estado === 'pendiente' ? <Aviso tono="cuidado" texto={`Los ${inc.puntos} puntos quedaron pendientes: el teléfono no corresponde a un solo cliente.`} /> : null}
                {inc?.tipo === 'muestra' && inc.estado !== 'entregado' ? <Aviso tono="cuidado" texto={`Entrégale al cliente: ${inc.descripcion || 'la muestra médica'}.`} /> : null}
                {inc?.tipo === 'muestra' && inc.estado === 'entregado' ? <Aviso texto="Muestra entregada." /> : null}
                {error ? <Aviso tono="freno" texto={error} /> : null}
              </View>
            </View>
          ) : enContacto ? (
            <Tarjeta>
                <Text style={titulo}>¿El cliente quiere dejar sus datos?</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14, lineHeight: 19 }}>Es opcional. Sin datos, la respuesta queda anónima.</Text>
                {incentivo ? <Aviso texto={incentivo} /> : null}
                <Campo multiline={false} keyboardType="phone-pad" value={contacto.telefono} style={{ minHeight: 54, borderRadius: 16 }}
                  onChangeText={(t) => { setContacto((c) => ({ ...c, telefono: t })); setError(null); }} placeholder="Teléfono (7777-7777)" />
                <Campo multiline={false} value={contacto.nombre} style={{ minHeight: 54, borderRadius: 16 }}
                  onChangeText={(t) => setContacto((c) => ({ ...c, nombre: t }))} placeholder="Nombre (opcional)" />
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: contacto.consiente }}
                  onPress={() => { tocar(); setContacto((c) => ({ ...c, consiente: !c.consiente })); setError(null); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 4 }}>
                  <Interruptor value={contacto.consiente} onValueChange={(v) => setContacto((c) => ({ ...c, consiente: v }))} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>Consentimiento del cliente</Text>
                    {encuesta.texto_consentimiento ? <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18 }}>{encuesta.texto_consentimiento}</Text> : null}
                  </View>
                </Pressable>
                {error ? <Aviso tono="freno" texto={error} /> : null}
            </Tarjeta>
          ) : p ? (
            <>
              <Tarjeta borde={faltante === p.id ? MARCA.rojo : null}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {p.numeroVisible
                      ? <Chip texto={`Pregunta ${p.numeroVisible}`} color={MARCA.azulClaro} fondo={`${MARCA.azulClaro}24`} />
                      : <Chip texto="Detalle" color={colorSistema.texto2} fondo={FONDO_CONTROL} />}
                    {p.obligatoria ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '500' }}>Obligatoria</Text> : null}
                  </View>
                  <Text style={titulo}>{p.texto || 'Pregunta sin texto'}</Text>
                  {guionDeEscala(p) ? <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600', lineHeight: 19 }}>{guionDeEscala(p)}</Text> : null}
                  {ayudaVisible(p) ? <Text style={{ color: colorSistema.texto2, fontSize: 14, lineHeight: 19 }}>{ayudaVisible(p)}</Text> : null}
                  {cuentaDeVarias(p, respuestas[p.id]) ? <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '500' }}>{cuentaDeVarias(p, respuestas[p.id])}</Text> : null}
                  <View style={{ marginTop: 2 }}>
                    <Respuesta p={p} valor={respuestas[p.id]} onChange={(v) => { if (inicio.current == null) inicio.current = Date.now(); setRespuestas((r) => ({ ...r, [p.id]: v })); if (faltante === p.id) setFaltante(null); }} />
                  </View>
                  {faltante === p.id ? <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Contesta esta pregunta para seguir.</Text> : null}
              </Tarjeta>
              {paso === 0 && instruccion ? <Text style={{ color: colorSistema.texto2, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 }}>{instruccion}</Text> : null}
            </>
          ) : null}
        </Animated.View>
      </ScrollView>

      {/* Abajo, fijo: las acciones del paso. */}
      {terminado ? (
        <Pie>
          {inc?.tipo === 'muestra' && inc.estado !== 'entregado' && onEntregarMuestra && resultado?.id ? (
            <Boton texto="Ya la entregué" onPress={async () => {
              try { await onEntregarMuestra(resultado.id); setResultado((x) => ({ ...x, incentivo: { ...x.incentivo, estado: 'entregado' } })); } catch (e) { setError(e?.message || 'No se pudo marcar la entrega.'); }
            }} />
          ) : (
            <>
              {onSalir ? <Boton texto="Volver" secundario onPress={onSalir} /> : null}
              <Boton texto="Otra entrevista" onPress={reiniciar} />
            </>
          )}
        </Pie>
      ) : enContacto ? (
        <Pie atras={enviando ? undefined : atras}>
          <Boton texto="Sin datos" secundario ocupado={enviando} onPress={() => enviar(false)} />
          <Boton texto={enviando ? 'Enviando…' : 'Enviar'} ocupado={enviando} onPress={() => enviar(true)} />
        </Pie>
      ) : (
        <Pie atras={paso > 0 ? atras : undefined}>
          <Boton texto={ultima ? 'Terminar' : 'Siguiente'} apagado={!contestada && !!p?.obligatoria} onPress={siguiente} />
        </Pie>
      )}
    </View>
  );
}
