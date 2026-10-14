// «Borradas recientemente» (2026-10-14, «la opción de recuperar»): los avisos
// que la persona borró de su bandeja en los últimos 30 días, con «Recuperar»
// en cada uno y «Recuperar todas» arriba — como la carpeta del mismo nombre
// de Fotos y de Notas.
//
// Salen de dos lados, porque borrar tiene dos mitades (lib/bandejaOculta.js):
//   · el SERVIDOR: `bandeja { ocultas: true }` devuelve los que tienen
//     `oculto_at` de los últimos 30 días;
//   · este TELÉFONO: lo que se borró sin conexión y el servidor todavía no
//     confirmó sigue en la lista local y en la copia de la bandeja.
// Recuperar hace las dos cosas: `bandeja_recuperar { ids }` en el servidor y
// `olvidar(ids)` acá, para que la lista local no lo siga tapando.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Presionable from '../componentes/Presionable';
import Icono from '../componentes/Icono';
import { Cargando, ESPACIO_BURBUJA, Pantalla, Vacio } from '../componentes/ui';
import { Entrada } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { EncabezadoSeccion, FilaAviso, estiloSnack, seccionar } from '../componentes/BandejaAvisos';
import { useSesion } from '../lib/sesion';
import { leerOcultas, olvidar } from '../lib/bandejaOculta';
import { copiaParaEmpezar, retocar } from '../lib/sinConexion';
import { useTema } from '../tema/tema';

const ANDROID = Platform.OS === 'android';
const PARAMS = { ocultas: true };

export default function NotificacionesBorradas() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [locales, setLocales] = useState([]); // borradas sólo en este teléfono
  const [quitadas, setQuitadas] = useState(() => new Set()); // recuperadas en esta visita
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const reloj = useRef(null);

  const cargar = useCallback(async () => {
    copiaParaEmpezar('bandeja', PARAMS).then((c) => { if (c) setD((ant) => ant ?? c); });
    // Lo borrado sin conexión: los ids de la lista local que todavía están en
    // la copia de la bandeja (el servidor aún no los tiene por ocultos).
    const [ids, copia] = await Promise.all([leerOcultas(), copiaParaEmpezar('bandeja', {})]);
    setLocales((copia?.avisos ?? []).filter((a) => ids.has(Number(a.id))));
    const r0 = await pedir('bandeja', PARAMS);
    // Un servidor de antes de esta función no conoce `ocultas` y devolvería la
    // bandeja VISIBLE como si fuera la papelera: sin `dias`, no hay borradas.
    const r = r0?.ok && !r0.sinConexion && !('dias' in r0) ? { ok: true, avisos: [] } : r0;
    setD((ant) => (r?.ok || !ant?.ok ? r : ant));
    setQuitadas(new Set());
  }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const lista = useMemo(() => {
    const vistos = new Set();
    const todos = [...locales, ...(d?.ok ? d.avisos ?? [] : [])].filter((a) => {
      const id = Number(a.id);
      if (vistos.has(id) || quitadas.has(id)) return false;
      vistos.add(id);
      return true;
    });
    return todos.sort((x, y) => new Date(y.oculto_at ?? Date.now()) - new Date(x.oculto_at ?? Date.now()));
  }, [d, locales, quitadas]);
  // Se agrupa por CUÁNDO se borró: es lo que esta carpeta ordena.
  const filas = useMemo(() => seccionar(lista, (a) => a.oculto_at ?? new Date().toISOString()), [lista]);

  const avisar = (texto) => {
    clearTimeout(reloj.current);
    setAviso(texto);
    reloj.current = setTimeout(() => setAviso(null), 2600);
  };
  const recuperar = useCallback(async (ids) => {
    const nums = ids.map(Number).filter(Number.isFinite);
    if (!nums.length) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setQuitadas((s) => { const n = new Set(s); nums.forEach((id) => n.add(id)); return n; });
    // Primero el teléfono: aunque el servidor no conteste, lo que estaba
    // oculto SÓLO acá vuelve a la bandeja.
    await olvidar(nums);
    const r = await pedir('bandeja_recuperar', { ids: nums });
    if (r?.ok && !r.sinConexion) {
      const set = new Set(nums);
      retocar('bandeja', PARAMS, (g) => (g?.ok ? { ...g, avisos: (g.avisos ?? []).filter((a) => !set.has(Number(a.id))) } : g));
      avisar(nums.length === 1 ? 'Aviso recuperado' : `${nums.length} avisos recuperados`);
    } else {
      // Los que el servidor tenía por ocultos vuelven a la lista: no se recuperaron.
      const soloLocales = new Set(locales.map((a) => Number(a.id)));
      setQuitadas((s) => { const n = new Set(s); nums.filter((id) => !soloLocales.has(id)).forEach((id) => n.delete(id)); return n; });
      avisar(r?.mensaje ?? 'No se pudo recuperar. Revisa tu conexión.');
    }
  }, [pedir, locales]);
  const recuperarTodas = useCallback(() => recuperar(lista.map((a) => a.id)), [recuperar, lista]);

  const barra = (
    <Stack.Screen options={{
      title: 'Borradas recientemente',
      headerRight: lista.length > 1 ? () => (
        <Presionable onPress={recuperarTodas} hitSlop={10} accessibilityRole="button" accessibilityLabel="Recuperar todas las notificaciones borradas"
          style={({ pressed }) => ({ paddingHorizontal: 6, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: ANDROID ? 14 : 17, fontWeight: ANDROID ? '500' : '400', color: t.color.magentaTexto }}>Recuperar todas</Text>
        </Presionable>
      ) : undefined,
    }} />
  );

  const snack = estiloSnack(t);
  const pie = aviso ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: Platform.OS === 'web' ? 16 : 84, bottom: ins.bottom + 16, alignItems: 'center' }}>
      <View accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, borderRadius: snack.radio, minHeight: 48, maxWidth: 520,
          backgroundColor: snack.fondo, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <Icono sf="arrow.uturn.backward" respaldo="↺" tam={15} color={snack.texto} />
        <Text style={{ fontSize: 15, fontWeight: '600', color: snack.texto }}>{aviso}</Text>
      </View>
    </View>
  ) : null;

  if (!d) return <>{barra}<Cargando /></>;
  if (!lista.length) {
    return (
      <>
        {barra}
        <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
          <Entrada estilo={{ paddingTop: 24 }}>
            {d.ok
              ? <Vacio icono="trash" respaldo="○" tono={colorSistema.texto3} titulo="No hay notificaciones borradas">Lo que borres de tu bandeja se guarda aquí 30 días, por si lo quieres recuperar.</Vacio>
              : <Vacio icono="wifi.exclamationmark" respaldo="!" titulo="No se pudieron cargar">Revisa tu conexión y desliza hacia abajo para reintentar.</Vacio>}
          </Entrada>
        </Pantalla>
        {pie}
      </>
    );
  }

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
        ListHeaderComponent={
          <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto3, marginHorizontal: 6, marginBottom: 6 }}>
            Se guardan 30 días después de borrarlas. Al recuperar una, vuelve a tu bandeja en todos tus teléfonos.
          </Text>
        }
        renderItem={({ item: f }) => (f.clase === 'seccion'
          ? <EncabezadoSeccion titulo={f.titulo} primera={f.primeraSeccion} />
          : (
            <FilaAviso a={f.aviso} primero={f.primero} ultimo={f.ultimo} leido
              accesorio={(
                <Presionable onPress={() => recuperar([f.aviso.id])} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Recuperar ${f.aviso.titulo}`}
                  style={({ pressed }) => ({ alignSelf: 'center', marginLeft: 10, minHeight: 34, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center',
                    backgroundColor: pressed ? colorSistema.superficieAlta : 'transparent', borderWidth: 1, borderColor: t.color.magentaTexto })}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>Recuperar</Text>
                </Presionable>
              )} />
          ))}
      />
      {pie}
    </>
  );
}
