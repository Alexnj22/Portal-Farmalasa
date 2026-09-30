// Notificaciones: la CAMPANA del portal, nativa y con tarjetas (pedido del
// usuario del 2026-09-30: «no salen como cards con la info»).
//
// Es la misma bandeja del portal y con las mismas reglas, porque sale del mismo
// store: `fetchNotifications` trae SÓLO lo no leído (lo que falta atender; lo
// leído sigue en el historial) y `useNotificationsChannel`, montado en la raíz,
// la mantiene al día en vivo.
//
// Cada aviso es una tarjeta: quién lo originó (foto), qué pasó, y —si nombra
// una solicitud— su detalle con los mismos renglones que la notificación del
// teléfono (`detalleDeSolicitud`, del núcleo). Tocarla abre la solicitud en la
// app (`app/solicitud/[id].js`), que es donde se decide: la lista informa.
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cuandoLlego, tituloSinEmoji } from '@nucleo/utils/notificacionTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cargarFilaDeAviso, esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { detalleDeMinMax, detalleDeSolicitud, recortar } from '@nucleo/utils/tarjetaDeSolicitud';
import { colorSistema } from '../../../componentes/Formulario';
import { abrirRuta, abrirSolicitud } from '../../../pantallas';

// El detalle se pide para los avisos que nombran una solicitud todavía abierta.
// Tope: con más, la pestaña pagaría decenas de lecturas por abrirse.
const TOPE_DE_DETALLES = 20;

function Avatar({ empleado, titulo }) {
  const foto = empleado?.photo || empleado?.photo_url;
  const letras = (empleado ? shortEmployeeName(empleado) : tituloSinEmoji(titulo))
    .split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  if (foto) return <Image source={{ uri: foto }} style={{ width: 40, height: 40, borderRadius: 20 }} />;
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colorSistema.texto2, fontWeight: '600' }}>{letras || '•'}</Text>
    </View>
  );
}

function Tarjeta({ n, empleado, detalle, onAbrir }) {
  return (
    <Pressable onPress={onAbrir} style={({ pressed }) => ({
      backgroundColor: colorSistema.fila, borderRadius: 16, marginHorizontal: 16, padding: 14, gap: 10,
      opacity: pressed ? 0.85 : 1,
    })}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <Avatar empleado={empleado} titulo={n.title} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>
              {tituloSinEmoji(n.title)}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{cuandoLlego(n.created_at)}</Text>
          </View>
          {empleado ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{shortEmployeeName(empleado)}</Text> : null}
          {!detalle && n.body ? <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={4}>{n.body}</Text> : null}
        </View>
      </View>

      {detalle ? (
        <View style={{ gap: 6 }}>
          {detalle.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{detalle.contexto}</Text> : null}
          {detalle.renglones.length ? (
            <View style={{ backgroundColor: colorSistema.fondo, borderRadius: 10, paddingHorizontal: 10 }}>
              {detalle.renglones.map(([a, b], i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 7, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13 }} numberOfLines={2}>{a}</Text>
                  {b ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{b}</Text> : null}
                </View>
              ))}
              {detalle.resto ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 12, paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                  y {detalle.resto} más
                </Text>
              ) : null}
            </View>
          ) : null}
          {detalle.pie ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{detalle.pie}</Text> : null}
        </View>
      ) : null}

    </Pressable>
  );
}

export default function Notificaciones() {
  const avisos = useStaffStore((s) => s.notifications);
  const empleados = useStaffStore((s) => s.employees);
  const recargar = useStaffStore((s) => s.fetchNotifications);
  const marcarLeido = useStaffStore((s) => s.markNotificationRead);
  const marcarTodos = useStaffStore((s) => s.markAllNotificationsRead);
  const [detalles, setDetalles] = useState({});      // id del aviso → detalle recortado
  const [recargando, setRecargando] = useState(false);

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);

  // El detalle de lo que nombra una solicitud abierta, leído de la base (el
  // aviso es la foto del momento en que salió; la solicitud es la de ahora).
  useEffect(() => {
    let vivo = true;
    const pendientes = avisos
      .filter((n) => n.metadata?.request_id && !n.metadata?.resuelta && !(n.id in detalles))
      .slice(0, TOPE_DE_DETALLES);
    if (!pendientes.length) return undefined;
    Promise.all(pendientes.map(async (n) => {
      try {
        const fila = await cargarFilaDeAviso(n);
        if (!fila) return [n.id, null];
        return [n.id, recortar(esAvisoDeMinMax(n) ? detalleDeMinMax(fila) : detalleDeSolicitud(fila))];
      } catch { return [n.id, null]; }
    })).then((pares) => { if (vivo) setDetalles((d) => ({ ...d, ...Object.fromEntries(pares) })); });
    return () => { vivo = false; };
  }, [avisos, detalles]);

  const abrir = (n) => {
    marcarLeido(n.id);
    const id = n.metadata?.request_id;
    if (id) return abrirSolicitud(esAvisoDeMinMax(n) ? `minmax:${id}` : id);
    if (n.link) abrirRuta(n.link);
  };

  return (
    <>
      <Stack.Screen options={{
        // Texto del color de acento, como «Editar» en Mail: el sistema le pone
        // su propio fondo de vidrio en la barra.
        headerRight: avisos.length ? () => (
          <Pressable onPress={() => marcarTodos()} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: colorSistema.acento, fontSize: 17 }}>Leer todas</Text>
          </Pressable>
        ) : undefined,
      }} />
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 12, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setDetalles({}); await recargar(); setRecargando(false); }} />}>
        {avisos.length ? avisos.map((n) => (
          <Tarjeta key={n.id} n={n} empleado={porId.get(String(n.created_by))} detalle={detalles[n.id]}
            onAbrir={() => abrir(n)} />
        )) : (
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Todo al día</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Lo que llegue aparece acá y en la barra de abajo.</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, paddingTop: 8 }}>
          <Pressable onPress={() => abrirRuta('/notificaciones')}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Historial</Text></Pressable>
          <Pressable onPress={() => abrirRuta('/mis-avisos')}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Comunicados</Text></Pressable>
        </View>
      </ScrollView>
    </>
  );
}
