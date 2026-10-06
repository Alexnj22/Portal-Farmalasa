// Promociones, NATIVO — `PromocionesView`: las promociones del laboratorio
// (por producto o por laboratorio) con su vigencia y estado («por vencer» se
// lee de la fecha, `estadoVisible`), buscando por nombre o laboratorio. Tocar
// una abre su detalle (`promocion/[id]`) con cada producto y cuánto se ha
// vendido en cada sala.
//
// Crear, editar, los descuentos de la caja, el seguimiento y los pagos siguen
// en el portal. Las reglas salen del núcleo (`promocionesUtils`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPromociones } from '@nucleo/data/promociones';
import { esLaboratorio, estadoVisible, fmtVigencia, mensajeDeCarga, rotuloMes, textoBuscable } from '@nucleo/utils/promocionesUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

export default function Promociones() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState('vigentes');
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try { setFilas(await fetchPromociones()); setError(null); } catch (e) { setError(mensajeDeCarga(e, 'No se pudieron cargar las promociones.')); setFilas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const q = texto.trim();
  const visibles = useMemo(() => (filas || []).filter((p) => {
    const e = estadoVisible(p).clave;
    if (vista === 'vigentes' && !['activa', 'por_vencer'].includes(e)) return false;
    if (vista === 'terminadas' && ['activa', 'por_vencer', 'borrador'].includes(e)) return false;
    return !q || tokenMatch(q, textoBuscable(p));
  }), [filas, vista, q]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Promociones', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre o laboratorio', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'vigentes', label: 'Vigentes' }, { id: 'terminadas', label: 'Terminadas' }, { id: 'todas', label: 'Todas' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((p) => {
          const e = estadoVisible(p);
          const labs = Array.isArray(p.laboratorios) ? p.laboratorios : [];
          return (
            <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/promocion/[id]', params: { id: String(p.id) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo>
                <View style={{ padding: 12, gap: 5 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{p.nombre}</Text>
                    <Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[esLaboratorio(p) ? `Por laboratorio · ${rotuloMes(p.year_month)}` : fmtVigencia(p.inicio, p.fin), esLaboratorio(p) ? null : `${p.renglones} producto${p.renglones === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  </Text>
                  {labs.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{labs.join(', ')}</Text> : null}
                  {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontStyle: 'italic' }} numberOfLines={1}>{p.nota}</Text> : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {filas && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{q ? 'Ninguna promoción con esa búsqueda' : 'Sin promociones en este grupo'}</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Crear, descuentos y pagos (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/promociones', nombre: 'Promociones' } })} />
        </View>
      </ScrollView>
    </>
  );
}
