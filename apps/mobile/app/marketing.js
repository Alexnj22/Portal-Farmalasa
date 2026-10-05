// Marketing, NATIVO — `MarketingView` para seguirlo desde el teléfono: el mes
// de contenido para redes con su estado (planificando, en revisión, con
// cambios, aprobado) y su avance, y cada pieza día por día con su formato,
// estado y diseño; tocar una muestra el texto y los diseños en grande. Y las
// solicitudes que la empresa le hizo al diseñador.
//
// Estados, formatos, el resumen del mes y el orden por día salen del núcleo
// (`marketing`), lo mismo del portal. Los diseños los firma la base y sólo se
// ven cuando el mes ya se envió a revisión. Planificar, aprobar, pautar y
// pedir siguen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchMes, fetchPiezas, fetchSolicitudes, firmarDisenos } from '@nucleo/data/marketing';
import {
  ESTADOS_MES, estadoDe, estadoSolicitudDe, formatoDe, piezasPorDia, prioridadDe, resumenDelMes, ROTULO_CORTO, tipoDeArchivo,
} from '@nucleo/utils/marketing';
import { fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import PasoDeMes from '../componentes/PasoDeMes';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

export default function Marketing() {
  const [mes, setMes] = useState(mesSV);
  const [vista, setVista] = useState('calendario');
  const [datos, setDatos] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
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
  useEffect(() => { setDatos(null); setAbierta(null); cargar(); }, [cargar]);
  useEffect(() => { fetchSolicitudes().then(setSolicitudes).catch(() => setSolicitudes([])); }, []);

  const resumen = useMemo(() => resumenDelMes(datos?.piezas), [datos]);
  const porDia = useMemo(() => piezasPorDia(datos?.piezas), [datos]);
  const dias = Object.keys(porDia).sort();
  const estadoMes = datos?.fila ? ESTADOS_MES[datos.fila.estado] : null;
  const abiertasSol = (solicitudes || []).filter((s) => s.estado === 'nueva' || s.estado === 'aceptada').length;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Marketing', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'calendario', label: 'Calendario' }, { id: 'solicitudes', label: abiertasSol ? `Solicitudes · ${abiertasSol}` : 'Solicitudes' }]} />
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
                  <Kpi icono="Image" rotulo="Piezas" valor={String(resumen.total)} color={MARCA.azul} apoyo={`${resumen.pautadas} con pauta`} />
                  <Kpi icono="CheckCircle2" rotulo="Avance" valor={`${Math.round(resumen.avance * 100)}%`} color={resumen.abiertas ? MARCA.ambar : MARCA.verde} apoyo={`${resumen.abiertas} por hacer`} />
                </FilaDeKpis>
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
                        <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : p.id); }} style={{ marginHorizontal: 16 }}>
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
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                {!dias.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin piezas este mes</Text> : null}
              </>
            )}
          </>
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
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {!solicitudes.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin solicitudes</Text> : null}
          </View>
        )}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Planificar, aprobar y pedir (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/marketing', nombre: 'Marketing' } })} />
        </View>
      </ScrollView>
    </>
  );
}
