// Encuestas a clientes, NATIVO — la lista de `EncuestasClientesView`: en
// diseño, en campo y cerradas, cada una con su estado, cuántas preguntas
// tiene, cómo se aplica y cuándo cierra. Tocar una abre sus resultados
// (`encuesta-cliente/[id]`).
//
// Estados, grupos, canales y el resumen de cierre salen del núcleo
// (`encuestasClientes`), los mismos del portal. Crear una y diseñar sus
// preguntas es nativo (`encuesta-cliente/nueva` y `encuesta-cliente/disenar`).
//
// Como el portal: la pestaña «Plantillas» (abrir una lleva a «Crear encuesta
// con esta plantilla»), las tarjetas Borradores / Por aprobar / Aprobadas /
// En campo y el filtro por estado dentro de cada grupo.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
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
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';

export default function EncuestasClientes() {
  const { hasPermission } = useAuth();
  const puedeAprobar = hasPermission('encuestas_clientes', 'can_approve');
  const puedeEditar = hasPermission('encuestas_clientes', 'can_edit');
  // «Nueva encuesta»: en blanco o desde una plantilla, encuesta o plantilla.
  const nueva = () => router.push('/encuesta-cliente/nueva');
  const [encuestas, setEncuestas] = useState(null);
  const [error, setError] = useState(null);
  const [grupo, setGrupo] = useState('campo');
  const [fEstado, setFEstado] = useState('todos');
  const cambiarGrupo = (g) => { setGrupo(g); setFEstado('todos'); };
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setEncuestas(await fetchEncuestas()); setError(null); } catch (e) { setError(e?.message || 'No se pudieron cargar las encuestas.'); setEncuestas([]); }
  }, []);
  // Al volver de una encuesta se relee: lo aprobado o publicado allá tiene que
  // verse acá.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const reales = useMemo(() => (encuestas || []).filter((e) => !e.es_plantilla), [encuestas]);
  const cuenta = (g) => reales.filter((e) => GRUPOS[g].includes(e.estado)).length;
  const porAprobar = reales.filter((e) => e.estado === 'en_revision').length;
  const plantillas = grupo === 'plantillas';
  const filas = (encuestas || [])
    .filter((e) => (plantillas ? e.es_plantilla : !e.es_plantilla && GRUPOS[grupo].includes(e.estado)))
    .filter((e) => fEstado === 'todos' || e.estado === fEstado)
    .filter((e) => !texto.trim() || tokenMatch(texto.trim(), e.nombre, e.objetivo));
  const estadosDelGrupo = plantillas ? [] : (GRUPOS[grupo] || []);
  const grupos = estadosDelGrupo.length > 1 ? [{ id: 'estado', titulo: 'Estado', activa: fEstado, porDefecto: 'todos', onCambiar: setFEstado,
    opciones: [{ id: 'todos', label: 'Todos' }, ...estadosDelGrupo.map((e) => ({ id: e, label: estadoDe(e).label }))] }] : [];
  const n = (estados) => reales.filter((e) => estados.includes(e.estado)).length;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Encuestas a clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre u objetivo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {encuestas ? (
          <>
            <FilaDeKpis>
              <Kpi icono="FileText" rotulo="Borradores" valor={String(n(['borrador']))} color={colorSistema.texto2} apoyo="En diseño" />
              <Kpi icono="Hourglass" rotulo="Por aprobar" valor={String(porAprobar)} color={MARCA.ambar} pide={porAprobar > 0} apoyo="Esperan a gerencia" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="CheckCircle2" rotulo="Aprobadas" valor={String(n(['aprobada']))} color={MARCA.verde} apoyo="Listas para publicar" />
              <Kpi icono="RadioTower" rotulo="En campo" valor={String(n(['publicada']))} color={MARCA.azulClaro} apoyo="Recibiendo respuestas" />
            </FilaDeKpis>
          </>
        ) : null}
        <Segmentos activa={grupo} onCambiar={cambiarGrupo} opciones={[
          { id: 'diseno', label: puedeAprobar && porAprobar ? `En diseño · ${porAprobar}` : 'En diseño' },
          { id: 'campo', label: encuestas ? `En campo · ${cuenta('campo')}` : 'En campo' },
          { id: 'cerradas', label: 'Cerradas' },
          { id: 'plantillas', label: 'Plantillas' },
        ]} />
        <FiltrosActivos grupos={grupos} />
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
                    {plantillas ? <Pildora texto="Plantilla" color={MARCA.azulClaro} /> : <Pildora texto={est.label} color={colorDeVariante(est.variant)} />}
                  </View>
                  {e.objetivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{e.objetivo}</Text> : null}
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {(plantillas ? [`${preguntasEnOrden(e.cuestionario).length} preguntas`, `cambió ${fechaTexto(e.updated_at, { day: 'numeric', month: 'short' })}`]
                      : [`${preguntasEnOrden(e.cuestionario).length} preguntas`, (e.canales || []).map((c) => canalDe(c).label).join(', '), resumenDeCierre(e, e.sucursales || [], fechaTexto)]).filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {encuestas && !filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{fEstado !== 'todos' || texto.trim() ? 'Sin encuestas con ese filtro' : plantillas ? 'Sin plantillas' : grupo === 'campo' ? 'Ninguna encuesta en campo' : grupo === 'cerradas' ? 'Ninguna cerrada todavía' : 'Ninguna en diseño'}</Text> : null}
        {puedeEditar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Nueva encuesta" onPress={nueva} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
