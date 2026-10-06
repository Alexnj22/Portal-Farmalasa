// Encuestas a clientes, NATIVO — la lista de `EncuestasClientesView`: en
// diseño, en campo y cerradas, cada una con su estado, cuántas preguntas
// tiene, cómo se aplica y cuándo cierra. Tocar una abre sus resultados
// (`encuesta-cliente/[id]`).
//
// Estados, grupos, canales y el resumen de cierre salen del núcleo
// (`encuestasClientes`), los mismos del portal. Diseñar, aprobar y publicar
// siguen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEncuestas } from '@nucleo/data/encuestasClientes';
import { canalDe, estadoDe, GRUPOS, preguntasEnOrden, resumenDeCierre } from '@nucleo/utils/encuestasClientes';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

export default function EncuestasClientes() {
  const { hasPermission } = useAuth();
  const puedeAprobar = hasPermission('encuestas_clientes', 'can_approve');
  const [encuestas, setEncuestas] = useState(null);
  const [error, setError] = useState(null);
  const [grupo, setGrupo] = useState('campo');
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setEncuestas(await fetchEncuestas()); setError(null); } catch (e) { setError(e?.message || 'No se pudieron cargar las encuestas.'); setEncuestas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const reales = useMemo(() => (encuestas || []).filter((e) => !e.es_plantilla), [encuestas]);
  const cuenta = (g) => reales.filter((e) => GRUPOS[g].includes(e.estado)).length;
  const porAprobar = reales.filter((e) => e.estado === 'en_revision').length;
  const filas = reales.filter((e) => GRUPOS[grupo].includes(e.estado) && (!texto.trim() || tokenMatch(texto.trim(), e.nombre, e.objetivo)));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Encuestas a clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre u objetivo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={grupo} onCambiar={setGrupo} opciones={[
          { id: 'diseno', label: puedeAprobar && porAprobar ? `En diseño · ${porAprobar}` : 'En diseño' },
          { id: 'campo', label: encuestas ? `En campo · ${cuenta('campo')}` : 'En campo' },
          { id: 'cerradas', label: 'Cerradas' },
        ]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {encuestas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : filas.map((e) => {
          const est = estadoDe(e.estado);
          return (
            <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/encuesta-cliente/[id]', params: { id: String(e.id) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo>
                <View style={{ padding: 12, gap: 5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{`${e.nombre}${e.version > 1 ? ` · v${e.version}` : ''}`}</Text>
                    <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                  </View>
                  {e.objetivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{e.objetivo}</Text> : null}
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {[`${preguntasEnOrden(e.cuestionario).length} preguntas`, (e.canales || []).map((c) => canalDe(c).label).join(', '), resumenDeCierre(e, e.sucursales || [], fechaTexto)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {encuestas && !filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{grupo === 'campo' ? 'Ninguna encuesta en campo' : grupo === 'cerradas' ? 'Ninguna cerrada todavía' : 'Ninguna en diseño'}</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Diseñar y publicar (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/encuestas-clientes', nombre: 'Encuestas a clientes' } })} />
        </View>
      </ScrollView>
    </>
  );
}
