// Historias: el carrusel tipo «estados» (pedido del usuario, 2026-10-06).
// Imágenes con promociones o información que el portal publica
// (`app_historias`, editor en Ofertas para clientes) y que la app muestra:
//
//   · arriba, círculos con la foto; el aro de colores dice «sin ver», el gris
//     «ya la viste» (lo visto se recuerda en el teléfono);
//   · al tocar, pantalla completa con barras de progreso: avanza sola a los
//     6 s, tocar a la derecha pasa, a la izquierda vuelve, mantener presionado
//     pausa, deslizar hacia abajo cierra; y si la historia lleva enlace, un
//     botón para ir (a una oferta, a sucursales…); con oferta, «Reservar»;
//     y siempre «Más información» por WhatsApp con la empresa.
//   · cada vista se anota en el servidor: el portal cuenta quién la vio.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Dimensions, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ImagenCache } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorSistema } from './sistema';
import { useSesion } from '../lib/sesion';
import { useBloqueo } from '../lib/bloqueo';
import { llamar } from '../lib/api';
import { idDispositivo } from '../lib/dispositivo';
import { useTema } from '../tema/tema';
import Icono from './Icono';
import IconoWhatsapp from './IconoWhatsapp';

const CLAVE = 'puntos_salud_historias_vistas';
const DURACION = 6000;

// Cuándo se pidieron por última vez: al volver a la pestaña no se piden de
// nuevo antes de un minuto (cada pedido firmaba las fotos otra vez).
let pedidasAt = 0;
let pedidasPara = null;

export default function Historias({ generacion = 0 }) {
  const t = useTema();
  const token = useSesion((s) => s.token);
  const pedir = useSesion((s) => s.pedir);
  const [lista, setLista] = useState([]);
  const [vistas, setVistas] = useState(new Set());
  const [abierta, setAbierta] = useState(null);
  // Bloqueada con Face ID: el visor se oculta (un Modal queda por encima del bloqueo).
  const bloqueada = useBloqueo((s) => s.bloqueada);

  useFocusEffect(useCallback(() => {
    const clave = `${token ?? ''}|${generacion}`;
    if (lista.length && pedidasPara === clave && Date.now() - pedidasAt < 60_000) return;
    pedidasPara = clave;
    pedidasAt = Date.now();
    (token ? pedir('historias') : llamar('historias_publicas')).then((r) => { if (r?.ok) { setLista(r.historias ?? []); if (r.whatsapp) whatsapp = r.whatsapp; } });
    SecureStore.getItemAsync(CLAVE).catch(() => null).then((v) => { try { setVistas(new Set(JSON.parse(v ?? '[]'))); } catch { /* vacío */ } });
  }, [token, pedir, generacion])); // eslint-disable-line react-hooks/exhaustive-deps -- `lista` sólo decide si hace falta pedir

  // Anota en el servidor que se vio (o que se tocó un botón), para que el
  // portal sepa cuántos la vieron. Sin cuenta, con el id aleatorio del teléfono.
  const anotar = async (id, boton = false) => {
    const dispositivo = await idDispositivo();
    const b = { id, boton, dispositivo };
    (token ? pedir('historia_vista', b) : llamar('historia_vista_publica', b)).catch(() => {});
  };
  const marcar = (id) => setVistas((prev) => {
    if (prev.has(String(id))) return prev;
    anotar(id);
    const nuevo = new Set(prev).add(String(id));
    SecureStore.setItemAsync(CLAVE, JSON.stringify([...nuevo].slice(-100))).catch(() => {});
    return nuevo;
  });

  if (!lista.length) return null;
  // Las sin ver primero.
  const orden = [...lista].sort((a, b) => Number(vistas.has(String(a.id))) - Number(vistas.has(String(b.id))));

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: 2, paddingVertical: 2 }}>
        {orden.map((h, i) => {
          const vista = vistas.has(String(h.id));
          return (
            <Pressable key={h.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta({ i, lista: orden }); }}
              accessibilityRole="button" accessibilityLabel={`Historia: ${h.titulo}`}
              style={({ pressed }) => ({ alignItems: 'center', width: 76, gap: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
              <LinearGradient colors={vista ? ['#9A9AA2', '#9A9AA2'] : ['#FFD60A', t.color.magenta, '#5B1E9C']}
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={{ padding: 3, borderRadius: 40 }}>
                <View style={{ padding: 2.5, borderRadius: 37, backgroundColor: t.oscuro ? '#121016' : '#F5F4F8' }}>
                  <ImagenCache source={{ uri: h.imagen, cacheKey: h.imagen_clave ?? undefined }} cachePolicy="memory-disk" transition={150} style={{ width: 64, height: 64, borderRadius: 32 }} />
                </View>
              </LinearGradient>
              {/* El rótulo corto (o la primera palabra): el título entero no cabía. */}
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: vista ? '500' : '700', color: vista ? colorSistema.texto3 : colorSistema.texto }}>
                {h.rotulo || String(h.titulo ?? '').split(/\s+/)[0]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {abierta != null && !bloqueada ? (
        <Visor historias={abierta.lista} inicio={abierta.i} alVer={marcar} alTocarBoton={(id) => anotar(id, true)} alCerrar={() => setAbierta(null)} />
      ) : null}
    </>
  );
}

function Visor({ historias, inicio, alVer, alTocarBoton, alCerrar }) {
  const ins = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get('window');
  const [i, setI] = useState(inicio);
  const avance = useSharedValue(0);
  const caida = useSharedValue(0);
  const h = historias[i];
  const siguienteRef = useRef(null);
  // Con VoiceOver no avanza sola: se pasa con las acciones «Siguiente»/«Anterior».
  const lectorRef = useRef(false);
  useEffect(() => { AccessibilityInfo.isScreenReaderEnabled().then((v) => { lectorRef.current = v; if (v) cancelAnimation(avance); }).catch(() => {}); }, [avance]);

  const cerrar = useCallback(() => alCerrar(), [alCerrar]);
  const ir = useCallback((n) => {
    if (n < 0) { avance.value = 0; arrancar(); return; }
    if (n >= historias.length) { cerrar(); return; }
    Haptics.selectionAsync().catch(() => {});
    setI(n);
  }, [historias.length, cerrar]); // eslint-disable-line react-hooks/exhaustive-deps
  siguienteRef.current = () => ir(i + 1);
  const siguiente = () => siguienteRef.current?.();

  const arrancar = () => {
    if (lectorRef.current) return; // con VoiceOver no avanza sola
    avance.value = withTiming(1, { duration: DURACION * (1 - avance.value), easing: Easing.linear }, (fin) => { if (fin) runOnJS(siguiente)(); });
  };
  useEffect(() => {
    alVer(h.id);
    avance.value = 0;
    if (historias[i + 1]?.imagen) ImagenCache.prefetch(historias[i + 1].imagen, 'memory-disk').catch(() => {});
    arrancar();
    return () => cancelAnimation(avance);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const pausar = () => cancelAnimation(avance);
  const seguir = () => arrancar();

  // El ancho se lee AQUÍ, en el hilo de JavaScript: el gesto corre en el
  // hilo de la interfaz, y llamar `Dimensions` desde ahí cerraba la app al
  // tocar para pasar (probado en TestFlight el 2026-10-06).
  const tercio = W / 3;
  const toque = Gesture.Tap().maxDuration(250).onEnd((e) => {
    runOnJS(ir)(e.absoluteX < tercio ? i - 1 : i + 1);
  });
  const mantener = Gesture.LongPress().minDuration(200).onStart(() => runOnJS(pausar)()).onEnd(() => runOnJS(seguir)());
  const deslizar = Gesture.Pan().activeOffsetY(12)
    .onUpdate((e) => { caida.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) runOnJS(cerrar)();
      else caida.value = withSpring(0);
    });
  const gestos = Gesture.Exclusive(deslizar, mantener, toque);

  const estiloCaida = useAnimatedStyle(() => ({
    transform: [{ translateY: caida.value }, { scale: 1 - Math.min(caida.value / H, 0.15) }],
    borderRadius: Math.min(caida.value / 4, 30),
  }));
  const barra = useAnimatedStyle(() => ({ width: `${avance.value * 100}%` }));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cerrar} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
        <GestureDetector gesture={gestos}>
          <Animated.View style={[{ flex: 1, overflow: 'hidden', backgroundColor: '#000' }, estiloCaida]}
            accessible accessibilityLabel={`Historia ${i + 1} de ${historias.length}: ${h.titulo}. ${h.texto ?? ''}`}
            accessibilityActions={[{ name: 'increment', label: 'Siguiente' }, { name: 'decrement', label: 'Anterior' }, { name: 'escape', label: 'Cerrar' }]}
            onAccessibilityAction={(e) => { const a = e.nativeEvent.actionName; if (a === 'increment') ir(i + 1); else if (a === 'decrement') ir(i - 1); else cerrar(); }}
            onAccessibilityEscape={cerrar}>
            <ImagenCache source={{ uri: h.imagen, cacheKey: h.imagen_clave ?? undefined }} cachePolicy="memory-disk" contentFit="cover" transition={180} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 160 }} />
            <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 320 }} />

            {/* Barras de progreso y cerrar. */}
            <View style={{ position: 'absolute', top: ins.top + 8, left: 10, right: 10, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {historias.map((x, n) => (
                  <View key={x.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
                    {n < i ? <View style={{ flex: 1, backgroundColor: '#FFF' }} />
                      : n === i ? <Animated.View style={[{ height: 3, backgroundColor: '#FFF' }, barra]} /> : null}
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Image source={require('../assets/icono.png')} style={{ width: 28, height: 28, borderRadius: 8 }} />
                  <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Farmacia Salud</Text>
                  {/* Duran 24 horas: cuándo se publicó, como en un estado. */}
                  {h.publicada_at ? <Text style={{ color: 'rgba(255,255,255,0.75)', fontWeight: '600', fontSize: 13 }}>{haceCuanto(h.publicada_at)}</Text> : null}
                </View>
                <Pressable onPress={cerrar} hitSlop={14} accessibilityRole="button" accessibilityLabel="Cerrar">
                  <Icono sf="xmark" respaldo="✕" tam={20} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            {/* Texto y botón. */}
            <View style={{ position: 'absolute', left: 20, right: 20, bottom: ins.bottom + 28, gap: 10 }}>
              <Text style={{ color: '#FFF', fontSize: 28, fontWeight: '900', letterSpacing: -0.5 }}>{h.titulo}</Text>
              {h.texto ? <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 23 }}>{h.texto}</Text> : null}
              {/* Con oferta: «Reservar» la abre lista para reservar. Si no, el
                  botón propio de la historia. Y siempre «Más información», que
                  abre WhatsApp con la empresa y el nombre de la historia. */}
              <View style={{ marginTop: 8, gap: 10 }}>
                {h.oferta_id || h.enlace ? (
                  <BotonHistoria principal sf={h.oferta_id ? 'bag.fill' : 'arrow.right'} texto={h.oferta_id ? 'Reservar' : (h.boton || 'Ver más')}
                    alTocar={() => {
                      alTocarBoton?.(h.id);
                      const destino = h.oferta_id ? `/oferta/${h.oferta_id}?reservar=1` : h.enlace;
                      cerrar(); setTimeout(() => router.push(destino), 250);
                    }} />
                ) : null}
                <BotonHistoria icono={<IconoWhatsapp tam={18} color="#FFFFFF" />} texto="Más información"
                  alTocar={() => {
                    alTocarBoton?.(h.id);
                    pausar();
                    const msg = encodeURIComponent(`Hola, quiero más información sobre «${h.titulo}».`);
                    Linking.openURL(`https://wa.me/${whatsapp}?text=${msg}`).catch(() => {});
                  }} />
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** «hace 5 min», «hace 3 h»: las historias duran 24 horas. */
function haceCuanto(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}

// El WhatsApp de la empresa: lo manda el servidor; éste es el de respaldo.
let whatsapp = '50323010013';

function BotonHistoria({ principal, sf, icono, texto, alTocar }) {
  return (
    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); alTocar(); }}
      accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 50, borderRadius: 999,
        backgroundColor: principal ? '#FFFFFF' : 'rgba(255,255,255,0.18)',
        borderWidth: principal ? 0 : 1, borderColor: 'rgba(255,255,255,0.45)', transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      {icono ?? <Icono sf={sf} respaldo="" tam={17} color={principal ? '#2B0B3A' : '#FFFFFF'} />}
      <Text maxFontSizeMultiplier={1.3} style={{ color: principal ? '#2B0B3A' : '#FFFFFF', fontSize: 17, fontWeight: '800' }}>{texto}</Text>
    </Pressable>
  );
}
