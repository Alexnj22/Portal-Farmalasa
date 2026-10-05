// Puntos, NATIVO — el programa visto desde el teléfono (`PuntosView`):
//
//   · Resumen: ¿funciona? Lo que se debe en puntos, lo acumulado y canjeado en
//     el mes contra el anterior, hoy por sala y lo próximo que vence.
//   · Consulta: los clientes con su saldo, para revisarlo antes de un canje.
//     Tocar uno abre su cuenta (`puntos-cliente/[id]`).
//   · Avisos: lo que hay que revisar (canjes sin saldo, anulaciones con puntos
//     gastados, movimientos fuera de lo normal).
//
// Cada pestaña con su permiso, como en el portal; la base lo vuelve a comprobar.
// Asignar cuentas del sistema anterior y los traspasos siguen en el portal.
// Los rótulos salen del núcleo (`puntosTexto`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchAvisosDePuntos, fetchClientesConPuntos, fetchResumenDePuntos, fetchTableroDePuntos } from '@nucleo/data/puntos';
import { avisoDePuntos, dolaresDePuntos, motorQuieto, puntosTexto } from '@nucleo/utils/puntosTexto';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR = { danger: MARCA.rojo, warning: MARCA.ambar, info: MARCA.azulClaro };
const POR_PAGINA = 30;

function Resumen() {
  const [r, setR] = useState(null);
  const [t, setT] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetchResumenDePuntos(), fetchTableroDePuntos()]);
      setR(a); setT(b); setError(null);
    } catch (e) { setError(mensajeAmigable(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!r || !t) return <ActivityIndicator style={{ marginTop: 24 }} />;
  const encendido = !!r.config?.encendido;
  const quieto = motorQuieto(r.ultima_acumulacion, encendido);
  const mes = t.mes_actual || {};
  const ant = t.mes_anterior || {};
  const prox = (t.vencimientos || [])[0];
  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        {!encendido ? <Aviso tono="freno" texto="La acumulación de puntos está apagada." />
          : quieto ? <Aviso tono="freno" texto={`No se acumulan puntos desde hace ${quieto} minutos, con las salas abiertas.`} />
            : <Aviso tono="nota" texto={r.ultima_acumulacion ? `Funcionando · última acumulación ${fechaHora12(r.ultima_acumulacion)}` : 'Funcionando.'} />}
      </View>
      <FilaDeKpis>
        <Kpi icono="Wallet" rotulo="En las cuentas" valor={dolaresDePuntos(t.deuda?.puntos)} color={MARCA.violeta}
          apoyo={`${puntosTexto(t.deuda?.clientes)} clientes · ${puntosTexto(t.deuda?.listos_clientes)} ya pueden canjear`} />
        <Kpi icono="Gift" rotulo="Canjes del mes" valor={puntosTexto(mes.canjes)} color={MARCA.ambar}
          apoyo={`${dolaresDePuntos(mes.canjeado)} · ${puntosTexto(mes.clientes_canjearon)} clientes`} />
      </FilaDeKpis>
      <View style={{ marginHorizontal: 16, gap: 10 }}>
      <Seccion titulo={`${fechaTexto(t.mes, { month: 'long', year: 'numeric' })} contra el mes anterior`}>
        <Dato primero rotulo="Acumulado" valor={`${dolaresDePuntos(mes.acumulado)} · antes ${dolaresDePuntos(ant.acumulado)}`} />
        <Dato rotulo="Canjeado" valor={`${dolaresDePuntos(mes.canjeado)} · antes ${dolaresDePuntos(ant.canjeado)}`} />
        <Dato rotulo="Clientes que acumularon" valor={puntosTexto(mes.clientes_acumularon)} />
      </Seccion>
      <Seccion titulo="Hoy por sala">
        {(r.por_sala || []).map((s, i) => (
          <Dato key={s.sucursal} primero={i === 0} rotulo={s.sala} valor={`+${dolaresDePuntos(s.acumulado)} · −${dolaresDePuntos(s.canjeado)}`} />
        ))}
      </Seccion>
      </View>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso tono="nota" texto={prox
          ? `Lo próximo que vence: ${puntosTexto(prox.puntos)} puntos (${dolaresDePuntos(prox.puntos)}) en ${fechaTexto(prox.mes, { month: 'long', year: 'numeric' })}.`
          : 'No hay puntos por vencer.'} />
      </View>
    </>
  );
}

function Consulta({ busqueda }) {
  const [datos, setDatos] = useState({ total: 0, filas: [] });
  const [desde, setDesde] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const pedido = useRef(0);
  useEffect(() => { setDesde(0); }, [busqueda]);
  useEffect(() => {
    const yo = ++pedido.current;
    setCargando(true);
    fetchClientesConPuntos({ busqueda: busqueda || null, limite: POR_PAGINA, desde })
      .then((r) => {
        if (yo !== pedido.current) return;
        setError(null);
        setDatos((d) => ({ total: r?.total ?? 0, filas: desde === 0 ? (r?.filas || []) : [...d.filas, ...(r?.filas || [])] }));
      })
      .catch((e) => { if (yo === pedido.current) setError(mensajeAmigable(e)); })
      .finally(() => { if (yo === pedido.current) setCargando(false); });
  }, [busqueda, desde]);
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${puntosTexto(datos.total)} cliente${datos.total === 1 ? '' : 's'}`}</Text>
      {datos.filas.map((c) => (
        <Pressable key={c.customer_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/puntos-cliente/[id]', params: { id: String(c.customer_id), nombre: c.nombre } }); }}
          style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Vidrio radio={18} interactivo>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                  {[c.dui, c.telefono, c.ultima_acumulacion ? `acumuló ${fechaTexto(c.ultima_acumulacion, { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: Number(c.saldo) ? colorSistema.texto : colorSistema.texto2, fontSize: 17, fontWeight: '800' }}>{dolaresDePuntos(c.saldo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${puntosTexto(c.saldo)} pts`}</Text>
              </View>
            </View>
          </Vidrio>
        </Pressable>
      ))}
      {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!cargando && datos.total > datos.filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setDesde(datos.filas.length)} /></View> : null}
      {!cargando && !datos.filas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Ningún cliente con esa búsqueda</Text>
      ) : null}
    </>
  );
}

function Avisos() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { fetchAvisosDePuntos().then((a) => setLista(a || [])).catch((e) => { setError(mensajeAmigable(e)); setLista([]); }); }, []);
  if (lista == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {lista.map((a, i) => {
        const x = avisoDePuntos(a);
        return (
          <Pressable key={`${a.tipo}-${a.invoice_id ?? a.customer_id ?? i}-${a.cuando}`} disabled={!a.customer_id}
            onPress={() => router.push({ pathname: '/puntos-cliente/[id]', params: { id: String(a.customer_id), nombre: a.cliente } })}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo={!!a.customer_id}>
              <View style={{ padding: 12, gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pildora texto={x.rotulo} color={COLOR[x.severidad] ?? MARCA.ambar} />
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{x.puntos(a)}</Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{a.cliente || 'Sin ficha'}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>
                  {[a.cuando ? fechaHora12(a.cuando) : null, a.sala, a.documento, a.vendedor ? `vendió ${a.vendedor}` : null].filter(Boolean).join(' · ')}
                </Text>
                {a.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{a.nota}</Text> : null}
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {!lista.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Nada que revisar</Text>
      ) : null}
    </>
  );
}

export default function Puntos() {
  const { hasPermission } = useAuth();
  const pestanas = useMemo(() => [
    hasPermission('puntos_tab_resumen', 'can_view') && { id: 'resumen', label: 'Resumen' },
    hasPermission('puntos_tab_consulta', 'can_view') && { id: 'consulta', label: 'Consulta' },
    hasPermission('puntos_tab_avisos', 'can_view') && { id: 'avisos', label: 'Avisos' },
  ].filter(Boolean), [hasPermission]);
  const [elegida, setPestana] = useState(null);
  const pestana = elegida && pestanas.some((p) => p.id === elegida) ? elegida : pestanas[0]?.id;
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Puntos', headerLargeTitle: true,
        headerSearchBarOptions: pestana === 'consulta' ? {
          placeholder: 'Nombre, DUI o teléfono', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        } : undefined,
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        {pestanas.length > 1 ? <Segmentos activa={pestana} onCambiar={setPestana} opciones={pestanas} /> : null}
        {!pestana ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu cargo no tiene acceso a Puntos." /></View>
          : pestana === 'resumen' ? <Resumen key={llave} />
            : pestana === 'consulta' ? <Consulta key={llave} busqueda={busqueda} />
              : <Avisos key={llave} />}
      </ScrollView>
    </>
  );
}
