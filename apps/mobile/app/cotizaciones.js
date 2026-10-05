// Cotizaciones, NATIVO — las de la sala (o todas, con ese alcance), con su
// cliente, tipo de documento, total y estado (`CotizacionesView`). Tocar una
// abre su detalle (`cotizacion/[id]`): los productos y los totales con IVA y
// retención, calculados con la misma cuenta del portal (`cotizacion`).
//
// Crear, editar, anular e imprimir siguen en el portal (dentro de la app).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCotizacionesList } from '@nucleo/data/cotizaciones';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { guardarCotizaciones } from '../componentes/cotizaciones/cache';

export default function Cotizaciones() {
  const { getScope, user } = useAuth();
  const sala = getScope?.('cotizaciones') === 'ALL' ? null : (user?.branchId ?? null);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('vigentes');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchCotizacionesList(sala);
    guardarCotizaciones(data);
    setFilas(data || []); setError(e ? mensajeAmigable(e) : null);
  }, [sala]);
  useEffect(() => { cargar(); }, [cargar]);

  const q = texto.trim();
  const visibles = useMemo(() => (filas || []).filter((c) => (estado === 'todas' || (estado === 'anuladas' ? c.status === 'ANULADA' : c.status !== 'ANULADA'))
    && (!q || tokenMatch(q, c.numero, c.customer_name, c.created_by_name))), [filas, estado, q]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cotizaciones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Número, cliente o quién la hizo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'vigentes', label: 'Vigentes' }, { id: 'anuladas', label: 'Anuladas' }, { id: 'todas', label: 'Todas' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((c) => (
          <Pressable key={c.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/cotizacion/[id]', params: { id: String(c.id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, gap: 5 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.customer_name || 'Sin cliente'}</Text>
                  <Text style={{ color: c.status === 'ANULADA' ? colorSistema.texto2 : colorSistema.texto, fontSize: 16, fontWeight: '800', textDecorationLine: c.status === 'ANULADA' ? 'line-through' : 'none' }}>{formatMoney(c.total)}</Text>
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[c.numero, fechaTexto(c.fecha, { day: 'numeric', month: 'short', year: 'numeric' }), c.payment_type].filter(Boolean).join(' · ')}</Text>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Pildora texto={c.document_type || 'COF'} color={c.document_type === 'CCF' ? MARCA.violeta : colorSistema.texto2} />
                  {c.status === 'ANULADA' ? <Pildora texto="Anulada" color={MARCA.rojo} /> : null}
                  <View style={{ flex: 1 }} />
                  {c.created_by_name ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Avatar empleado={{ id: c.created_by, name: c.created_by_name, photo: c.created_by_photo }} tamano={18} />
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{shortEmployeeName({ name: c.created_by_name })}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {filas && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{q ? 'Ninguna cotización con esa búsqueda' : 'Sin cotizaciones'}</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Nueva cotización (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/cotizaciones', nombre: 'Cotizaciones' } })} />
        </View>
      </ScrollView>
    </>
  );
}
