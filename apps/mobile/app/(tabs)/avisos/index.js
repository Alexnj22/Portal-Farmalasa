// Notificaciones: la CAMPANA del portal, nativa y con tarjetas (pedido del
// usuario del 2026-09-30: «no salen como cards con la info»).
//
// Es la misma bandeja del portal y con las mismas reglas, porque sale del mismo
// store: `fetchNotifications` trae SÓLO lo no leído (lo que falta atender; lo
// leído sigue en el historial) y `useNotificationsChannel`, montado en la raíz,
// la mantiene al día en vivo.
//
// Cada aviso es una tarjeta (`componentes/avisos/TarjetaDeAviso`), la misma de
// la campana del portal: anillo, barras por sala, quién lo pide y sus datos.
// Si no tiene tarjeta propia y nombra una solicitud, va su detalle con los
// renglones de la notificación del teléfono (`detalleDeSolicitud`). Tocarla abre la solicitud en la
// app (`app/solicitud/[id].js`), que es donde se decide: la lista informa.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso, esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { detalleDeMinMax, detalleDeSolicitud, recortar } from '@nucleo/utils/tarjetaDeSolicitud';
import { colorSistema } from '../../../componentes/Formulario';
import { abrirRuta } from '../../../pantallas';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscadorDePersonas } from '@nucleo/utils/movimientoTexto';
import { usePorDecidir } from '../../../componentes/porDecidir';
import TarjetaPorDecidir from '../../../componentes/TarjetaPorDecidir';
import TarjetaDeAviso from '../../../componentes/avisos/TarjetaDeAviso';
import { abrirAviso } from '../../../componentes/avisos/abrir';


// El detalle se pide para los avisos que nombran una solicitud todavía abierta.
// Tope: con más, la pestaña pagaría decenas de lecturas por abrirse.
const TOPE_DE_DETALLES = 20;

function Seccion({ texto }) {
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 32, marginTop: 4 }}>{texto}</Text>
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

  // «Por decidir» va ARRIBA y no depende de que el aviso esté sin leer: leer
  // un aviso no contesta la solicitud (reporte del usuario, 2026-09-30).
  const auth = useAuth();
  const porDecidir = usePorDecidir((s) => s.items);
  const cargarPorDecidir = usePorDecidir((s) => s.cargar);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);
  // Con la persona como dependencia, no con `auth` entero: `useAuth` devuelve
  // un objeto nuevo en cada dibujo y la lista se releería sin parar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { cargarPorDecidir(auth); }, [auth.user?.id, cargarPorDecidir]));

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

  const abrir = abrirAviso;

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
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setDetalles({}); await Promise.all([recargar(), cargarPorDecidir(auth)]); setRecargando(false); }} />}>
        {porDecidir.length ? (
          <>
            <Seccion texto={`Por decidir · ${porDecidir.length}`} />
            {porDecidir.map((i) => <TarjetaPorDecidir key={i.clave} item={i} persona={persona} />)}
            {avisos.length ? <Seccion texto="Avisos sin leer" /> : null}
          </>
        ) : null}
        {avisos.length ? avisos.map((n) => (
          <TarjetaDeAviso key={n.id} n={n} persona={persona} detalle={detalles[n.id]} onAbrir={() => abrir(n)} />
        )) : porDecidir.length ? null : (
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Todo al día</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Lo que llegue aparece acá y en la barra de abajo.</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, paddingTop: 8 }}>
          <Pressable onPress={() => router.push('/notificaciones')}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Historial</Text></Pressable>
          <Pressable onPress={() => abrirRuta('/mis-avisos')}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Comunicados</Text></Pressable>
        </View>
      </ScrollView>
    </>
  );
}
