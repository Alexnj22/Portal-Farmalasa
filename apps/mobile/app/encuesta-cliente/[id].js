// Una encuesta a clientes, NATIVO — sus resultados (`ResultadosEncuesta`): el
// NPS con su lectura, cuántos respondieron y por qué canal, promotores contra
// detractores, el puntaje de cada tema y el NPS de cada sucursal; y los
// comentarios abiertos más recientes. Antes de publicarse dice en qué estado
// está y qué sigue.
//
// Todo se cuenta en la base (`encuesta_cliente_resultados`) y la lectura del
// NPS sale del núcleo (`lecturaNps`), lo mismo del portal.
//
// Además, las acciones del ciclo (`CicloDeEncuesta`: enviar a revisión,
// aprobar, devolver, publicar, cerrar, nueva versión, archivar), lo que falta
// para enviarla, el comentario de la última devolución, la pregunta por
// pregunta con barras y el historial con quién hizo cada paso.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { fetchComentarios, fetchEncuesta, fetchEventos, fetchPersonas, fetchProblemas, fetchResultados } from '@nucleo/data/encuestasClientes';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { estadoDe, lecturaNps, resumenDeCierre } from '@nucleo/utils/encuestasClientes';
import { formatPct } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../../componentes/Segmentos';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import CicloDeEncuesta from '../../componentes/encuestas/Ciclo';
import PreguntaPorPregunta from '../../componentes/encuestas/Distribucion';

const EVENTO = {
  creada: 'creó la encuesta', enviada: 'la envió a revisión', aprobada: 'la aprobó', rechazada: 'la devolvió con cambios',
  publicada: 'la publicó', cerrada: 'la cerró', archivada: 'la archivó', duplicada: 'la creó como copia',
};

const CANAL = { qr: 'QR', kiosco: 'tablet', entrevista: 'entrevista' };

export default function EncuestaCliente() {
  const { id } = useLocalSearchParams();
  const [encuesta, setEncuesta] = useState(null);
  const [datos, setDatos] = useState(null);
  const [comentarios, setComentarios] = useState(null);
  const [vista, setVista] = useState('resultados');
  const [error, setError] = useState(null);

  const [problemas, setProblemas] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [personas, setPersonas] = useState({});

  const cargar = useCallback(() => {
    fetchEncuesta(id).then((e) => {
      setEncuesta(e || false);
      if (e && ['publicada', 'cerrada', 'archivada'].includes(e.estado)) {
        fetchResultados(id).then(setDatos).catch((x) => setError(x?.message || 'No se pudieron cargar los resultados.'));
        fetchComentarios(id).then(setComentarios).catch(() => setComentarios([]));
      }
      if (e?.estado === 'borrador') fetchProblemas(id).then(setProblemas).catch(() => setProblemas([]));
      fetchEventos(id).then(async (ev) => {
        setEventos(ev || []);
        try { setPersonas(await fetchPersonas((ev || []).map((x) => x.autor_id))); } catch { /* el historial se pinta sin caras */ }
      }).catch(() => setEventos([]));
    }).catch((x) => { setError(x?.message || 'No se pudo cargar la encuesta.'); setEncuesta(false); });
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  // Al volver de diseñar las preguntas, «Falta para enviarla» se relee.
  const primera = useRef(true);
  useFocusEffect(useCallback(() => {
    if (primera.current) { primera.current = false; return; }
    cargar();
  }, [cargar]));

  // Tras una acción: la copia nueva se abre; si no, se relee ésta.
  const hecho = (r) => {
    if (typeof r === 'string' && r !== String(id)) router.replace({ pathname: '/encuesta-cliente/[id]', params: { id: r } });
    else cargar();
  };
  const devuelta = encuesta?.estado === 'borrador' ? eventos.find((e) => e.tipo === 'rechazada' || e.tipo === 'enviada') : null;

  const est = encuesta ? estadoDe(encuesta.estado) : null;
  const nps = datos?.nps;
  const lectura = nps ? lecturaNps(nps.puntaje) : null;
  const pct = (n) => (nps?.respuestas ? (n / nps.respuestas) * 100 : 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: encuesta?.nombre ?? 'Encuesta', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {encuesta == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : !encuesta ? (
          <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error || 'Esa encuesta no existe o no tienes acceso.'} /></View>
        ) : (
          <>
            <View style={{ marginHorizontal: 20, gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                {encuesta.version > 1 ? <Pildora texto={`v${encuesta.version}`} color={MARCA.violeta} /> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${resumenDeCierre(encuesta, encuesta.sucursales || [], fechaTexto)}. ${est.texto}`}</Text>
            </View>
            {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
            {devuelta?.tipo === 'rechazada' && devuelta.comentario ? (
              <View style={{ marginHorizontal: 16 }}>
                <Aviso tono="cuidado" texto={`Devuelta por ${personas[devuelta.autor_id]?.name ? shortEmployeeName(personas[devuelta.autor_id].name) : 'gerencia'}: ${devuelta.comentario}`} />
              </View>
            ) : null}
            {encuesta.estado === 'borrador' && problemas.length ? (
              <View style={{ marginHorizontal: 16 }}>
                <Seccion titulo="Falta para enviarla">
                  {problemas.map((p) => <Text key={p} style={{ color: colorSistema.texto, fontSize: 14 }}>{`• ${p}`}</Text>)}
                </Seccion>
              </View>
            ) : null}
            <View style={{ marginHorizontal: 16 }}>
              <BotonGrande texto={encuesta.estado === 'borrador' ? 'Diseñar las preguntas' : 'Ver las preguntas'} borde color={MARCA.azulClaro}
                onPress={() => router.push({ pathname: '/encuesta-cliente/disenar', params: { id: String(encuesta.id) } })} />
            </View>
            <CicloDeEncuesta encuesta={encuesta} sinProblemas={!problemas.length} onHecho={hecho} />
            {!['publicada', 'cerrada', 'archivada'].includes(encuesta.estado) ? (
              <View style={{ marginHorizontal: 16 }}><Aviso texto="Los resultados aparecen cuando la encuesta se publica y empieza a recibir respuestas." /></View>
            ) : !datos && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : datos && !datos.total ? (
              <View style={{ marginHorizontal: 16 }}><Aviso texto="Todavía no hay respuestas." /></View>
            ) : datos ? (
              <>
                <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'resultados', label: 'Resultados' }, { id: 'comentarios', label: comentarios?.length ? `Comentarios · ${comentarios.length}` : 'Comentarios' }]} />
                {vista === 'resultados' ? (
                  <>
                    <FilaDeKpis>
                      <Kpi icono="Gauge" rotulo="NPS" valor={String(nps.puntaje ?? '—')} color={colorDeVariante(lectura.variant)} apoyo={lectura.label} />
                      <Kpi icono="Users" rotulo="Respuestas" valor={String(datos.total)} color={MARCA.azul}
                        apoyo={Object.entries(datos.por_canal || {}).map(([c, n]) => `${n} ${CANAL[c] ?? c}`).join(' · ')} />
                    </FilaDeKpis>
                    {nps.respuestas > 0 ? (
                      <Seccion titulo="Recomendación">
                        <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colorSistema.separador }}>
                          <View style={{ width: `${pct(nps.promotores)}%`, backgroundColor: MARCA.verde }} />
                          <View style={{ width: `${pct(nps.pasivos)}%`, backgroundColor: MARCA.ambar }} />
                          <View style={{ width: `${pct(nps.detractores)}%`, backgroundColor: MARCA.rojo }} />
                        </View>
                        <Dato rotulo="Promotores (9-10)" valor={`${nps.promotores} · ${formatPct(pct(nps.promotores), { decimales: 0 })}`} />
                        <Dato rotulo="Pasivos (7-8)" valor={`${nps.pasivos} · ${formatPct(pct(nps.pasivos), { decimales: 0 })}`} />
                        <Dato rotulo="Detractores (0-6)" valor={`${nps.detractores} · ${formatPct(pct(nps.detractores), { decimales: 0 })}`} />
                      </Seccion>
                    ) : null}
                    {datos.por_dimension?.length ? (
                      <Seccion titulo="Por tema (0 a 100)">
                        {datos.por_dimension.map((d, i) => (
                          <View key={d.clave} style={{ gap: 4, paddingTop: i ? 8 : 0 }}>
                            <View style={{ flexDirection: 'row' }}>
                              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{d.nombre}</Text>
                              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{d.puntaje ?? '—'}</Text>
                            </View>
                            <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                              <View style={{ width: `${Math.max(0, Math.min(100, d.puntaje || 0))}%`, height: 6, backgroundColor: MARCA.azulClaro }} />
                            </View>
                            <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${d.respuestas} respuesta(s)`}</Text>
                          </View>
                        ))}
                      </Seccion>
                    ) : null}
                    {datos.por_sucursal?.length > 1 ? (
                      <Seccion titulo="NPS por sucursal">
                        {datos.por_sucursal.map((s, i) => (
                          <View key={s.branch_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: i ? 8 : 0 }}>
                            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{s.nombre}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${s.respuestas} resp.`}</Text>
                            <Pildora texto={String(s.nps ?? '—')} color={colorDeVariante(lecturaNps(s.nps).variant)} />
                          </View>
                        ))}
                      </Seccion>
                    ) : null}
                    {datos.por_pregunta?.some((p) => p.tipo !== 'texto') ? (
                      <Seccion titulo="Pregunta por pregunta">
                        <PreguntaPorPregunta preguntas={datos.por_pregunta} />
                      </Seccion>
                    ) : null}
                  </>
                ) : (
                  <View style={{ marginHorizontal: 16, gap: 8 }}>
                    {comentarios == null ? <ActivityIndicator /> : comentarios.length ? comentarios.slice(0, 100).map((c, i) => (
                      <Vidrio key={c.id ?? i} radio={16}>
                        <View style={{ padding: 12, gap: 4 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{c.texto ?? ''}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[c.pregunta, c.sucursal, c.nps != null ? `NPS ${c.nps}` : null, c.created_at ? fechaTexto(String(c.created_at).slice(0, 10), { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}</Text>
                        </View>
                      </Vidrio>
                    )) : <Aviso texto="Nadie dejó comentarios." />}
                  </View>
                )}
              </>
            ) : null}
            {eventos.length ? (
              <View style={{ marginHorizontal: 16 }}>
                <Seccion titulo="Historial">
                  {eventos.map((e, i) => {
                    const quien = personas[e.autor_id];
                    return (
                      <View key={e.id ?? i} style={{ gap: 2, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                          <Text style={{ fontWeight: '700' }}>{quien?.name ? shortEmployeeName(quien.name) : 'Sistema'}</Text>{` ${EVENTO[e.tipo] || e.tipo}`}
                        </Text>
                        {e.comentario ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${e.comentario}»`}</Text> : null}
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaTexto(e.created_at, { day: 'numeric', month: 'short', year: 'numeric' })} · ${hora12(e.created_at)}`}</Text>
                      </View>
                    );
                  })}
                </Seccion>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
