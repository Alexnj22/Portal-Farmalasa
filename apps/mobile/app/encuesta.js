// Clima organizacional, NATIVO — los resultados de la encuesta (`EncuestaView`):
// el índice global con su nivel, quiénes participaron, el puntaje de cada
// bloque y, al tocar uno, cómo se repartieron las respuestas de cada pregunta;
// y los comentarios. Quien sólo ve su sala, ve su sala.
//
// Puntuar sale del núcleo (`climaLaboral`), lo mismo del portal. Resumen,
// Segmentos e Individuos están en `componentes/encuestas/AnalisisClima`. El
// resumen de comentarios con IA sigue en el portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchSurveyBloques, fetchSurveyPreguntas, fetchSurveyResponsesForView, fetchSurveys } from '@nucleo/data/encuestas';
import {
  bloqueDeLaBase, distribucionDePregunta, indicesInvertidos, nivelDePuntaje, preguntaDeLaBase, puntajeDeBloque, puntajeGlobal, respuestaDeLaBase,
} from '@nucleo/utils/climaLaboral';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Seccion } from '../componentes/formulario/Piezas';
import { Individuos, Resumen, Segmentos as SegmentosDeClima } from '../componentes/encuestas/AnalisisClima';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

const COLOR_OPCION = { A: MARCA.verde, B: MARCA.azulClaro, C: MARCA.ambar, D: MARCA.rojo };

function Barra({ pct, color }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

export default function Encuesta() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('encuesta') === 'ALL';
  const salaPropia = (sucursales || []).find((b) => String(b.id) === String(user?.branchId))?.name ?? '';
  const [encuestas, setEncuestas] = useState(null);
  const [encuestaId, setEncuestaId] = useState(null);
  const [datos, setDatos] = useState(null);
  const [vista, setVista] = useState('resumen');
  const [abierto, setAbierto] = useState(null);

  useEffect(() => { fetchSurveys().then(({ data }) => { setEncuestas(data || []); if (data?.length) setEncuestaId(data[0].id); }); }, []);
  useEffect(() => {
    if (!encuestaId) return;
    setDatos(null);
    Promise.all([fetchSurveyBloques(encuestaId), fetchSurveyPreguntas(encuestaId), fetchSurveyResponsesForView(encuestaId)]).then(([b, p, r]) => {
      setDatos({
        bloques: (b.data || []).map(bloqueDeLaBase),
        preguntas: (p.data || []).map((x) => preguntaDeLaBase(x, b.data || [])),
        respuestas: (r.data || []).map(respuestaDeLaBase),
      });
    });
  }, [encuestaId]);

  const filas = useMemo(() => (datos?.respuestas || []).filter((r) => todas || r.sucursal === salaPropia), [datos, todas, salaPropia]);
  const inv = useMemo(() => indicesInvertidos(datos?.preguntas), [datos]);
  const global = datos ? puntajeGlobal(filas, datos.bloques, inv) : null;
  const nivel = global != null ? nivelDePuntaje(global) : null;
  const comentarios = filas.filter((r) => r.comentario?.trim());
  const encuestaActual = (encuestas || []).find((e) => e.id === encuestaId);
  const grupos = (encuestas || []).length > 1 ? [{ id: 'encuesta', titulo: 'Encuesta', activa: String(encuestaId), porDefecto: String(encuestas[0].id), onCambiar: (v) => setEncuestaId(Number(v) || v),
    opciones: encuestas.map((e) => ({ id: String(e.id), label: e.nombre || e.titulo || `Encuesta ${e.año ?? ''}` })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Clima organizacional', headerLargeTitle: true }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        {encuestas && !encuestas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Todavía no hay encuestas</Text> : null}
        {encuestaId && !datos ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {datos ? (
          <>
            <View style={{ marginHorizontal: 16 }}>
              <Vidrio radio={24} tinte={nivel ? `${colorDeVariante(nivel.severidad)}22` : undefined}>
                <View style={{ padding: 18, alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase' }}>{todas ? 'Índice global' : `Índice de ${salaPropia}`}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 52, fontWeight: '800' }}>{global != null ? Math.round(global) : '—'}</Text>
                  {nivel ? <View style={{ alignSelf: 'center' }}><Pildora texto={nivel.label} color={colorDeVariante(nivel.severidad)} /></View> : null}
                </View>
              </Vidrio>
            </View>
            <FilaDeKpis>
              <Kpi icono="Users" rotulo="Participaron" valor={String(filas.length)} color={MARCA.azul} apoyo={(() => { const j = filas.filter((r) => r.isJefe).length; return `${j} jefe${j === 1 ? '' : 's'}`; })()} />
              <Kpi icono="MessageSquare" rotulo="Comentarios" valor={String(comentarios.length)} color={MARCA.violeta} apoyo="escritos" />
            </FilaDeKpis>
            <Segmentos activa={vista} onCambiar={setVista} opciones={[
              { id: 'resumen', label: 'Resumen' }, { id: 'bloques', label: 'Bloques' }, { id: 'segmentos', label: 'Segmentos' },
              { id: 'personas', label: 'Individuos' }, { id: 'comentarios', label: 'Comentarios' },
            ]} />
            {vista === 'resumen' ? <Resumen filas={filas} bloques={datos.bloques} preguntas={datos.preguntas} inv={inv} /> : null}
            {vista === 'segmentos' ? <SegmentosDeClima filas={filas} bloques={datos.bloques} inv={inv} /> : null}
            {vista === 'personas' ? <Individuos filas={filas} bloques={datos.bloques} preguntas={datos.preguntas} inv={inv} anonima={!!encuestaActual?.anonima} /> : null}
            {vista === 'bloques' ? datos.bloques.map((b) => {
              const s = puntajeDeBloque(filas, b.indices, inv);
              const n = s != null ? nivelDePuntaje(s) : null;
              const abiertoEste = abierto === b.id;
              const preguntas = datos.preguntas.filter((p) => p.bloque === b.id);
              return (
                <Pressable key={b.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : b.id); }} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18} interactivo>
                    <View style={{ padding: 12, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{b.nombre}</Text>
                        <Text style={{ color: n ? colorDeVariante(n.severidad) : colorSistema.texto2, fontSize: 17, fontWeight: '800' }}>{s != null ? Math.round(s) : '—'}</Text>
                      </View>
                      <Barra pct={s} color={n ? colorDeVariante(n.severidad) : colorSistema.texto2} />
                      {b.desc ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={abiertoEste ? undefined : 1}>{b.desc}</Text> : null}
                      {abiertoEste ? preguntas.map((p) => {
                        const d = distribucionDePregunta(filas, p.idx);
                        return (
                          <View key={p.id} style={{ gap: 4, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${p.id}. ${p.texto}${p.invertida ? ' (invertida)' : ''}`}</Text>
                            {d.total ? (
                              <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' }}>
                                {['A', 'B', 'C', 'D'].map((k) => d[k] ? <View key={k} style={{ flex: d[k], backgroundColor: COLOR_OPCION[p.invertida ? { A: 'D', B: 'C', C: 'B', D: 'A' }[k] : k] }} /> : null)}
                              </View>
                            ) : null}
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{['A', 'B', 'C', 'D'].map((k) => `${k} ${d[k]}`).join(' · ')}</Text>
                          </View>
                        );
                      }) : null}
                    </View>
                  </Vidrio>
                </Pressable>
              );
            }) : vista === 'comentarios' ? (
              <View style={{ marginHorizontal: 16, gap: 8 }}>
                {comentarios.length ? comentarios.map((c, i) => (
                  <Vidrio key={i} radio={16}>
                    <View style={{ padding: 12, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.comentario}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[c.isJefe ? 'Jefe' : 'Empleado', c.sucursal].filter(Boolean).join(' · ')}</Text>
                    </View>
                  </Vidrio>
                )) : <Seccion><Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie dejó comentarios.</Text></Seccion>}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
