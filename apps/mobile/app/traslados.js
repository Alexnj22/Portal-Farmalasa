// Traslados entre salas, NATIVO (2026-09-30). Hasta ese día sólo «pedir» era
// de la app y lo demás abría el portal.
//
// El selector del sistema reparte en cuatro:
//   · Te piden     — lo que otra sala le pide a la mía (contestar: enviar todo,
//                    enviar lo que hay, o rechazar con motivo).
//   · Recibir      — lo que ya salió para acá (recibir y anotar lo que faltó).
//   · Envíos       — lo que una sala MANDA sin que se lo pidan: te enviaron,
//                    sin salir, te devuelven, enviaste. Cada uno abre
//                    `envio/[id]`, donde se decide renglón por renglón.
//   · Historial    — recibidos y rechazados de la semana.
//
// La barra tiene el escáner (recibir una caja con la cámara) y el «+»: pedir a
// otra sala, o abrir en el portal lo que todavía no es nativo (mandar
// producto, llevar productos, faltantes).
//
// Los datos son las mismas lecturas del portal (`data/traslados`,
// `data/envios`) y el alcance es el mismo: con «todas las salas» se ven todas;
// si no, la mía más las que estoy cubriendo ahora.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useComposicionTraslado } from '@nucleo/store/composicionTraslado';
import { fetchSalasQueCubro, fetchTrasladosHistorial, fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, fetchTrasladoPorCodigo } from '@nucleo/data/traslados';
import { fetchEnviosVivos, momentoDelEnvio } from '@nucleo/data/envios';
import { buscadorDePersonas, motivoDeRechazoCorto } from '@nucleo/utils/movimientoTexto';
import { textoBuscable } from '@nucleo/utils/trasladoTexto';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { getLocalMonday } from '@nucleo/utils/semana';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Segmentos from '../componentes/Segmentos';
import Escaner from '../componentes/Escaner';
import TarjetaTraslado, { Pildora, Ruta } from '../componentes/traslados/Tarjeta';
import Vidrio from '../componentes/Vidrio';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { MARCA } from '../componentes/inicio/marca';
import { sePuedeDeclararTarde } from '@nucleo/data/faltantes';

const HORAS_EN_CAMINO_ALERTA = 24;

const SECCIONES_ENVIO = [
  { id: 'por_decidir', titulo: 'Te enviaron', color: MARCA.azulClaro },
  { id: 'por_despachar', titulo: 'Sin salir de tu sala', color: MARCA.ambar },
  { id: 'por_recibir_devolucion', titulo: 'Te devuelven', color: MARCA.rojo },
  { id: 'en_camino', titulo: 'Enviaste', color: MARCA.verde },
];

function Titulo({ texto, n }) {
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 32, marginTop: 6 }}>
      {texto}{n ? ` · ${n}` : ''}
    </Text>
  );
}

function Vacio({ titulo, detalle }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 60, gap: 6, paddingHorizontal: 32 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{titulo}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>{detalle}</Text> : null}
    </View>
  );
}

function TarjetaEnvio({ envio, color, onPress }) {
  const lineas = envio.lineas || [];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}><Ruta desde={envio.origen_branch_name} hacia={envio.branch_name} /></View>
            {envio.codigo_bolsa ? <Pildora texto={envio.codigo_bolsa} color={color} /> : null}
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>
            {lineas.length === 1 ? `${lineas[0].cantidad} ${lineas[0].presentacion_tipo ?? ''} · ${lineas[0].descripcion}` : `${lineas.length} productos`}
          </Text>
          {envio.motivo_tipo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{envio.motivo_tipo}{envio.reason ? ` · ${envio.reason}` : ''}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Traslados() {
  const { user, hasPermission, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const enLaSolicitud = useComposicionTraslado((s) => s.renglones.length);
  const decide = hasPermission('traslados', 'can_approve');
  // `null` = la que corresponde: «Te piden» si la persona contesta, si no «Recibir».
  const [elegida, setVista] = useState(null);
  const vista = elegida ?? (decide ? 'piden' : 'recibir');
  const [datos, setDatos] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const todas = getScope?.('traslados') === 'ALL';
  const miSala = salaDelUsuario(user);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);

  const cargar = useCallback(async () => {
    const cubro = todas || !miSala ? [] : await fetchSalasQueCubro(miSala).catch(() => []);
    const salas = todas ? null : [String(miSala), ...(cubro || []).map((s) => String(s.branch_id ?? s))];
    const [c, r, e] = await Promise.all([
      decide ? fetchTrasladosPorConfirmar({ branchIds: salas }) : { filas: [] },
      fetchTrasladosPorRecibir({ branchId: todas ? null : miSala }),
      fetchEnviosVivos(),
    ]);
    setDatos({ piden: c.filas || [], recibir: r.filas || [], envios: e.envios || [] });
  }, [todas, miSala, decide]);

  const cargarHistorial = useCallback(async () => {
    const r = await fetchTrasladosHistorial({ branchId: todas ? null : miSala, semana: getLocalMonday() });
    setHistorial((r.filas || r.data || []).filter((f) => f.status === 'REJECTED' || f.metadata?.erp_recibido));
  }, [todas, miSala]);

  // Al volver de contestar o recibir, la lista tiene que dejar de ofrecerlo.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const recargar = async () => { setRecargando(true); await cargar(); if (vista === 'historial') await cargarHistorial(); setRecargando(false); };

  const filtrar = (lista) => (busqueda.trim()
    ? smartFilter(busqueda, lista, (f) => [textoBuscable(f, (id) => persona(id)?.name)]).results
    : lista);

  const piden = filtrar(datos?.piden ?? []);
  const recibir = filtrar(datos?.recibir ?? []);
  const envios = datos?.envios ?? [];
  const porMomento = (id) => envios.filter((x) => momentoDelEnvio(x, todas ? null : miSala) === id);

  // Escanear una caja: el número del traslado (o el E##### de un envío) que va
  // en el código del ticket pegado a la bolsa. Un traslado abre su pantalla
  // para recibirlo; lo demás se dice en el mismo escáner.
  const alEscanear = async (codigo) => {
    const { traslado, error } = await fetchTrasladoPorCodigo(codigo);
    if (error || !traslado) { setAviso({ tono: 'error', texto: `No encontramos ${codigo}, o es de otra sala.` }); return false; }
    if (traslado.es_de_un_pedido) { setAviso({ tono: 'info', texto: 'Esa caja es de un pedido de Bodega: se recibe en Pedidos.' }); return false; }
    setEscaneando(false);
    setAviso(null);
    // Una bolsa ya recibida, dentro de las 48 h: se puede anotar lo que faltó.
    if (sePuedeDeclararTarde(traslado)) { router.push({ pathname: '/faltante-tardio', params: { codigo: String(codigo) } }); return true; }
    if (traslado.es_un_envio) { router.push({ pathname: '/envio/[id]', params: { id: String(traslado.envio_bolsa?.id ?? traslado.id) } }); return true; }
    router.push({ pathname: '/traslado/[id]', params: { id: String(traslado.id) } });
    return true;
  };

  const opciones = [
    decide && { id: 'piden', label: datos?.piden?.length ? `Te piden (${datos.piden.length})` : 'Te piden' },
    { id: 'recibir', label: datos?.recibir?.length ? `Recibir (${datos.recibir.length})` : 'Recibir' },
    { id: 'envios', label: 'Envíos' },
    { id: 'historial', label: 'Historial' },
  ].filter(Boolean);

  const abrir = (f) => router.push({ pathname: '/traslado/[id]', params: { id: String(f.id) } });
  const escanear = () => { Haptics.selectionAsync().catch(() => {}); setAviso(null); setEscaneando(true); };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA,
        title: 'Traslados',
        headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Producto, sala o persona…',
          hideWhenScrolling: true,
          onChangeText: (e) => setBusqueda(e.nativeEvent.text),
          onCancelButtonPress: () => setBusqueda(''),
        },
      }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="barcode.viewfinder" accessibilityLabel="Escanear una caja" onPress={escanear} />
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Nuevo">
          <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={() => router.push('/pedir-traslado')}>
            {enLaSolicitud ? `Seguir la solicitud (${enLaSolicitud})` : 'Pedir a otra sala'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="barcode.viewfinder" onPress={escanear}>Recibir una caja</Stack.Toolbar.MenuAction>
          {hasPermission('traslados', 'can_edit') ? (
            <Stack.Toolbar.MenuAction icon="shippingbox" onPress={() => router.push('/enviar-producto')}>Enviar producto</Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction icon="figure.walk" onPress={() => router.push('/retiro')}>Llevar productos</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="exclamationmark.triangle" onPress={() => router.push('/faltantes')}>Faltantes</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={recargar} />}>
        <Segmentos opciones={opciones} activa={vista} onCambiar={(v) => { setVista(v); if (v === 'historial' && !historial) cargarHistorial(); }} />

        {vista === 'piden' ? (
          piden.length ? piden.map((f) => (
            <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} onPress={() => abrir(f)}
              estado={{ texto: 'Por contestar', color: MARCA.ambar }} />
          )) : datos ? <Vacio titulo="Nadie te está pidiendo nada" detalle="Lo que otra sala le pida a la tuya aparece acá." /> : null
        ) : null}

        {vista === 'recibir' ? (
          recibir.length ? recibir.map((f) => {
            const salio = f.metadata?.erp_traslado?.at ?? f.updated_at;
            const tarde = (Date.now() - new Date(salio).getTime()) / 3600000 > HORAS_EN_CAMINO_ALERTA;
            return (
              <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} desdeCuando={salio} alerta={tarde}
                estado={{ texto: 'En camino', color: MARCA.azulClaro }} onPress={() => abrir(f)} />
            );
          }) : datos ? <Vacio titulo="Nada en camino" detalle="Cuando una sala despache lo que pediste, aparece acá. También puedes escanear la caja." /> : null
        ) : null}

        {vista === 'envios' ? (
          envios.length ? SECCIONES_ENVIO.map((s) => {
            const lista = porMomento(s.id);
            if (!lista.length) return null;
            return (
              <View key={s.id} style={{ gap: 10 }}>
                <Titulo texto={s.titulo} n={lista.length} />
                {lista.map((e) => <TarjetaEnvio key={e.id} envio={e} color={s.color} onPress={() => router.push({ pathname: '/envio/[id]', params: { id: String(e.id) } })} />)}
              </View>
            );
          }) : datos ? <Vacio titulo="Sin envíos en curso" detalle="Lo que una sala manda sin que se lo pidan aparece acá." /> : null
        ) : null}

        {vista === 'historial' ? (
          historial?.length ? filtrar(historial).map((f) => (
            <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} desdeCuando={f.updated_at} onPress={() => abrir(f)}
              estado={f.status === 'REJECTED'
                ? { texto: motivoDeRechazoCorto(f) || 'Rechazado', color: MARCA.rojo }
                : { texto: 'Recibido', color: MARCA.verde }} />
          )) : historial ? <Vacio titulo="Nada esta semana" /> : null
        ) : null}
      </ScrollView>

      <Escaner visible={escaneando} titulo="Recibir una caja" ayuda="Apunta al código del ticket pegado a la bolsa"
        onCodigo={alEscanear} onCerrar={() => { setEscaneando(false); setAviso(null); }}
        pie={aviso ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{aviso.texto}</Text> : null} />
    </>
  );
}
