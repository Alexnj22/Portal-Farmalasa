// La bandeja: los avisos que ya te llegaron al teléfono, para verlos otra vez
// (pedido del usuario, 2026-10-06). Salen de `app_cliente_avisos`, la misma
// bitácora que impide mandar dos veces; al abrir la bandeja se marcan leídos.
// Tocar uno lleva a donde llevaba el aviso.
//
// Rediseño (2026-10-09, «que se vea más moderno, con opción de limpiar»):
// agrupada por día, ícono y color por clase de aviso (los mismos del banner
// con la app abierta), deslizar a la izquierda para borrar uno y «Limpiar»
// arriba para borrar todos. Borrar es OCULTAR, y desde el mismo día en el
// servidor (`bandeja_ocultar` marca `oculto_at`): se va de todos los teléfonos
// de la persona. La fila no se borra —es la bitácora que evita el aviso
// repetido—. El ocultamiento local (lib/bandejaOculta.js) es el optimista y el
// respaldo: lo que el servidor no confirmó se reintenta en la próxima carga.
//
// Lo nuevo se distingue durante la visita aunque el servidor ya lo haya dado
// por leído al abrir (la campana se apaga enseguida); «Marcar como leídas»
// apaga el resaltado.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import Animated, { FadeOut, LinearTransition, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import Vidrio from '../componentes/Vidrio';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { estiloDeAviso } from '../componentes/estiloDeAviso';
import { useSesion } from '../lib/sesion';
import { alLlegarAviso } from '../lib/avisos';
import { leerOcultas, olvidar, ocultar } from '../lib/bandejaOculta';
import { suave, useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';

const DIA = 86400_000;
const claveDia = (f) => `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;

/** «Hoy», «Ayer», «Lunes 5 de octubre» (con el año si no es este). */
function rotuloDia(f) {
  const hoy = new Date();
  if (claveDia(f) === claveDia(hoy)) return 'Hoy';
  if (claveDia(f) === claveDia(new Date(hoy.getTime() - DIA))) return 'Ayer';
  try {
    const s = f.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', ...(f.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return `${f.getDate()}/${f.getMonth() + 1}/${f.getFullYear()}`;
  }
}

/** La hora del aviso: relativa si es de hoy, el reloj si es de antes. */
function hora(iso) {
  const f = new Date(iso);
  const min = Math.round((Date.now() - f.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (claveDia(f) === claveDia(new Date()) && min < 6 * 60) return `hace ${Math.round(min / 60)} h`;
  try {
    return f.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return `${f.getHours()}:${String(f.getMinutes()).padStart(2, '0')}`;
  }
}

/** Los avisos en filas: un encabezado por día y sus avisos debajo. */
function agrupar(avisos) {
  const filas = [];
  let actual = null;
  for (const a of avisos) {
    const f = new Date(a.created_at);
    const k = claveDia(f);
    if (k !== actual) { actual = k; filas.push({ clase: 'dia', clave: `dia:${k}`, titulo: rotuloDia(f) }); }
    filas.push({ clase: 'aviso', clave: `a:${a.id}`, aviso: a });
  }
  return filas;
}

// «¿Seguro?» nativo; en la vista previa web `Alert` con botones no hace nada.
function confirmar(titulo, mensaje, boton, alAceptar) {
  if (Platform.OS === 'web') {
    if (typeof globalThis.confirm === 'function' && globalThis.confirm(`${titulo}\n\n${mensaje}`)) alAceptar();
    return;
  }
  Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, style: 'destructive', onPress: alAceptar },
  ]);
}

export default function Notificaciones() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [ocultas, setOcultas] = useState(null);
  const [vistas, setVistas] = useState(() => new Set()); // tocadas en esta visita
  const [todasVistas, setTodasVistas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);

  useEffect(() => { leerOcultas().then((s) => setOcultas(new Set(s))); }, []);
  // Le pide al servidor que oculte; si confirma, la lista local los olvida.
  // Si no (sin conexión, o la base todavía sin `oculto_at`), quedan ocultos
  // acá y se reintenta en la próxima carga. Nunca lanza.
  const sincronizar = useCallback(async (datos, ids) => {
    try {
      const r = await pedir('bandeja_ocultar', datos);
      if (r?.ok && ids.length) setOcultas(new Set(await olvidar(ids)));
    } catch { /* queda el ocultamiento local */ }
  }, [pedir]);
  const cargar = useCallback(async () => {
    const r = await pedir('bandeja');
    setD((ant) => (r?.ok || !ant?.ok ? r : ant));
    if (r?.ok && r.sin_leer) pedir('bandeja_leida');
    // Borrados en el teléfono que el servidor todavía devuelve: reintentar.
    if (r?.ok && !r.sinConexion) {
      const locales = await leerOcultas();
      const pendientes = (r.avisos ?? []).map((a) => Number(a.id)).filter((id) => locales.has(id));
      if (pendientes.length) sincronizar({ ids: pendientes }, pendientes);
    }
  }, [pedir, sincronizar]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Llega un aviso con la bandeja a la vista: se recarga sola. Con un respiro,
  // porque el envío marca la fila como enviada un instante después del push.
  useEffect(() => alLlegarAviso(() => { setTimeout(() => { setTodasVistas(false); cargar(); }, 1500); }), [cargar]);
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const visibles = useMemo(
    () => (d?.ok && ocultas ? (d.avisos ?? []).filter((a) => !ocultas.has(Number(a.id))) : []),
    [d, ocultas],
  );
  const esNueva = useCallback((a) => !a.leido_at && !todasVistas && !vistas.has(a.id), [todasVistas, vistas]);
  const nuevas = visibles.filter(esNueva).length;
  const filas = useMemo(() => agrupar(visibles), [visibles]);

  // Primero acá (al instante), después en el servidor.
  const borrar = useCallback(async (ids, todas = false) => {
    const s = await ocultar(ids);
    setOcultas(new Set(s));
    const nums = ids.map(Number).filter(Number.isFinite);
    sincronizar(todas ? { todas: true, hasta_id: Math.max(...nums) } : { ids: nums }, nums);
  }, [sincronizar]);
  const borrarUna = useCallback((a) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    borrar([a.id]);
  }, [borrar]);
  const limpiarTodo = useCallback(() => {
    if (!visibles.length) return;
    confirmar('¿Borrar todas las notificaciones?',
      'Se quitan de tu bandeja en todos tus teléfonos. Tus puntos, cupones y ofertas no cambian.',
      'Borrar todas',
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        borrar(visibles.map((a) => a.id), true);
      });
  }, [visibles, borrar]);
  const marcarLeidas = () => { Haptics.selectionAsync().catch(() => {}); setTodasVistas(true); };
  const abrir = useCallback((a) => {
    setVistas((v) => (v.has(a.id) ? v : new Set(v).add(a.id)));
    if (a.url) navegar(a.url);
  }, []);

  // «Limpiar» en la barra, como en Mail o en el centro de notificaciones.
  const barra = (
    <Stack.Screen options={{
      headerRight: visibles.length ? () => (
        <Pressable onPress={limpiarTodo} hitSlop={10} accessibilityRole="button" accessibilityLabel="Borrar todas las notificaciones"
          style={({ pressed }) => ({ paddingHorizontal: 6, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 17, color: t.color.magentaTexto }}>Limpiar</Text>
        </Pressable>
      ) : undefined,
    }} />
  );

  if (!d || !ocultas) return <>{barra}<Cargando /></>;
  if (!d.ok) {
    return (
      <>
        {barra}
        <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
          <SinAvisos icono="wifi.exclamationmark" respaldo="!" titulo="No se pudieron cargar">Revisa tu conexión y desliza hacia abajo para reintentar.</SinAvisos>
        </Pantalla>
      </>
    );
  }
  if (!visibles.length) {
    return (
      <>
        {barra}
        <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
          <SinAvisos icono="bell.badge.fill" respaldo="🔔" titulo={d.avisos?.length ? 'Todo limpio' : 'Estás al día'}>
            Aquí verás tus puntos ganados, cupones, ofertas y recordatorios apenas te lleguen.
          </SinAvisos>
        </Pantalla>
      </>
    );
  }

  // Una lista virtual: hasta 50 avisos en vidrio no se pintan todos de una vez.
  // `itemLayoutAnimation`: al borrar uno, los de abajo suben deslizándose.
  return (
    <>
      {barra}
      <Animated.FlatList
        data={filas}
        keyExtractor={(f) => f.clave}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={10}
        itemLayoutAnimation={LinearTransition.springify().damping(22).stiffness(200)}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
        contentContainerStyle={{ padding: 16, paddingBottom: ins.bottom + 24, gap: 10, width: '100%', maxWidth: 560, alignSelf: 'center' }}
        ListHeaderComponent={nuevas ? (
          <Entrada>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.magenta }} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>{nuevas === 1 ? '1 nueva' : `${nuevas} nuevas`}</Text>
              </View>
              <Pressable onPress={marcarLeidas} hitSlop={8} accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>Marcar como leídas</Text>
              </Pressable>
            </View>
          </Entrada>
        ) : null}
        ListFooterComponent={
          <Text style={{ textAlign: 'center', fontSize: 13, color: colorSistema.texto3, marginTop: 10 }}>
            Desliza un aviso hacia la izquierda para borrarlo.
          </Text>
        }
        renderItem={({ item: f, index: i }) => (f.clase === 'dia'
          ? (
            <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: colorSistema.texto, marginTop: i === 0 ? 2 : 14, marginBottom: 2, marginLeft: 4 }}>
              {f.titulo}
            </Text>
          )
          : <FilaAviso a={f.aviso} indice={i} nueva={esNueva(f.aviso)} alAbrir={abrir} alBorrar={borrarUna} />)}
      />
    </>
  );
}

/** El estado vacío: un ícono grande en vidrio, el título y una línea. */
function SinAvisos({ icono, respaldo, titulo, children }) {
  const t = useTema();
  return (
    <Entrada estilo={{ alignItems: 'center', paddingTop: 48 }}>
      <Vidrio radio={44} tinte={suave(t.color.magenta, t.oscuro ? 0.2 : 0.12)}>
        <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf={icono} respaldo={respaldo} tam={38} color={t.color.magentaTexto} />
        </View>
      </Vidrio>
      <Vacio titulo={titulo}>{children}</Vacio>
    </Entrada>
  );
}

/** El fondo rojo que aparece al deslizar: el bote crece con el gesto. */
function AccionBorrar({ progreso }) {
  const animado = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progreso.value, [0, 1], [0.6, 1], 'clamp') }],
  }));
  return (
    <View style={{ width: 96, paddingLeft: 10 }}>
      <View style={{ flex: 1, borderRadius: 26, backgroundColor: colorSistema.rojo, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Animated.View style={[{ alignItems: 'center', gap: 4 }, animado]}>
          <Icono sf="trash.fill" respaldo="✕" tam={20} color="#FFFFFF" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>Borrar</Text>
        </Animated.View>
      </View>
    </View>
  );
}

/** Un aviso. Tocarlo lleva a su pantalla; deslizarlo a la izquierda lo borra. */
function FilaAviso({ a, indice, nueva, alAbrir, alBorrar }) {
  const t = useTema();
  const e = estiloDeAviso(t, a.tipo);
  return (
    <Animated.View exiting={FadeOut.duration(160)}>
      <Entrada indice={Math.min(indice, 6)}>
        <ReanimatedSwipeable
          friction={1.4}
          rightThreshold={72}
          overshootRight={false}
          renderRightActions={(progreso) => <AccionBorrar progreso={progreso} />}
          onSwipeableWillOpen={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); }}
          onSwipeableOpen={() => alBorrar(a)}
        >
          <Pressable onPress={() => alAbrir(a)} accessibilityRole={a.url ? 'button' : undefined}
            accessibilityLabel={`${nueva ? 'Nueva. ' : ''}${a.titulo}. ${a.cuerpo}. ${hora(a.created_at)}`}
            accessibilityActions={[{ name: 'borrar', label: 'Borrar' }]}
            onAccessibilityAction={(ev) => { if (ev.nativeEvent.actionName === 'borrar') alBorrar(a); }}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }] })}>
            <Tarjeta tono={nueva ? e.fuerte : undefined} estilo={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: suave(e.fuerte, t.oscuro ? 0.3 : 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Icono sf={e.sf} respaldo={e.respaldo} tam={20} color={e.texto} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: nueva ? '700' : '600', color: colorSistema.texto }}>{a.titulo}</Text>
                  <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{hora(a.created_at)}</Text>
                  {nueva ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: e.fuerte, alignSelf: 'center' }} /> : null}
                </View>
                <Text style={{ fontSize: 15, lineHeight: 20, color: colorSistema.texto2 }}>{a.cuerpo}</Text>
                {a.url ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: e.texto }}>Ver</Text>
                    <Icono sf="chevron.right" respaldo="›" tam={11} color={e.texto} />
                  </View>
                ) : null}
              </View>
            </Tarjeta>
          </Pressable>
        </ReanimatedSwipeable>
      </Entrada>
    </Animated.View>
  );
}
