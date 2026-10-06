// Historial de notificaciones, NATIVO — `NotificacionesView`: TODO lo que el
// portal guarda (los últimos 60 días), leído o no, incluidos los avisos que se
// quitaron de la bandeja, que se pueden devolver. La pestaña de Notificaciones
// muestra sólo lo que falta atender; esto es el resto.
//
// Pagina contra el servidor (`fetchNotificationsPage`), no filtra una lista
// recortada: más de la mitad del personal ya pasó los 100 avisos. La búsqueda
// se resuelve en la base (sin tildes, palabras en cualquier orden). Cada aviso
// es la MISMA tarjeta de la bandeja, con su detalle y sus acciones.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { DIAS_VISIBLES, fetchNotificationsPage } from '@nucleo/data/notifications';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import TarjetaDeAviso from '../componentes/avisos/TarjetaDeAviso';
import { abrirAviso } from '../componentes/avisos/abrir';
import { fallo, listo } from '../componentes/Progreso';

const POR_PAGINA = 25;

export default function Notificaciones() {
  const devolver = useStaffStore((s) => s.restoreNotificationsByIds);
  const [estado, setEstado] = useState('todas');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto);
  const [filas, setFilas] = useState(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const peticion = useRef(0);

  // Una página; la respuesta vieja no pisa a la nueva (la búsqueda escribe
  // mientras otra consulta todavía viaja).
  const cargar = useCallback(async (p, sumar) => {
    const mia = ++peticion.current;
    const { data, error: e, count } = await fetchNotificationsPage({ estado, busca: busca.trim() || null, pagina: p, porPagina: POR_PAGINA });
    if (mia !== peticion.current) return;
    if (e) { setError(e.message || 'No se pudo cargar.'); if (!sumar) setFilas([]); return; }
    setError(null);
    setTotal(count ?? 0);
    setPagina(p);
    setFilas((prev) => (sumar ? [...(prev || []), ...(data || [])] : (data || [])));
  }, [estado, busca]);
  useEffect(() => { setFilas(null); cargar(0, false); }, [cargar]);

  const masPaginas = filas && filas.length < total;
  const traerMas = async () => {
    if (!masPaginas || cargandoMas) return;
    setCargandoMas(true);
    await cargar(pagina + 1, true);
    setCargandoMas(false);
  };

  const restaurar = async (n) => {
    try { await devolver([n.id]); listo('Devuelta a la bandeja', ''); cargar(0, false); }
    catch (e) { fallo('No se pudo devolver', e?.message || ''); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Historial', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Buscar en el texto del aviso', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        onScroll={({ nativeEvent: e }) => { if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600) traerMas(); }}
        scrollEventThrottle={250}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(0, false); setRecargando(false); }} />}>
        <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'todas', label: 'Todas' }, { id: 'sin_leer', label: 'Sin leer' }]} />
        {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${total} aviso${total === 1 ? '' : 's'} · últimos ${DIAS_VISIBLES} días`}</Text> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map((n) => (
          <TarjetaDeAviso key={n.id} n={n} onAbrir={() => abrirAviso(n)} sinAcciones={!!n.deleted_at}
            pie={n.deleted_at ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`Fuera de la bandeja desde las ${cuandoLlego(n.deleted_at)}`}</Text>
                <Pressable onPress={(e) => { e.stopPropagation?.(); Haptics.selectionAsync().catch(() => {}); restaurar(n); }} hitSlop={8}
                  style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}2E` }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Devolver</Text>
                </Pressable>
              </View>
            ) : null} />
        ))}
        {cargandoMas ? <ActivityIndicator /> : null}
        {filas && !filas.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{busca.trim() ? 'Ningún aviso con ese texto' : 'Sin avisos'}</Text>
        ) : null}
      </ScrollView>
    </>
  );
}
