// Cómo va una encuesta en campo, NATIVO — `AvanceEncuesta` + `IncentivosEncuesta`
// del portal: respuestas contra la meta, hoy, con datos de contacto y la
// última; por sucursal (con su cuota y su barra) y por canal; el enlace del QR
// y el de la tablet de cada sucursal, para compartir; y los incentivos —puntos
// acreditados o pendientes, muestras entregadas o por entregar—. Unos puntos
// quedan pendientes cuando el teléfono no apunta a UNA sola ficha: «Asignar
// ficha» la busca y los acredita en el acto (`asignarIncentivo`, la misma del
// portal). El afiche impreso con el QR sigue en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { asignarIncentivo, fetchAvance, fetchEncuesta, fetchIncentivos, fetchPersonas } from '@nucleo/data/encuestasClientes';
import { buscarClientes } from '@nucleo/data/customers';
import { canalDe, enlaceDeEncuesta, metaTotal } from '@nucleo/utils/encuestasClientes';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatPct } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const ESTADO_INCENTIVO = {
  acreditado: { label: 'Acreditado', variant: 'success' }, entregado: { label: 'Entregada', variant: 'success' },
  pendiente: { label: 'Pendiente', variant: 'warning' }, no_aplica: { label: 'No aplica', variant: 'neutral' },
};
const telefono = (t) => String(t || '').replace(/(\d{4})(\d{4})/, '$1-$2');

function AsignarFicha({ incentivo, onListo, onCancelar }) {
  const [texto, setTexto] = useState(incentivo.telefono || '');
  const q = useTextoRebotado(texto, 300).trim();
  const [resultados, setResultados] = useState([]);
  useEffect(() => {
    if (q.length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- búsqueda corta
    let vivo = true;
    buscarClientes(q, { select: 'id, name, phone, acumula_puntos', limite: 8 }).then(({ data }) => { if (vivo) setResultados(data || []); });
    return () => { vivo = false; };
  }, [q]);
  const elegir = (c) => Alert.alert('Asignar la ficha', `${incentivo.puntos} puntos para ${c.name}. Se acreditan en el acto.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Asignar', onPress: async () => {
      trabajando('Asignando…');
      try {
        const r = await asignarIncentivo(incentivo.id, c.id);
        listo(r?.estado === 'acreditado' ? 'Puntos acreditados' : 'Ficha asignada', r?.estado === 'no_aplica' ? 'Esa ficha no acumula puntos.' : '');
        onListo();
      } catch (e) { fallo('No se pudo asignar', mensajeAmigable(e)); }
    } },
  ]);
  return (
    <View style={{ gap: 8, paddingTop: 8 }}>
      <Campo multiline={false} autoCorrect={false} placeholder="Nombre, teléfono, DUI…" value={texto} onChangeText={setTexto} />
      {resultados.map((c) => (
        <Tocable key={c.id} disabled={c.acumula_puntos === false} onPress={() => elegir(c)}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: c.acumula_puntos === false ? 0.45 : pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{c.name}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${c.phone || 'Sin teléfono'}${c.acumula_puntos === false ? ' · no acumula puntos' : ''}`}</Text>
        </Tocable>
      ))}
      {q.length >= 3 && !resultados.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin fichas con esa búsqueda.</Text> : null}
      <Tocable onPress={onCancelar} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Cancelar</Text>
      </Tocable>
    </View>
  );
}

export default function AvanceEncuesta() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('encuestas_clientes', 'can_edit');
  const [encuesta, setEncuesta] = useState(null);
  const [avance, setAvance] = useState(null);
  const [incentivos, setIncentivos] = useState(null);
  const [personas, setPersonas] = useState({});
  const [error, setError] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([fetchEncuesta(id), fetchAvance(id)]);
      setEncuesta(e); setAvance(a); setError(null);
      if (e && e.incentivo_tipo !== 'ninguno') {
        const l = await fetchIncentivos(id);
        setIncentivos(l);
        setPersonas(await fetchPersonas(l.flatMap((i) => [i.entrevistador_id, i.resuelto_por])).catch(() => ({})));
      }
    } catch (err) { setError(mensajeAmigable(err, 'No se pudo cargar el avance.')); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const compartir = (url, titulo) => { Haptics.selectionAsync().catch(() => {}); Share.share({ message: url, title: titulo }).catch(() => {}); };
  const meta = useMemo(() => (encuesta && avance ? metaTotal(encuesta, avance.por_sucursal) : null), [encuesta, avance]);
  const cuenta = (e) => (incentivos || []).filter((i) => i.estado === e).length;
  const puntosDados = (incentivos || []).filter((i) => i.estado === 'acreditado').reduce((a, i) => a + (i.puntos || 0), 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Avance' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {!encuesta || !avance ? (error ? null : <ActivityIndicator style={{ marginTop: 24 }} />) : !['publicada', 'cerrada'].includes(encuesta.estado) ? (
          <View style={{ marginHorizontal: 16 }}><Aviso texto="El avance y los enlaces aparecen cuando la encuesta se publica." /></View>
        ) : (
          <>
            <FilaDeKpis>
              <Kpi icono="Users" rotulo="Respuestas" valor={String(avance.total)} color={MARCA.azul} apoyo={meta ? `de ${meta} · ${formatPct((avance.total / meta) * 100, { decimales: 0 })}` : 'sin meta'} />
              <Kpi icono="CalendarCheck" rotulo="Hoy" valor={String(avance.hoy)} color={MARCA.verde} apoyo="respuestas de hoy" />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="Smartphone" rotulo="Con datos" valor={String(avance.con_contacto)} color={MARCA.azulClaro} apoyo="dejaron teléfono o nombre" />
              <Kpi icono="Clock" rotulo="Última" valor={avance.ultima ? hora12(avance.ultima) : '—'} color={MARCA.violetaClaro} apoyo={avance.ultima ? fechaTexto(avance.ultima, { day: 'numeric', month: 'short' }) : 'sin respuestas'} />
            </FilaDeKpis>
            <View style={{ marginHorizontal: 16 }}>
              <Seccion titulo="Por sucursal">
                {avance.por_sucursal.map((s, i) => {
                  const cuota = encuesta.alcance === 'sucursales' ? s.meta : null;
                  const pct = cuota ? Math.min(100, (s.respuestas / cuota) * 100) : null;
                  const publica = encuesta.estado === 'publicada';
                  const conQr = encuesta.canales.includes('qr');
                  const conTablet = encuesta.canales.includes('kiosco');
                  return (
                    <View key={s.branch_id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{s.nombre}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${s.respuestas}${cuota ? ` de ${cuota}` : ''}`}</Text>
                      </View>
                      {pct != null ? (
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                          <View style={{ width: `${pct}%`, height: 8, backgroundColor: pct >= 100 ? MARCA.verde : MARCA.azulClaro }} />
                        </View>
                      ) : null}
                      {publica && (conQr || conTablet) ? (
                        <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
                          {conQr ? (
                            <Tocable onPress={() => compartir(enlaceDeEncuesta(s.token), `Encuesta · ${s.nombre}`)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Compartir el enlace</Text>
                            </Tocable>
                          ) : null}
                          {conTablet ? (
                            <Tocable onPress={() => compartir(enlaceDeEncuesta(s.token, true), `Tablet · ${s.nombre}`)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Enlace de la tablet</Text>
                            </Tocable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Seccion>
            </View>
            <View style={{ marginHorizontal: 16 }}>
              <Seccion titulo="Por canal">
                {encuesta.canales.map((c) => (
                  <View key={c} style={{ flexDirection: 'row' }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{canalDe(c).label}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{avance.por_canal?.[c] || 0}</Text>
                  </View>
                ))}
              </Seccion>
            </View>
            {encuesta.incentivo_tipo !== 'ninguno' && incentivos ? (
              <View style={{ marginHorizontal: 16 }}>
                <Seccion titulo="Incentivos" pie={encuesta.incentivo_tipo === 'puntos' ? `${puntosDados} puntos acreditados · ${cuenta('pendiente')} pendiente(s)` : `${cuenta('entregado')} entregada(s) · ${cuenta('pendiente')} por entregar`}>
                  {!incentivos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Todavía nadie ha dejado su teléfono para recibir el incentivo.</Text> : incentivos.map((i, k) => {
                    const est = ESTADO_INCENTIVO[i.estado] || ESTADO_INCENTIVO.pendiente;
                    const quien = personas[i.entrevistador_id];
                    return (
                      <View key={i.id} style={{ gap: 3, paddingTop: k ? 10 : 0, borderTopWidth: k ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
                            {`${i.cliente || i.contacto_nombre || 'Sin nombre'}${i.telefono ? ` · ${telefono(i.telefono)}` : ''}`}
                          </Text>
                          <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                        </View>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                          {[i.sucursal, canalDe(i.canal).label, fechaTexto(i.created_at, { day: 'numeric', month: 'short' }), quien ? shortEmployeeName(quien) : null,
                            i.tipo === 'puntos' ? `${i.puntos} pts` : (i.descripcion || 'Muestra')].filter(Boolean).join(' · ')}
                        </Text>
                        {i.estado === 'pendiente' && i.motivo ? <Text style={{ color: MARCA.ambar, fontSize: 12 }}>{i.motivo}</Text> : null}
                        {puedeEditar && i.tipo === 'puntos' && ['pendiente', 'no_aplica'].includes(i.estado) ? (
                          asignando === i.id
                            ? <AsignarFicha incentivo={i} onCancelar={() => setAsignando(null)} onListo={() => { setAsignando(null); cargar(); }} />
                            : (
                              <Tocable onPress={() => setAsignando(i.id)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
                                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Asignar ficha</Text>
                              </Tocable>
                            )
                        ) : null}
                      </View>
                    );
                  })}
                </Seccion>
              </View>
            ) : null}
            <View style={{ marginHorizontal: 16 }}><Aviso texto="El afiche con el QR para imprimir se arma en el portal." /></View>
          </>
        )}
      </ScrollView>
    </>
  );
}
