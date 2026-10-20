// Puntos, NATIVO — el programa visto desde el teléfono (`PuntosView`):
//
//   · Resumen: ¿funciona? Las cifras del día y del mes, los últimos 30 días,
//     el mes por sala, los que más tienen y cuándo vence lo que se debe, en
//     puntos o en dólares (`componentes/puntos/Resumen`).
//   · Consulta: los clientes con su saldo, lo acumulado y lo canjeado,
//     ordenados como la tabla del portal. Tocar uno abre su cuenta
//     (`puntos-cliente/[id]`). Arriba, «Escanear tarjeta» (2026-10-15): la
//     cámara lee el código de barras o el QR de la tarjeta del cliente y abre
//     su cuenta con TODO lo suyo (`como` → `componentes/puntos/Expediente`),
//     como la pestaña «Escanear» del portal. Si el código es de varias fichas
//     (un teléfono compartido) se elige aquí.
//   · Avisos: lo que hay que revisar (canjes sin saldo, anulaciones con puntos
//     gastados, movimientos fuera de lo normal).
//
//   · Por asignar: las cuentas del sistema anterior que no pasaron solas; tocar
//     una abre `asignar-cuenta`. En Avisos, arriba, los traspasos de puntos de
//     los cambios de cliente que quedaron a medias (reintentar o resolver a mano).
// Cada pestaña con su permiso, como en el portal; la base lo vuelve a comprobar.
// Los rótulos salen del núcleo (`puntosTexto`).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscarClientePorTarjeta, entregarPremio, fetchAvisosDePuntos, fetchClientesConPuntos, fetchPremiosPorEntregar, QUE_HACER_POR_MOTIVO } from '@nucleo/data/puntos';
import { leerCodigoDePremio } from '@nucleo/utils/codigoDePremio';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leerEntradaDeTarjeta, NOMBRE_DE_ENTRADA } from '@nucleo/utils/expedienteDelCliente';
import Escaner from '../componentes/Escaner';
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

const abrirEscaneado = (c, modo) => router.push({
  pathname: '/puntos-cliente/[id]', params: { id: String(c.customer_id), nombre: c.nombre, como: modo },
});

// El botón de escanear y, si el código es de varias fichas, la lista para elegir.
function EscanearTarjeta() {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [candidatos, setCandidatos] = useState(null);
  const { user, hasPermission } = useAuth();
  const miSala = user?.branchId ?? user?.branch_id ?? null;
  const administra = hasPermission('puntos_tab_niveles', 'can_edit');

  // Un premio del raspable (2026-10-19): escanear su código en la app del
  // cliente, confirmar, y queda entregado —el producto se descarga del
  // inventario de la sala—. La misma regla que el portal: sólo en la sala
  // donde el cliente lo retira, salvo quien administra los niveles.
  const entregarEscaneado = async (codigo) => {
    try {
      const lista = await fetchPremiosPorEntregar(administra ? null : miSala, codigo, true);
      const p = (lista ?? []).find((x) => x.codigo === codigo);
      const no = !p ? `No hay un premio ${codigo}${administra ? '' : ' para esta sucursal'}.`
        : p.estado === 'ENTREGADO' ? 'Ese premio ya se entregó.'
          : p.estado === 'VENCIDO' ? 'Ese premio ya venció.'
            : !p.branch_id ? 'El cliente todavía no eligió dónde retirarlo: que lo elija en la app.'
              : p.tipo === 'promocional' && p.hay_en_sala === false ? 'En esta sucursal no hay de ese regalo: hay que pedirlo a Bodega.'
                : null;
      if (no) { Alert.alert('No se puede entregar', no); return; }
      const cuantos = Number(p.cantidad) > 1 ? `${p.cantidad} × ` : '';
      Alert.alert(`¿Entregar ${cuantos}${p.nombre}?`,
        `Premio ${p.codigo} de ${p.cliente?.nombre ?? 'el cliente'}. ${p.tipo === 'producto' ? 'Se descarga del inventario de esta sucursal.' : 'Sale del inventario de regalos de esta sucursal.'} Confirma con su documento que es la persona.`,
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Entregar', onPress: async () => {
          trabajando('Entregando…');
          try { await entregarPremio(p.id); listo('Premio entregado', `${p.codigo} · ${p.nombre}`); }
          catch (e) { fallo('No se pudo entregar', mensajeAmigable(e)); }
        } }]);
    } catch (e) {
      Alert.alert('No se pudo buscar el premio', mensajeAmigable(e));
    }
  };

  // `false` deja el escáner abierto: el código no era una tarjeta conocida.
  const alEscanear = async (codigo) => {
    const premio = leerCodigoDePremio(codigo);
    if (premio) { setAbierto(false); setAviso(null); entregarEscaneado(premio); return true; }
    const leido = leerEntradaDeTarjeta(codigo);
    if (leido.tipo === 'nada') { setAviso('Ese código no es una tarjeta de cliente.'); return false; }
    try {
      const r = await buscarClientePorTarjeta(leido.valor);
      const lista = r?.clientes ?? [];
      const modo = r?.modo ?? leido.tipo;
      if (!lista.length) {
        setAviso(modo === 'codigo' ? 'Esa tarjeta no está registrada.' : `Ningún cliente con ${NOMBRE_DE_ENTRADA[modo] ?? 'ese dato'}.`);
        return false;
      }
      setAbierto(false);
      setAviso(null);
      if (lista.length === 1) { setCandidatos(null); abrirEscaneado(lista[0], modo); }
      else setCandidatos({ modo, clientes: lista });
      return true;
    } catch (e) {
      setAviso(mensajeAmigable(e));
      return false;
    }
  };
  return (
    <View style={{ marginHorizontal: 16, gap: 10 }}>
      <BotonGrande texto="Escanear tarjeta o premio" onPress={() => { setAviso(null); setAbierto(true); }} />
      {candidatos ? (
        <Vidrio radio={18}>
          <View style={{ padding: 12, gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${candidatos.clientes.length} clientes con ${NOMBRE_DE_ENTRADA[candidatos.modo] ?? 'ese dato'}: pregúntale su nombre.`}</Text>
            {candidatos.clientes.map((c) => (
              <Pressable key={c.customer_id} accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); setCandidatos(null); abrirEscaneado(c, candidatos.modo); }}
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{c.nombre || 'Sin nombre'}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{[c.dui, c.telefono].filter(Boolean).join(' · ') || 'Sin documento'}</Text>
              </Pressable>
            ))}
          </View>
        </Vidrio>
      ) : null}
      <Escaner visible={abierto} titulo="Tarjeta del cliente" ayuda="Apunta al código de barras o al QR de su tarjeta, o al de su premio"
        onCodigo={alEscanear} onCerrar={() => { setAbierto(false); setAviso(null); }}
        pie={aviso ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{aviso}</Text> : null} />
    </View>
  );
}
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
            // El aviso viaja entero: la cuenta pinta arriba la venta que lo
            // originó (productos y quién vendió), como el portal.
            onPress={() => router.push({ pathname: '/puntos-cliente/[id]', params: { id: String(a.customer_id), nombre: a.cliente, aviso: JSON.stringify(a) } })}
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
  // «Por qué no pasó»: el mismo filtro de motivo que la pestaña del portal.
  const [motivo, setMotivo] = useState('TODOS');
  const grupos = pestana === 'por_asignar' ? [{
    id: 'motivo', titulo: 'Por qué no pasó', activa: motivo, porDefecto: 'TODOS', onCambiar: setMotivo,
    opciones: [{ id: 'TODOS', label: 'Todos' }, ...Object.keys(QUE_HACER_POR_MOTIVO).map((m) => ({ id: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))],
  }] : pestana === 'consulta' ? [{
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
            : pestana === 'consulta' ? (<><EscanearTarjeta /><Consulta key={llave} busqueda={busqueda} orden={ordenCol} dir={ordenDir} masRef={masConsulta} /></>)
              : pestana === 'por_asignar' ? <PorAsignar key={llave} busqueda={busqueda} motivo={motivo} />
                : (<><Traspasos key={`t${llave}`} puedeResolver={hasPermission('puntos_ajustar', 'can_view')} /><Avisos key={llave} /></>)}
      </ScrollView>
    </>
  );
}
