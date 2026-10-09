// Marketing, NATIVO — `MarketingView` para seguirlo desde el teléfono: el mes
// de contenido para redes con su estado (planificando, en revisión, con
// cambios, aprobado) y su avance, y cada pieza día por día con su formato,
// estado y diseño; tocar una muestra el texto y los diseños en grande. Y las
// solicitudes que la empresa le hizo al diseñador.
//
// Estados, formatos, el resumen del mes y el orden por día salen del núcleo
// (`marketing`), lo mismo del portal. Los diseños los firma la base y sólo se
// ven cuando el mes ya se envió a revisión.
//
// Desde el teléfono además se ENVÍA el mes a revisión (quien edita) y se
// APRUEBA (quien aprueba), con la nota opcional del portal; y tocar una pieza
// abre su detalle (`marketing-pieza/[id]`) para aprobarla o pedir cambios,
// enviarla sola, ver su historial y conversar. Las tarjetas son las del
// portal: piezas, aprobadas, con cambios y las que se pautan, con el
// presupuesto del mes. Crear y editar piezas (`marketing-editar`), su pauta
// (`marketing-pauta`) y pedir un diseño (`marketing-solicitud`) también.
//
// Las demás pestañas del portal: el Feed de cada marca (`componentes/marketing/
// Feed`), el banco de Ideas (`Ideas`), la Biblioteca de marca (`Biblioteca`) y
// las Solicitudes, que se aceptan (y se planifican: la pieza nace con lo de la
// solicitud), se rechazan o se marcan entregadas con su respuesta. Además el
// objetivo y el presupuesto de pauta del mes (el presupuesto, quien aprueba) y
// los Ajustes del calendario (`marketing-ajustes`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  actualizarMes, aprobarMes, crearMes, fetchCatalogos, fetchMes, fetchPiezas, fetchSolicitudes, firmarDisenos, publicarMes, responderSolicitud,
} from '@nucleo/data/marketing';
import { useAuth } from '@nucleo/context/AuthContext';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import {
  ESTADOS_MES, estadoDe, estadoSolicitudDe, formatoDe, piezasPorDia, prellenadoDeSolicitud, prioridadDe, resumenDelMes, ROTULO_CORTO, tipoDeArchivo, totalesDePauta,
} from '@nucleo/utils/marketing';
import { etiquetaMes, fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import PasoDeMes from '../componentes/PasoDeMes';
import Ideas from '../componentes/marketing/Ideas';
import Biblioteca from '../componentes/marketing/Biblioteca';
import Feed from '../componentes/marketing/Feed';
import { guardar as guardarElegido } from '../componentes/comercial/elegido';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { guardarPieza } from '../componentes/marketing/elegida';
import { fallo, listo } from '../componentes/Progreso';
import Tocable from '../componentes/Tocable';

export default function Marketing() {
  const { hasPermission, user } = useAuth();
  const yoId = user?.id;
  const puedeEditar = hasPermission('marketing', 'can_edit');
  const puedeAprobar = hasPermission('marketing', 'can_approve');
  const [ocupado, setOcupado] = useState(false);
  const [mes, setMes] = useState(mesSV);
  const [vista, setVista] = useState('calendario');
  const [datos, setDatos] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [catalogos, setCatalogos] = useState({ marcas: [], redes: [] });
  const [vuelta, setVuelta] = useState(0);
  const [abierta, setAbierta] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const fila = await fetchMes(mes);
      const piezas = fila ? await fetchPiezas(fila.id) : [];
      const firmas = await firmarDisenos(piezas);
      setDatos({ fila, piezas, firmas });
      setError(null);
    } catch (e) { setError(e?.message || 'No se pudo cargar el mes.'); setDatos({ fila: null, piezas: [], firmas: new Map() }); }
  }, [mes]);
  useEffect(() => { setDatos(null); setAbierta(null); }, [mes]);
  // Al volver de una pieza se relee: lo aprobado allá tiene que verse acá.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const cargarSolicitudes = useCallback(() => { fetchSolicitudes().then(setSolicitudes).catch(() => setSolicitudes([])); }, []);
  useEffect(() => { cargarSolicitudes(); fetchCatalogos().then(setCatalogos).catch(() => {}); }, [cargarSolicitudes]);
  useFocusEffect(useCallback(() => { setVuelta((v) => v + 1); }, []));

  const resumen = useMemo(() => resumenDelMes(datos?.piezas), [datos]);
  const porDia = useMemo(() => piezasPorDia(datos?.piezas), [datos]);
  const dias = Object.keys(porDia).sort();
  const estadoMes = datos?.fila ? ESTADOS_MES[datos.fila.estado] : null;
  const abiertasSol = (solicitudes || []).filter((s) => s.estado === 'nueva' || s.estado === 'aceptada').length;
  const fila = datos?.fila;
  const publicado = !!fila?.publicado_at;
  const aprobadas = resumen.por.aprobado + resumen.por.programado + resumen.por.publicado;
  const pauta = useMemo(() => totalesDePauta((datos?.piezas || []).map((p) => p.pauta).filter(Boolean), fila?.presupuesto_pauta), [datos, fila?.presupuesto_pauta]);
  // Las mismas condiciones del portal para enviar y aprobar el mes.
  const puedeEnviarMes = puedeEditar && fila && resumen.total > 0 && fila.estado !== 'en_revision';
  const puedeAprobarMes = puedeAprobar && publicado && fila && fila.estado !== 'aprobado';

  const decidirMes = (modo) => {
    const enviar = modo === 'publicar';
    const reenvio = enviar && fila.version > 0;
    const etiqueta = etiquetaMes(fila.mes);
    const titulo = enviar ? (reenvio ? `Reenviar ${etiqueta}` : `Enviar ${etiqueta} a revisión`) : `Aprobar ${etiqueta}`;
    const cuerpo = enviar
      ? `Quien revisa recibe el aviso y desde ese momento ve los diseños de las ${resumen.total} piezas.${resumen.abiertas ? ` Hay ${resumen.abiertas} sin terminar: se ven con su estado.` : ''} Nota (opcional):`
      : `Se aprueban de una vez las piezas finalizadas y el calendario queda listo para publicar.${resumen.abiertas ? ` Quedan ${resumen.abiertas} sin terminar o con cambios.` : ''} Comentario (opcional):`;
    Alert.prompt(titulo, cuerpo, [
      { text: 'Cancelar', style: 'cancel' },
      { text: enviar ? 'Enviar' : 'Aprobar', onPress: async (nota) => {
        setOcupado(true);
        try {
          if (enviar) { await publicarMes(fila.id, nota); listo(reenvio ? 'Calendario reenviado' : 'Calendario enviado a revisión', etiqueta); }
          else { const r = await aprobarMes(fila.id, nota); listo('Calendario aprobado', `${r?.piezas_aprobadas ?? 0} pieza(s) aprobadas de una vez`); }
          cargar();
        } catch (e) {
          fallo(enviar ? 'No se pudo enviar' : 'No se pudo aprobar', mensajeAmigable(e, 'Intenta de nuevo.'));
        } finally { setOcupado(false); }
      } },
    ], 'plain-text');
  };
  // El objetivo del mes (quien edita) y su presupuesto de pauta (quien aprueba),
  // como `DatosDelMesModal`: si el mes no existe todavía, se crea.
  const datosDelMes = () => Alert.prompt('Objetivo del mes', 'Qué se busca este mes con las redes.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Siguiente', onPress: (objetivo) => {
      const guardarMes = async (cambios) => {
        try {
          const f = fila ?? await crearMes(mes);
          await actualizarMes(f.id, cambios);
          listo('Mes guardado', etiquetaMes(mes)); cargar();
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
      };
      if (!puedeAprobar) { guardarMes({ objetivo }); return; }
      Alert.prompt('Presupuesto de pauta del mes', 'En dólares. Lo manda quien aprueba.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar', onPress: (monto) => guardarMes({ objetivo, presupuesto_pauta: String(monto || '').replace(',', '.') }) },
      ], 'plain-text', fila?.presupuesto_pauta ? String(fila.presupuesto_pauta) : '', 'decimal-pad');
    } },
  ], 'plain-text', fila?.objetivo || '');

  const responder = (s, estado) => {
    const titulos = { aceptada: s.tipo === 'impreso' ? 'Aceptar la solicitud' : 'Aceptar y planificar', rechazada: 'Rechazar la solicitud', entregada: 'Marcar entregada' };
    Alert.prompt(titulos[estado], 'Respuesta para quien la pidió (opcional):', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', style: estado === 'rechazada' ? 'destructive' : 'default', onPress: async (respuesta) => {
        try {
          const f = await responderSolicitud(s.id, estado, respuesta);
          listo(estado === 'aceptada' ? 'Solicitud aceptada' : estado === 'rechazada' ? 'Solicitud rechazada' : 'Solicitud entregada', s.titulo);
          cargarSolicitudes();
          // Lo impreso no va al calendario de redes: se acepta y se entrega.
          if (estado === 'aceptada' && f.tipo !== 'impreso') {
            const { mes: destino, prellenado } = prellenadoDeSolicitud(f, mes);
            guardarElegido('marketing-prellenado', prellenado);
            router.push({ pathname: '/marketing-editar', params: { mes: destino, desde: 'solicitud' } });
          }
        } catch (e) { fallo('No se pudo responder', mensajeAmigable(e)); }
      } },
    ], 'plain-text', s.respuesta || '');
  };

  const abrirPieza = (p) => {
    Haptics.selectionAsync().catch(() => {});
    guardarPieza(p, fila, datos.firmas);
    router.push({ pathname: '/marketing-pieza/[id]', params: { id: String(p.id) } });
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Marketing', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={vista} onCambiar={setVista} opciones={[
          { id: 'calendario', label: 'Calendario' }, { id: 'feed', label: 'Feed' }, { id: 'ideas', label: 'Ideas' },
          { id: 'solicitudes', label: abiertasSol ? `Solicitudes · ${abiertasSol}` : 'Solicitudes' }, { id: 'biblioteca', label: 'Marca' },
        ]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {vista === 'calendario' ? (
          <>
            <PasoDeMes mes={mes} onCambiar={setMes} />
            {datos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : !datos.fila ? (
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Este mes todavía no se planifica</Text>
            ) : (
              <>
                {estadoMes ? (
                  <View style={{ marginHorizontal: 20, gap: 4 }}>
                    <Pildora texto={estadoMes.label} color={colorDeVariante(estadoMes.variant)} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{estadoMes.texto}</Text>
                  </View>
                ) : null}
                <FilaDeKpis>
                  <Kpi icono="Image" rotulo="Piezas" valor={String(resumen.total)} color={MARCA.azul} apoyo={`${Math.round(resumen.avance * 100)}% listas`} />
                  <Kpi icono="CheckCircle2" rotulo="Aprobadas" valor={`${aprobadas}/${resumen.total}`} color={resumen.total && aprobadas === resumen.total ? MARCA.verde : MARCA.azulClaro} apoyo={`${resumen.por.finalizado} por revisar`} />
                </FilaDeKpis>
                <FilaDeKpis>
                  <Kpi icono="AlertTriangle" rotulo="Con cambios" valor={String(resumen.por.cambios)} color={resumen.por.cambios ? MARCA.ambar : MARCA.verde} pide={resumen.por.cambios > 0} apoyo={`${resumen.abiertas} sin terminar`} />
                  <Kpi icono="Megaphone" rotulo="Se pautan" valor={String(resumen.pautadas)} color={MARCA.violeta} apoyo={pauta.presupuestoMes ? `${formatMoney(pauta.presupuesto)} de ${formatMoney(pauta.presupuestoMes)}` : (pauta.presupuesto ? formatMoney(pauta.presupuesto) : 'Sin inversión')} />
                </FilaDeKpis>
                {fila.objetivo ? <View style={{ marginHorizontal: 20 }}><Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Objetivo del mes: ${fila.objetivo}`}</Text></View> : null}
                {puedeEditar || puedeAprobar ? (
                  <Tocable onPress={datosDelMes} hitSlop={8} style={{ marginHorizontal: 20, minHeight: 32, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{puedeAprobar ? 'Objetivo y presupuesto del mes' : 'Objetivo del mes'}</Text>
                  </Tocable>
                ) : null}
                {puedeEnviarMes || puedeAprobarMes ? (
                  <View style={{ marginHorizontal: 16, flexDirection: 'row', gap: 10 }}>
                    {puedeEnviarMes ? <View style={{ flex: 1 }}><BotonGrande texto={fila.version > 0 ? 'Reenviar el mes' : 'Enviar a revisión'} color={MARCA.azul} borde onPress={() => decidirMes('publicar')} deshabilitado={ocupado} /></View> : null}
                    {puedeAprobarMes ? <View style={{ flex: 1 }}><BotonGrande texto="Aprobar el mes" color={MARCA.verde} onPress={() => decidirMes('aprobar')} deshabilitado={ocupado} /></View> : null}
                  </View>
                ) : null}
                {dias.map((d) => (
                  <View key={d} style={{ gap: 8 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>
                      {fechaTexto(d, { weekday: 'long', day: 'numeric', month: 'short' })}
                    </Text>
                    {porDia[d].map((p) => {
                      const est = estadoDe(p.estado);
                      const imagenes = (p.archivos || []).filter((a) => tipoDeArchivo(a) === 'imagen' && datos.firmas.get(a.url));
                      const abiertaEsta = abierta === p.id;
                      return (
                        <Tocable key={p.id} onPress={() => abrirPieza(p)} onLongPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : p.id); }} delayLongPress={300} style={{ marginHorizontal: 16 }}>
                          <Vidrio radio={18} interactivo>
                            <View style={{ padding: 12, gap: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                {imagenes[0] && !abiertaEsta ? <Image source={{ uri: datos.firmas.get(imagenes[0].url) }} style={{ width: 48, height: 48, borderRadius: 10 }} /> : null}
                                <View style={{ flex: 1, gap: 2 }}>
                                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={abiertaEsta ? undefined : 2}>{p.titulo || formatoDe(p.formato).label}</Text>
                                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[formatoDe(p.formato).label, p.hora ? hora12(p.hora) : null, p.pautar ? 'con pauta' : null].filter(Boolean).join(' · ')}</Text>
                                </View>
                                <Pildora texto={ROTULO_CORTO[p.estado] ?? est.label} color={colorDeVariante(est.variant)} />
                              </View>
                              {abiertaEsta ? (
                                <View style={{ gap: 8 }}>
                                  {p.copy ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{p.copy}</Text> : null}
                                  {p.hashtags ? <Text style={{ color: MARCA.azulClaro, fontSize: 13 }}>{p.hashtags}</Text> : null}
                                  {imagenes.map((a) => <Image key={a.id ?? a.url} source={{ uri: datos.firmas.get(a.url) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 14 }} resizeMode="cover" />)}
                                  {!imagenes.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{(p.archivos || []).length ? 'Los diseños se ven cuando el mes se envía a revisión.' : 'Sin diseños todavía.'}</Text> : null}
                                </View>
                              ) : null}
                            </View>
                          </Vidrio>
                        </Tocable>
                      );
                    })}
                  </View>
                ))}
                {!dias.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin piezas este mes</Text> : null}
              </>
            )}
          </>
        ) : vista === 'feed' ? (
          <>
            <PasoDeMes mes={mes} onCambiar={setMes} />
            {datos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : <Feed piezas={datos.piezas} marcas={catalogos.marcas} firmas={datos.firmas} onAbrir={abrirPieza} />}
          </>
        ) : vista === 'ideas' ? (
          <Ideas busqueda="" marcas={catalogos.marcas} piezasDelMes={datos?.piezas || []} mes={mes} yoId={yoId} puedeEditar={puedeEditar} puedeAprobar={puedeAprobar} recarga={vuelta} />
        ) : vista === 'biblioteca' ? (
          <Biblioteca marcas={catalogos.marcas} puedeGestionar={puedeEditar || puedeAprobar} yoId={yoId} recarga={vuelta} />
        ) : solicitudes == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <View style={{ gap: 8 }}>
            {solicitudes.map((s) => {
              const e = estadoSolicitudDe(s.estado);
              const pr = prioridadDe(s.prioridad);
              return (
                <View key={s.id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={16}>
                    <View style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{s.titulo}</Text>
                        <Pildora texto={e.label} color={colorDeVariante(e.variant)} />
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                        {[formatoDe(s.formato).label, s.tamano, s.fecha_deseada ? `para el ${fechaTexto(s.fecha_deseada, { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
                      </Text>
                      {s.prioridad && s.prioridad !== 'normal' ? <Pildora texto={pr.label} color={colorDeVariante(pr.variant)} /> : null}
                      {s.descripcion ? <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{s.descripcion}</Text> : null}
                      {s.respuesta ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{`Respuesta: ${s.respuesta}`}</Text> : null}
                      {puedeEditar && ['nueva', 'aceptada'].includes(s.estado) ? (
                        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                          {s.estado === 'nueva' ? (
                            <>
                              <Tocable onPress={() => responder(s, 'aceptada')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                                <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>{s.tipo === 'impreso' ? 'Aceptar' : 'Aceptar y planificar'}</Text>
                              </Tocable>
                              <Tocable onPress={() => responder(s, 'rechazada')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                                <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Rechazar</Text>
                              </Tocable>
                            </>
                          ) : (
                            <Tocable onPress={() => responder(s, 'entregada')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                              <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>Marcar entregada</Text>
                            </Tocable>
                          )}
                        </View>
                      ) : null}
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {!solicitudes.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin solicitudes</Text> : null}
          </View>
        )}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          {puedeEditar ? (
            <View style={{ marginBottom: 10 }}>
              <BotonGrande texto="Nueva pieza" color={MARCA.azul} onPress={() => router.push({ pathname: '/marketing-editar', params: { mes } })} />
            </View>
          ) : null}
          <BotonGrande texto="Pedir un diseño" borde color={MARCA.azulClaro} onPress={() => router.push('/marketing-solicitud')} />
          {puedeEditar || puedeAprobar ? (
            <View style={{ marginTop: 10 }}>
              <BotonGrande texto="Ajustes del calendario" borde color={colorSistema.texto2} onPress={() => router.push('/marketing-ajustes')} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
