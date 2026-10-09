// Puntos, NATIVO — el programa visto desde el teléfono (`PuntosView`):
//
//   · Resumen: ¿funciona? Las cifras del día y del mes, los últimos 30 días,
//     el mes por sala, los que más tienen y cuándo vence lo que se debe, en
//     puntos o en dólares (`componentes/puntos/Resumen`).
//   · Consulta: los clientes con su saldo, lo acumulado y lo canjeado,
//     ordenados como la tabla del portal. Tocar uno abre su cuenta
//     (`puntos-cliente/[id]`).
//   · Avisos: lo que hay que revisar (canjes sin saldo, anulaciones con puntos
//     gastados, movimientos fuera de lo normal).
//
//   · Por asignar: las cuentas del sistema anterior que no pasaron solas; tocar
//     una abre `asignar-cuenta`. En Avisos, arriba, los traspasos de puntos de
//     los cambios de cliente que quedaron a medias (reintentar o resolver a mano).
// Cada pestaña con su permiso, como en el portal; la base lo vuelve a comprobar.
// Los rótulos salen del núcleo (`puntosTexto`).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchAvisosDePuntos, fetchClientesConPuntos } from '@nucleo/data/puntos';
import { avisoDePuntos, dolaresDePuntos, puntosTexto } from '@nucleo/utils/puntosTexto';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import PorAsignar from '../componentes/puntos/PorAsignar';
import Traspasos from '../componentes/puntos/Traspasos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useMasAlFinal } from '../componentes/ListaPaginada';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Resumen, { COLOR_ACUMULADO, COLOR_CANJEADO } from '../componentes/puntos/Resumen';

const COLOR = { danger: MARCA.rojo, warning: MARCA.ambar, info: MARCA.azulClaro };
const POR_PAGINA = 30;

function Consulta({ busqueda, orden, dir, masRef }) {
  const [datos, setDatos] = useState({ total: 0, filas: [] });
  const [desde, setDesde] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const pedido = useRef(0);
  useEffect(() => { setDesde(0); }, [busqueda, orden, dir]);
  useEffect(() => {
    const yo = ++pedido.current;
    setCargando(true);
    fetchClientesConPuntos({ busqueda: busqueda || null, limite: POR_PAGINA, desde, orden, dir })
      .then((r) => {
        if (yo !== pedido.current) return;
        setError(null);
        setDatos((d) => ({ total: r?.total ?? 0, filas: desde === 0 ? (r?.filas || []) : [...d.filas, ...(r?.filas || [])] }));
      })
      .catch((e) => { if (yo === pedido.current) setError(mensajeAmigable(e)); })
      .finally(() => { if (yo === pedido.current) setCargando(false); });
  }, [busqueda, desde, orden, dir]);
  // El ScrollView de la pantalla pide la página siguiente al acercarse al final.
  useEffect(() => {
    if (!masRef) return undefined;
    masRef.current = () => { if (!cargando && datos.total > datos.filas.length) setDesde(datos.filas.length); };
    return () => { masRef.current = null; };
  });
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
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                  <Text style={{ color: COLOR_ACUMULADO, fontWeight: '700' }}>{`+${puntosTexto(c.acumulados)}`}</Text>{' acumulados · '}
                  <Text style={{ color: COLOR_CANJEADO, fontWeight: '700' }}>{`−${puntosTexto(c.canjeados)}`}</Text>{' canjeados'}
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
  const masConsulta = useRef(null);
  const alFinal = useMasAlFinal(() => masConsulta.current?.());
  const pestanas = useMemo(() => [
    hasPermission('puntos_tab_resumen', 'can_view') && { id: 'resumen', label: 'Resumen' },
    hasPermission('puntos_tab_consulta', 'can_view') && { id: 'consulta', label: 'Consulta' },
    hasPermission('puntos_tab_avisos', 'can_view') && { id: 'avisos', label: 'Avisos' },
    hasPermission('puntos_tab_por_asignar', 'can_view') && { id: 'por_asignar', label: 'Por asignar' },
  ].filter(Boolean), [hasPermission]);
  const [elegida, setPestana] = useState(null);
  const pestana = elegida && pestanas.some((p) => p.id === elegida) ? elegida : pestanas[0]?.id;
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [llave, setLlave] = useState(0);
  // El orden de la consulta, el mismo que la tabla del portal deja elegir
  // (`puntos_panel_clientes` ordena en la base).
  const [orden, setOrden] = useState('saldo.desc');
  const [ordenCol, ordenDir] = orden.split('.');
  const grupos = pestana === 'consulta' ? [{
    id: 'orden', titulo: 'Ordenar por', activa: orden, porDefecto: 'saldo.desc', onCambiar: setOrden,
    opciones: [
      { id: 'saldo.desc', label: 'Más puntos' }, { id: 'saldo.asc', label: 'Menos puntos' },
      { id: 'acumulados.desc', label: 'Más acumulados' }, { id: 'canjeados.desc', label: 'Más canjeados' },
      { id: 'ultima.desc', label: 'Acumuló hace menos' }, { id: 'ultima.asc', label: 'Acumuló hace más' },
      { id: 'nombre.asc', label: 'Nombre (A–Z)' },
    ],
  }] : [];
  const [recargando, setRecargando] = useState(false);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Puntos', headerLargeTitle: true,
        headerSearchBarOptions: pestana === 'consulta' || pestana === 'por_asignar' ? {
          placeholder: 'Nombre, DUI o teléfono', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        } : undefined,
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        {pestanas.length > 1 ? <Segmentos activa={pestana} onCambiar={setPestana} opciones={pestanas} /> : null}
        <FiltrosActivos grupos={grupos} />
        {!pestana ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto="Tu cargo no tiene acceso a Puntos." /></View>
          : pestana === 'resumen' ? <Resumen key={llave} onIrA={(p) => { if (pestanas.some((x) => x.id === p)) setPestana(p); }} />
            : pestana === 'consulta' ? <Consulta key={llave} busqueda={busqueda} orden={ordenCol} dir={ordenDir} masRef={masConsulta} />
              : pestana === 'por_asignar' ? <PorAsignar key={llave} busqueda={busqueda} />
                : (<><Traspasos key={`t${llave}`} puedeResolver={hasPermission('puntos_ajustar', 'can_view')} /><Avisos key={llave} /></>)}
      </ScrollView>
    </>
  );
}
