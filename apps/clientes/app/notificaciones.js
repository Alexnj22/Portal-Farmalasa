// La bandeja: los avisos que ya te llegaron al teléfono, para verlos otra vez
// (pedido del usuario, 2026-10-06). Salen de `app_cliente_avisos`, la misma
// bitácora que impide mandar dos veces. Tocar uno lleva a donde llevaba el aviso.
//
// Rediseño (2026-10-09): agrupada por día, ícono y color por clase de aviso,
// deslizar para borrar y «Limpiar». Borrar es OCULTAR, en el servidor
// (`bandeja_ocultar` marca `oculto_at`): se va de todos los teléfonos de la
// persona. La fila no se borra —es la bitácora que evita el aviso repetido—.
// El ocultamiento local (lib/bandejaOculta.js) es el optimista y el respaldo.
//
// Rehecha el 2026-10-14 («mejóralo visualmente. Además al tocar una no se
// borra; que se puedan marcar como leídas también y la opción de recuperar»):
//   · la lista agrupada del sistema (componentes/BandejaAvisos.js), con
//     secciones Hoy · Ayer · Esta semana · Anteriores;
//   · LEÍDA es por aviso y vive en el servidor: tocar uno lo abre y marca ése
//     (`bandeja_leida { ids }`), deslizar a la derecha alterna leída / no
//     leída, y «Marcar todo como leído» marca todos. Abrir la bandeja ya NO
//     marca todo: el punto de «sin leer» quedaba sin sentido a la segunda visita;
//   · tocar un aviso NUNCA lo borra; borrar es deslizar a la izquierda, el
//     menú de mantener presionado o «Limpiar» — y se puede RECUPERAR durante
//     30 días desde «Borradas recientemente» (app/notificaciones-borradas.js).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import Animated, { LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import { Cargando, ESPACIO_BURBUJA, Pantalla, Vacio } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { EncabezadoSeccion, FilaAviso, confirmar, estiloSnack, hojaDeOpciones, seccionar, velo } from '../componentes/BandejaAvisos';
import { useSesion } from '../lib/sesion';
import { alLlegarAviso } from '../lib/avisos';
import { leerOcultas, olvidar, ocultar } from '../lib/bandejaOculta';
import { useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';
import { retocar, copiaParaEmpezar } from '../lib/sinConexion';

const ANDROID = Platform.OS === 'android';
// Deshacer (2026-10-13): el borrado de UN aviso espera esto antes de ir al
// servidor. Deshacer es no haberlo mandado todavía (y después de mandarlo,
// queda «Borradas recientemente»).
const ESPERA_DESHACER = 4000;
const RUTA_BORRADAS = '/notificaciones-borradas';

export default function Notificaciones() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [ocultas, setOcultas] = useState(null);
  // (2026-10-14) Declarado ANTES del useMemo que lo lee: más abajo, el filtro
  // lo leía sin inicializar y la pantalla se caía («Cannot read property 'has'»).
  const [enEspera, setEnEspera] = useState(() => new Set());
  const [refrescando, setRefrescando] = useState(false);

  // Le pide al servidor que oculte; si confirma, la lista local los olvida.
  // Si no (sin conexión), quedan ocultos acá y se reintenta en la próxima
  // carga. Nunca lanza.
  const sincronizar = useCallback(async (datos, ids) => {
    try {
      const r = await pedir('bandeja_ocultar', datos);
      if (r?.ok && ids.length) {
        // Primero se sacan de la lista ya cargada y DESPUÉS se olvidan: al
        // revés, el aviso volvía a aparecer (la lista local era lo único que
        // lo tapaba y la bandeja en memoria todavía lo traía).
        const quitar = new Set(ids.map(Number));
        setD((ant) => (ant?.ok ? { ...ant, avisos: (ant.avisos ?? []).filter((a) => !quitar.has(Number(a.id))) } : ant));
        // Y de la copia sin conexión (2026-10-12): sin señal, la bandeja sale de
        // ahí y, ya olvidados acá, los borrados volvían a aparecer.
        await retocar('bandeja', {}, (g) => (g?.ok ? { ...g, avisos: (g.avisos ?? []).filter((a) => !quitar.has(Number(a.id))) } : g));
        setOcultas(new Set(await olvidar(ids)));
      }
    } catch { /* queda el ocultamiento local */ }
  }, [pedir]);
  const cargar = useCallback(async () => {
    // Lo de la vez anterior se pinta al instante mientras llega lo fresco (2026-10-14).
    copiaParaEmpezar('bandeja', {}).then((c) => { if (c) setD((ant) => ant ?? c); });
    // La lista local se relee en cada visita: «Borradas recientemente» pudo
    // recuperar alguno que estaba oculto sólo en este teléfono.
    leerOcultas().then((s) => setOcultas(new Set(s)));
    const r = await pedir('bandeja');
    setD((ant) => (r?.ok || !ant?.ok ? r : ant));
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
  useEffect(() => alLlegarAviso(() => { setTimeout(() => { cargar(); }, 1500); }), [cargar]);
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const visibles = useMemo(
    () => (d?.ok && ocultas ? (d.avisos ?? []).filter((a) => !ocultas.has(Number(a.id)) && !enEspera.has(a.id)) : []),
    [d, ocultas, enEspera],
  );
  const sinLeer = useMemo(() => visibles.filter((a) => !a.leido_at), [visibles]);
  const filas = useMemo(() => seccionar(visibles), [visibles]);

  // ── Leída / no leída ───────────────────────────────────────────────────
  // Optimista: cambia al instante en la lista y en la copia sin conexión; si
  // el servidor no lo confirma, vuelve a como estaba.
  const ponerLeido = useCallback((ids, leido) => {
    const set = new Set(ids.map(Number));
    const marca = leido ? new Date().toISOString() : null;
    const aplicar = (g, valor) => (g?.ok ? { ...g, avisos: (g.avisos ?? []).map((a) => (set.has(Number(a.id)) ? { ...a, leido_at: valor(a) } : a)) } : g);
    let antes = new Map();
    setD((ant) => {
      antes = new Map((ant?.avisos ?? []).filter((a) => set.has(Number(a.id))).map((a) => [Number(a.id), a.leido_at]));
      return aplicar(ant, () => marca);
    });
    return { aplicar, antes: () => antes };
  }, []);
  const marcar = useCallback(async (ids, leido) => {
    if (!ids.length) return;
    const { aplicar, antes } = ponerLeido(ids, leido);
    const r = await pedir(leido ? 'bandeja_leida' : 'bandeja_no_leida', { ids: ids.map(Number) });
    if (r?.ok && !r.sinConexion) {
      const marca = leido ? new Date().toISOString() : null;
      retocar('bandeja', {}, (g) => aplicar(g, () => marca));
    } else {
      const previo = antes();
      setD((ant) => aplicar(ant, (a) => previo.get(Number(a.id)) ?? a.leido_at));
    }
  }, [pedir, ponerLeido]);
  const alternarLeido = useCallback((a, leido) => {
    Haptics.selectionAsync().catch(() => {});
    marcar([a.id], leido);
  }, [marcar]);
  const marcarTodo = useCallback(async () => {
    const ids = sinLeer.map((a) => a.id);
    if (!ids.length) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const { aplicar, antes } = ponerLeido(ids, true);
    // Sin ids: el servidor marca TODAS (también las que no caben en la lista).
    const r = await pedir('bandeja_leida');
    if (r?.ok && !r.sinConexion) {
      const marca = new Date().toISOString();
      retocar('bandeja', {}, (g) => aplicar(g, () => marca));
    } else {
      const previo = antes();
      setD((ant) => aplicar(ant, (a) => previo.get(Number(a.id)) ?? a.leido_at));
    }
  }, [sinLeer, pedir, ponerLeido]);
  // Tocar un aviso: lo abre y lo marca leído. NUNCA lo borra.
  const abrir = useCallback((a) => {
    if (!a.leido_at) marcar([a.id], true);
    if (a.url) navegar(a.url);
  }, [marcar]);

  // ── Borrar ─────────────────────────────────────────────────────────────
  // Primero acá (al instante), después en el servidor.
  const borrar = useCallback(async (ids, todas = false) => {
    const s = await ocultar(ids);
    setOcultas(new Set(s));
    const nums = ids.map(Number).filter(Number.isFinite);
    sincronizar(todas ? { todas: true, hasta_id: Math.max(...nums) } : { ids: nums }, nums);
  }, [sincronizar]);
  // Uno solo: se esconde al instante, pero el borrado de verdad (el local que
  // persiste y el del servidor) sale a los 4 s, si no se tocó «Deshacer».
  const [deshacer, setDeshacer] = useState(null); // el último borrado: { id, n }
  const esperas = useRef(new Map()); // id → temporizador
  const borrarRef = useRef(borrar);
  borrarRef.current = borrar;
  const soltar = (id) => setEnEspera((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
  const borrarUna = useCallback((a) => {
    const id = a.id;
    if (esperas.current.has(id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setEnEspera((s) => new Set(s).add(id));
    setDeshacer({ id, n: Date.now() });
    esperas.current.set(id, setTimeout(async () => {
      esperas.current.delete(id);
      await borrarRef.current([id]); // primero queda oculto; recién después sale de la espera
      soltar(id);
    }, ESPERA_DESHACER));
  }, []);
  const deshacerUltimo = () => {
    if (!deshacer) return;
    const id = deshacer.id;
    clearTimeout(esperas.current.get(id));
    esperas.current.delete(id);
    soltar(id);
    setDeshacer(null);
    Haptics.selectionAsync().catch(() => {});
  };
  // El aviso de «Deshacer» se va solo a los 4 s.
  useEffect(() => {
    if (!deshacer) return undefined;
    const id = setTimeout(() => setDeshacer((x) => (x?.n === deshacer.n ? null : x)), ESPERA_DESHACER);
    return () => clearTimeout(id);
  }, [deshacer]);
  // Al salir de la pantalla, lo que esperaba se borra ya: salir no es deshacer.
  useEffect(() => () => {
    const ids = [...esperas.current.keys()];
    for (const id of ids) clearTimeout(esperas.current.get(id));
    esperas.current.clear();
    if (ids.length) borrarRef.current(ids);
  }, []);
  const limpiarTodo = useCallback(() => {
    if (!visibles.length) return;
    confirmar('¿Borrar todas las notificaciones?',
      'Se quitan de tu bandeja en todos tus teléfonos. Podrás recuperarlas durante 30 días en «Borradas recientemente».',
      'Borrar todas',
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        borrar(visibles.map((a) => a.id), true);
      });
  }, [visibles, borrar]);
  const verBorradas = useCallback(() => navegar(RUTA_BORRADAS), []);

  // El menú de la barra (como el «…» de Mail): marcar todo, las borradas y limpiar.
  const menu = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    const opciones = [];
    if (sinLeer.length) opciones.push({ texto: 'Marcar todo como leído', alElegir: marcarTodo });
    opciones.push({ texto: 'Borradas recientemente', alElegir: verBorradas });
    if (visibles.length) opciones.push({ texto: 'Limpiar', destructivo: true, alElegir: limpiarTodo });
    if (Platform.OS === 'web') { verBorradas(); return; }
    hojaDeOpciones({ titulo: 'Notificaciones', opciones });
  }, [sinLeer.length, visibles.length, marcarTodo, verBorradas, limpiarTodo]);

  const barra = (
    <Stack.Screen options={{
      headerRight: () => (
        <Presionable onPress={menu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Más opciones de notificaciones"
          style={({ pressed }) => ({ paddingHorizontal: 6, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Icono sf={ANDROID ? 'ellipsis.circle' : 'ellipsis'} respaldo="⋯" tam={ANDROID ? 24 : 20} color={ANDROID ? colorSistema.texto : t.color.magentaTexto} />
        </Presionable>
      ),
    }} />
  );

  const snack = estiloSnack(t);
  const avisoDeshacer = deshacer ? (
    <View pointerEvents="box-none" // A la izquierda de la burbuja del chat (56 + márgenes), que va encima de todo.
      style={{ position: 'absolute', left: 16, right: Platform.OS === 'web' ? 16 : 84, bottom: ins.bottom + 16, alignItems: 'center' }}>
      <View accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 6, borderRadius: snack.radio, minHeight: 52, maxWidth: 520, width: '100%',
          backgroundColor: snack.fondo, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <Icono sf="trash.fill" respaldo="✕" tam={15} color={snack.texto} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: snack.texto }}>Aviso borrado</Text>
        <Presionable onPress={deshacerUltimo} accessibilityRole="button" accessibilityLabel="Deshacer el borrado" hitSlop={6}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: snack.accion }}>Deshacer</Text>
        </Presionable>
      </View>
    </View>
  ) : null;

  if (!d || !ocultas) return <>{barra}<Cargando /></>;
  if (!d.ok) {
    return (
      <>
        {barra}
        <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
          <Entrada estilo={{ paddingTop: 24 }}>
            <Vacio icono="wifi.exclamationmark" respaldo="!" titulo="No se pudieron cargar">Revisa tu conexión y desliza hacia abajo para reintentar.</Vacio>
          </Entrada>
        </Pantalla>
      </>
    );
  }
  if (!visibles.length) {
    return (
      <>
        {barra}
        <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
          <Entrada estilo={{ paddingTop: 24 }}>
            <Vacio icono="bell.badge.fill" respaldo="🔔" titulo={d.avisos?.length ? 'Todo limpio' : 'Estás al día'}
              accion="Borradas recientemente" alAccion={verBorradas}>
              Aquí verás tus puntos acumulados, cupones, ofertas y recordatorios apenas te lleguen.
            </Vacio>
          </Entrada>
        </Pantalla>
        {avisoDeshacer}
      </>
    );
  }

  // Una lista virtual: hasta 50 avisos no se pintan todos de una vez.
  // `itemLayoutAnimation`: al borrar uno, los de abajo suben deslizándose.
  return (
    <>
      {barra}
      <Animated.FlatList
        data={filas}
        keyExtractor={(f) => f.clave}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={12}
        itemLayoutAnimation={LinearTransition.springify().damping(22).stiffness(200)}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar}
          colors={[t.color.magenta]} progressBackgroundColor={ANDROID ? colorSistema.superficieAlta : undefined} />}
        style={ANDROID ? { backgroundColor: colorSistema.fondo } : undefined}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: ins.bottom + 24 + (Platform.OS === 'web' ? 0 : ESPACIO_BURBUJA), width: '100%', maxWidth: 560, alignSelf: 'center' }}
        ListHeaderComponent={sinLeer.length ? (
          <Entrada>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 4, marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: velo(t, t.color.magenta) }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.magenta }} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>{sinLeer.length === 1 ? '1 sin leer' : `${sinLeer.length} sin leer`}</Text>
              </View>
              <Presionable onPress={marcarTodo} hitSlop={8} accessibilityRole="button"
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, opacity: pressed ? 0.5 : 1 })}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>Marcar todo como leído</Text>
              </Presionable>
            </View>
          </Entrada>
        ) : null}
        ListFooterComponent={
          <View style={{ alignItems: 'center', gap: 6, marginTop: 18 }}>
            <Presionable onPress={verBorradas} accessibilityRole="button" hitSlop={6}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, opacity: pressed ? 0.5 : 1 })}>
              <Icono sf="trash" respaldo="↺" tam={15} color={t.color.magentaTexto} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>Borradas recientemente</Text>
            </Presionable>
            <Text style={{ textAlign: 'center', fontSize: 13, lineHeight: 18, color: colorSistema.texto3, marginHorizontal: 12 }}>
              Desliza un aviso a la derecha para marcarlo como leído, o a la izquierda para borrarlo.
            </Text>
          </View>
        }
        renderItem={({ item: f }) => (f.clase === 'seccion'
          ? <EncabezadoSeccion titulo={f.titulo} primera={f.primeraSeccion} />
          : (
            <FilaAviso a={f.aviso} primero={f.primero} ultimo={f.ultimo} leido={!!f.aviso.leido_at}
              alAbrir={abrir} alAlternarLeido={alternarLeido} alBorrar={borrarUna} />
          ))}
      />
      {avisoDeshacer}
    </>
  );
}
