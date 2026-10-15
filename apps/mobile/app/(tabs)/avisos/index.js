// Notificaciones: la CAMPANA del portal, nativa y con tarjetas (pedido del
// usuario del 2026-09-30: «no salen como cards con la info»).
//
// Es la misma bandeja del portal y con las mismas reglas, porque sale del mismo
// store: `fetchNotifications` trae lo no leído (lo leído sigue en el historial)
// y `useNotificationsChannel`, montado en la raíz, la mantiene al día en vivo.
//
// Rediseño del 2026-10-12. Reporte del usuario: «al deslizar no se eliminan,
// si toco una y era solicitud se desaparece aun sin confirmar ni descartar, me
// aparecen como 2 secciones por decidir y abajo avisos sin leer». Tres reglas:
//
//   1. UNA sola sección «Por decidir», arriba (`ordenarBandeja` del núcleo): lo
//      que la persona tiene que contestar va una vez. Antes el aviso de cada
//      solicitud se repetía debajo con su propio Aprobar / Rechazar — en
//      producción, seis ajustes de Mín·Máx salían dos veces cada uno.
//   2. Lo que espera una decisión NO se va al tocarlo ni al «Leer todas»
//      (`avisoEsperaDecision`): se queda hasta que se aprueba o se rechaza, y
//      entonces la base lo da por leído. No se desliza: no hay nada que borrar
//      de algo que todavía espera.
//   3. Los avisos se deslizan: a la izquierda se ELIMINAN (con «Deshacer»), a
//      la derecha se marcan leídos. Eliminar es ocultar (`deleted_at`): sigue en
//      el historial, de donde se puede devolver.
//
// «Borrar todas» es el de la campana del portal (`deleteAllNotifications`):
// oculta en la base TODO lo de la persona hasta el corte capturado al tocar
// —no sólo lo cargado—, con la misma ventana de «Deshacer» que uno suelto.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, LayoutAnimation, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso, esAvisoDeMinMax } from '@nucleo/data/solicitudDeAviso';
import { detalleDeMinMax, detalleDeSolicitud, recortar } from '@nucleo/utils/tarjetaDeSolicitud';
import { avisoEsperaDecisionConMayoristas } from '@nucleo/utils/accionesDeAviso';
import { ordenarBandeja } from '@nucleo/utils/bandejaDeAvisos';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscadorDePersonas } from '@nucleo/utils/movimientoTexto';
import useCortesDeAvisos, { corteResolubleDelAviso } from '@nucleo/hooks/useCortesDeAvisos';
import { colorSistema } from '../../../componentes/Formulario';
import { abrirRuta } from '../../../pantallas';
import { usePorDecidir } from '../../../componentes/porDecidir';
import TarjetaPorDecidir from '../../../componentes/TarjetaPorDecidir';
import TarjetaDeAviso from '../../../componentes/avisos/TarjetaDeAviso';
import { abrirAviso } from '../../../componentes/avisos/abrir';
import Deslizable from '../../../componentes/Deslizable';
import Tocable from '../../../componentes/Tocable';
import { MARCA } from '../../../componentes/inicio/marca';

// El detalle se pide para los avisos que nombran una solicitud todavía abierta.
// Tope: con más, la pestaña pagaría decenas de lecturas por abrirse.
const TOPE_DE_DETALLES = 20;
// Cuánto vive el «Deshacer» antes de escribir en la base (la campana del
// portal usa 3 s; acá un poco más, porque el pulgar tarda más que el mouse).
const DESHACER_MS = 4000;
const ANDROID = Platform.OS === 'android';

const animar = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

function Seccion({ texto, nota, derecha }) {
  return (
    <View style={{ marginHorizontal: 32, marginTop: 6, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{texto}</Text>
        {derecha}
      </View>
      {nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{nota}</Text> : null}
    </View>
  );
}

function Enlace({ texto, onPress }) {
  return (
    <Tocable onPress={onPress} hitSlop={8} accessibilityRole="button" style={{ paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 }}>
      <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: ANDROID ? '600' : '400' }}>{texto}</Text>
    </Tocable>
  );
}

export default function Notificaciones() {
  const avisos = useStaffStore((s) => s.notifications);
  const empleados = useStaffStore((s) => s.employees);
  const recargar = useStaffStore((s) => s.fetchNotifications);
  const marcarLeido = useStaffStore((s) => s.markNotificationRead);
  const marcarTodos = useStaffStore((s) => s.markAllNotificationsRead);
  const eliminar = useStaffStore((s) => s.deleteNotificationsByIds);
  const eliminarTodas = useStaffStore((s) => s.deleteAllNotifications);
  const [detalles, setDetalles] = useState({});      // id del aviso → detalle recortado
  const [recargando, setRecargando] = useState(false);
  const [ocultos, setOcultos] = useState(() => new Set());   // borrados que esperan el «Deshacer»
  const deshacer = useRef(null);                              // { ids, reloj }
  const [aviso, setAviso] = useState(null);                   // el texto del «Deshacer» a la vista

  const auth = useAuth();
  const { hasPermission } = auth;
  const porDecidir = usePorDecidir((s) => s.items);
  const cargarPorDecidir = usePorDecidir((s) => s.cargar);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);
  // Con la persona como dependencia, no con `auth` entero: `useAuth` devuelve
  // un objeto nuevo en cada dibujo y la lista se releería sin parar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { cargarPorDecidir(auth); }, [auth.user?.id, cargarPorDecidir]));

  // Un aviso de mayorista espera mientras su cliente siga 'solicitado' (el
  // conjunto lo lee «Por decidir» junto con sus tarjetas).
  const mayoristasSolicitados = usePorDecidir((s) => s.mayoristasSolicitados);
  const esperaDecision = useCallback((n) => avisoEsperaDecisionConMayoristas(n, hasPermission, mayoristasSolicitados),
    [hasPermission, mayoristasSolicitados]);
  const visibles = useMemo(() => avisos.filter((n) => !ocultos.has(n.id)), [avisos, ocultos]);
  // Los cortes que nombran los avisos, releídos (la campana hace lo mismo).
  const { porId: cortesPorId } = useCortesDeAvisos(visibles, true);
  const puedeResolverCortes = hasPermission('cortes_caja', 'can_edit');
  const { pendientes, sinLeer, decididos, totalPorDecidir } = useMemo(
    () => ordenarBandeja(visibles, porDecidir, esperaDecision), [visibles, porDecidir, esperaDecision]);

  // El detalle de lo que nombra una solicitud abierta, leído de la base (el
  // aviso es la foto del momento en que salió; la solicitud es la de ahora).
  useEffect(() => {
    let vivo = true;
    const faltan = [...pendientes, ...sinLeer]
      .filter((n) => n.metadata?.request_id && !n.metadata?.resuelta && !(n.id in detalles))
      .slice(0, TOPE_DE_DETALLES);
    if (!faltan.length) return undefined;
    Promise.all(faltan.map(async (n) => {
      try {
        const fila = await cargarFilaDeAviso(n);
        if (!fila) return [n.id, null];
        return [n.id, recortar(esAvisoDeMinMax(n) ? detalleDeMinMax(fila) : detalleDeSolicitud(fila))];
      } catch { return [n.id, null]; }
    })).then((pares) => { if (vivo) setDetalles((d) => ({ ...d, ...Object.fromEntries(pares) })); });
    return () => { vivo = false; };
  }, [pendientes, sinLeer, detalles]);

  // Eliminar con «Deshacer». El orden importa (es el defecto que hacía
  // reaparecer los avisos en la app de clientes): primero se quita de la
  // lista del store —`deleteNotificationsByIds` lo hace en el acto—, y RECIÉN
  // después se olvida de los ocultos. Al revés, entre una cosa y otra el aviso
  // volvía a pintarse.
  const confirmarBorrado = useCallback(() => {
    const p = deshacer.current;
    if (!p) return;
    clearTimeout(p.reloj);
    deshacer.current = null;
    Promise.resolve(p.corte ? eliminarTodas(p.corte) : eliminar(p.ids)).catch(() => {}).finally(() => {
      setOcultos((s) => { const c = new Set(s); p.ids.forEach((id) => c.delete(id)); return c; });
    });
    setAviso(null);
  }, [eliminar, eliminarTodas]);

  const borrar = useCallback((n) => {
    if (deshacer.current) confirmarBorrado();   // uno a la vez: el anterior ya no se deshace
    animar();
    setOcultos((s) => new Set(s).add(n.id));
    deshacer.current = { ids: [n.id], reloj: setTimeout(confirmarBorrado, DESHACER_MS) };
    setAviso('Aviso eliminado');
  }, [confirmarBorrado]);

  // El corte se toma AHORA, antes de la ventana: lo que llegue en vivo durante
  // el «Deshacer» no se lo lleva (mismo contrato que la campana del portal).
  const borrarTodas = () => {
    Alert.alert('¿Borrar todos los avisos?', 'Salen de la bandeja. Siguen en el historial, de donde se pueden devolver.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar todos', style: 'destructive', onPress: () => {
        if (deshacer.current) confirmarBorrado();
        const ids = visibles.map((n) => n.id);
        if (!ids.length) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        animar();
        setOcultos((s) => { const c = new Set(s); ids.forEach((id) => c.add(id)); return c; });
        deshacer.current = { ids, corte: new Date().toISOString(), reloj: setTimeout(confirmarBorrado, DESHACER_MS) };
        setAviso(`${ids.length} aviso${ids.length === 1 ? '' : 's'} eliminado${ids.length === 1 ? '' : 's'}`);
      } },
    ]);
  };

  const deshacerBorrado = () => {
    const p = deshacer.current;
    if (!p) return;
    clearTimeout(p.reloj);
    deshacer.current = null;
    Haptics.selectionAsync().catch(() => {});
    animar();
    setOcultos((s) => { const c = new Set(s); p.ids.forEach((id) => c.delete(id)); return c; });
    setAviso(null);
  };
  // Al salir de la pestaña, lo pendiente de borrar se escribe.
  useEffect(() => () => { if (deshacer.current) confirmarBorrado(); }, [confirmarBorrado]);

  const leer = (n) => { animar(); marcarLeido(n.id); };
  const leerTodas = () => {
    Haptics.selectionAsync().catch(() => {});
    animar();
    marcarTodos({ conservar: esperaDecision });
  };

  const tarjeta = (n, { deslizar }) => {
    const t = (
      <TarjetaDeAviso n={n} persona={persona} detalle={detalles[n.id]} margen={deslizar ? 0 : 16}
        corte={corteResolubleDelAviso(n, cortesPorId, puedeResolverCortes)}
        onAbrir={() => abrirAviso(n, { conservar: esperaDecision(n) })} />
    );
    if (!deslizar) return <View key={n.id}>{t}</View>;
    return (
      <Deslizable key={n.id} onIzquierda={() => borrar(n)} onDerecha={!n.read_at ? () => leer(n) : undefined}>
        {t}
      </Deslizable>
    );
  };

  const vacio = !totalPorDecidir && !sinLeer.length && !decididos.length;

  return (
    <>
      <Stack.Screen options={{
        headerRight: sinLeer.length ? () => (
          <Tocable onPress={leerTodas} hitSlop={8} accessibilityRole="button" style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
            <Text style={{ color: colorSistema.acento, fontSize: 17, fontWeight: ANDROID ? '600' : '400' }}>Leer todas</Text>
          </Tocable>
        ) : undefined,
      }} />
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: aviso ? 96 : 24, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setDetalles({}); await Promise.all([recargar(), cargarPorDecidir(auth)]); setRecargando(false); }} />}>

        {totalPorDecidir ? (
          <>
            <Seccion texto={`Por decidir · ${totalPorDecidir}`} nota="Siguen aquí hasta que las apruebes o las rechaces." />
            {porDecidir.map((i) => <TarjetaPorDecidir key={i.clave} item={i} persona={persona} />)}
            {pendientes.map((n) => tarjeta(n, { deslizar: false }))}
          </>
        ) : null}

        {sinLeer.length ? (
          <>
            <Seccion texto={`Sin leer · ${sinLeer.length}`} nota={totalPorDecidir ? null : 'Desliza a la izquierda para eliminar y a la derecha para marcar leído.'} />
            {sinLeer.map((n) => tarjeta(n, { deslizar: true }))}
          </>
        ) : null}

        {decididos.length ? (
          <>
            <Seccion texto="Ya decididas" />
            {decididos.map((n) => tarjeta(n, { deslizar: true }))}
          </>
        ) : null}

        {vacio ? (
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 6, paddingHorizontal: 32 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Todo al día</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>No tienes nada por decidir ni avisos sin leer.</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 8 }}>
          <Enlace texto="Historial" onPress={() => router.push('/notificaciones')} />
          <Enlace texto="Comunicados" onPress={() => abrirRuta('/mis-avisos')} />
          {visibles.length ? <Enlace texto="Borrar todas" onPress={borrarTodas} /> : null}
        </View>
      </ScrollView>

      {aviso ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 104 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 6, minHeight: 48,
            borderRadius: ANDROID ? 6 : 14, backgroundColor: ANDROID ? '#313033' : 'rgba(30,30,32,0.94)' }}>
            <Text style={{ flex: 1, color: '#fff', fontSize: 15 }}>{aviso}</Text>
            <Tocable onPress={deshacerBorrado} accessibilityRole="button" style={{ paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: 8 }}>
              <Text style={{ color: ANDROID ? '#D0BCFF' : MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Deshacer</Text>
            </Tocable>
          </View>
        </View>
      ) : null}
    </>
  );
}
