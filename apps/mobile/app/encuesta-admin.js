// Encuestas (administración), NATIVO — `EncuestaAdminView` para revisarlas:
// todas las encuestas internas con su tipo, estado, fechas y cuántas personas
// respondieron. Tocar una carga sus respuestas: el promedio general, el de
// cada bloque, y cada persona con su puntaje, de menor a mayor —quien está
// peor, arriba—.
//
// Si la encuesta es ANÓNIMA, la app no muestra nombre ni avatar (las iniciales
// delatan a la persona), aunque el portal se los muestre a la administración.
//
// Los puntajes salen del núcleo (`climaLaboral`), los mismos del portal.
//
// Con `encuesta_admin` para editar: crear y editar la encuesta
// (`encuesta-interna/editar`) y capturar o corregir la respuesta de una persona
// (`encuesta-interna/respuesta`), con a quién va (todos, sucursales,
// jefaturas, personas). El detalle dice quiénes faltan por responder.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { guardarEncuestaInterna } from '../componentes/encuestas/interna';
import * as Haptics from 'expo-haptics';
import { fetchEmployeesForSurvey, fetchSurveyBloques, fetchSurveyPreguntas, fetchSurveyResponseCounts, fetchSurveyResponses, fetchSurveys } from '@nucleo/data/encuestas';
import { ESTADO_ENCUESTA, indicesInvertidos, nivelDePuntaje, pendientesDelAlcance, preguntaDeLaBase, promedioPorPersona, puntajeDePersona, TIPO_ENCUESTA } from '@nucleo/utils/climaLaboral';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Dato } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

const COLOR_ESTADO = { activa: MARCA.verde, cerrada: MARCA.azulClaro, borrador: colorSistema.texto2, archivada: colorSistema.texto2 };
const puntos = (s) => (s == null ? '—' : String(s));
const colorDe = (s) => (s == null ? colorSistema.texto2 : colorDeVariante(nivelDePuntaje(s).severidad));

function Detalle({ encuesta, puedeEditar }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    Promise.all([fetchSurveyBloques(encuesta.id), fetchSurveyPreguntas(encuesta.id), fetchSurveyResponses(encuesta.id), fetchEmployeesForSurvey()]).then(([b, p, r, e]) => {
      setD({ bloques: b.data || [], preguntas: (p.data || []).map((x) => preguntaDeLaBase(x, b.data || [])), filas: r.data || [], empleados: e.data || [] });
    });
  }, [encuesta.id]);
  const inv = useMemo(() => indicesInvertidos(d?.preguntas), [d]);
  if (!d) return <ActivityIndicator style={{ marginVertical: 12 }} />;
  const todos = d.bloques.flatMap((b) => b.indices || []);
  const personas = d.filas.map((r) => ({ r, s: puntajeDePersona(r.responses || [], todos, inv) }))
    .sort((a, b) => (a.s ?? 999) - (b.s ?? 999));
  const general = promedioPorPersona(d.filas, todos, inv);
  // Quiénes deberían responder y todavía no (sólo cuando va a sucursales,
  // jefaturas o personas: con «todos» sería el personal entero).
  const pendientes = pendientesDelAlcance(encuesta, d.empleados, new Set(d.filas.map((r) => r.employee_id)));
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <Dato rotulo="Promedio general" valor={puntos(general)} fuerte primero />
      {d.bloques.map((b) => <Dato key={b.id} rotulo={b.nombre} valor={puntos(promedioPorPersona(d.filas, b.indices || [], inv))} />)}
      {personas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 8 }}>Por persona</Text> : null}
      {personas.map(({ r, s }) => {
        const emp = r.employee ? { id: r.employee.id, name: `${r.employee.first_names ?? ''} ${r.employee.last_names ?? ''}`.trim() } : { name: r.display_name || '—' };
        return (
          <Pressable key={r.id} disabled={!puedeEditar}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); guardarEncuestaInterna(encuesta, r); router.push('/encuesta-interna/respuesta'); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.6 : 1 })}>
            {encuesta.anonima ? null : <Avatar empleado={emp} tamano={24} />}
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>
              {`${encuesta.anonima ? 'Anónimo' : shortEmployeeName(emp)}${r.is_jefe ? ' · jefe' : ''}${r.employee?.branch?.name ? ` · ${r.employee.branch.name}` : ''}`}
            </Text>
            <Text style={{ color: colorDe(s), fontSize: 15, fontWeight: '800' }}>{puntos(s)}</Text>
          </Pressable>
        );
      })}
      {!personas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Nadie respondió todavía.</Text> : null}
      {pendientes.length ? (
        <>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginTop: 8 }}>{`Faltan por responder · ${pendientes.length}`}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{pendientes.map((p) => shortEmployeeName(p)).join(', ')}</Text>
        </>
      ) : null}
      {puedeEditar ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <BotonGrande texto="Editar" borde color={MARCA.azulClaro}
              onPress={() => { guardarEncuestaInterna(encuesta); router.push({ pathname: '/encuesta-interna/editar', params: { id: String(encuesta.id) } }); }} />
          </View>
          <View style={{ flex: 1 }}>
            <BotonGrande texto="Agregar respuesta" color={MARCA.azul}
              onPress={() => { guardarEncuestaInterna(encuesta); router.push('/encuesta-interna/respuesta'); }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function EncuestaAdmin() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('encuesta_admin', 'can_edit');
  const [version, setVersion] = useState(0);
  const [encuestas, setEncuestas] = useState(null);
  const [cuentas, setCuentas] = useState({});
  const [estado, setEstado] = useState('todas');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await fetchSurveys();
    const lista = data || [];
    setEncuestas(lista);
    if (lista.length) {
      const { data: c } = await fetchSurveyResponseCounts(lista.map((s) => s.id));
      const m = {};
      for (const x of c || []) m[x.survey_id] = (m[x.survey_id] || 0) + 1;
      setCuentas(m);
    }
    setVersion((v) => v + 1);
  }, []);
  // Al volver de editar o capturar se relee (y el detalle abierto también).
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const visibles = (encuestas || []).filter((e) => estado === 'todas' || e.estado === estado);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Encuestas', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={estado} onCambiar={setEstado} opciones={[{ id: 'todas', label: 'Todas' }, { id: 'activa', label: 'Activas' }, { id: 'cerrada', label: 'Cerradas' }, { id: 'borrador', label: 'Borrador' }]} />
        {encuestas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((e) => {
          const abiertaEsta = abierta === e.id;
          return (
            <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : e.id); }} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} interactivo>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{e.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${cuentas[e.id] || 0} resp.`}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pildora texto={ESTADO_ENCUESTA[e.estado] ?? e.estado ?? 'Sin estado'} color={COLOR_ESTADO[e.estado] ?? colorSistema.texto2} />
                    {e.tipo ? <Pildora texto={TIPO_ENCUESTA[e.tipo] ?? e.tipo} color={MARCA.violeta} /> : null}
                    {e.anonima ? <Pildora texto="Anónima" color={MARCA.ambar} /> : null}
                  </View>
                  {e.fecha_inicio || e.fecha_fin ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {[e.fecha_inicio ? `desde ${fechaTexto(e.fecha_inicio)}` : null, e.fecha_fin ? `hasta ${fechaTexto(e.fecha_fin)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  {abiertaEsta ? <Detalle key={`${e.id}-${version}`} encuesta={e} puedeEditar={puedeEditar} /> : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {encuestas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin encuestas aquí</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          {puedeEditar ? (
            <View style={{ marginBottom: 10 }}>
              <BotonGrande texto="Nueva encuesta" color={MARCA.azul}
                onPress={() => { guardarEncuestaInterna(null); router.push({ pathname: '/encuesta-interna/editar', params: { id: 'nueva' } }); }} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
