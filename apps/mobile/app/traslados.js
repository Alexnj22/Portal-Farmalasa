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
//   · Historial    — lo cerrado: traslados recibidos y rechazados de la semana
//                    que se elija (con flechas, la consulta pide ESA semana),
//                    filtrables por desenlace y —con alcance de todas— por
//                    sala; y abajo los envíos cerrados, que se abren para ver
//                    cómo terminó cada producto y las fotos del daño.
//
// La barra tiene el escáner (recibir una caja con la cámara) y el «+»: pedir a
// otra sala, recibir una caja, enviar producto, llevar productos y faltantes —
// todo nativo.
//
// Como el portal: «Recibir» junta lo que se pidió a varias salas a la vez
// (con «Ya llegaron las N completas»), con alcance de todas se filtra por sala,
// el historial con alcance de todas se corta por sala de ORIGEN y desenlace, y
// una caja se puede recibir escribiendo su número si la cámara no la lee.
//
// Los datos son las mismas lecturas del portal (`data/traslados`,
// `data/envios`) y el alcance es el mismo: con «todas las salas» se ven todas;
// si no, la mía más las que estoy cubriendo ahora.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useComposicionTraslado } from '@nucleo/store/composicionTraslado';
import { fetchEstadoDeGrupos, fetchSalasQueCubro, fetchTrasladosHistorial, fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, fetchTrasladoPorCodigo, recibirTraslado } from '@nucleo/data/traslados';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { fetchEnviosHistorial, fetchEnviosVivos, momentoDelEnvio } from '@nucleo/data/envios';
import { buscadorDePersonas, motivoDeRechazoCorto } from '@nucleo/utils/movimientoTexto';
import { textoBuscable } from '@nucleo/utils/trasladoTexto';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { getLocalMonday } from '@nucleo/utils/semana';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Segmentos from '../componentes/Segmentos';
import PasoDeSemana from '../componentes/solicitudes/PasoDeSemana';
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
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
            {lineas.length === 1 ? `${lineas[0].cantidad} ${lineas[0].presentacion_tipo ?? ''} · ${lineas[0].descripcion}` : `${lineas.length} productos`}
          </Text>
          {envio.motivo_tipo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{envio.motivo_tipo}{envio.reason ? ` · ${envio.reason}` : ''}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Traslados() {
  const { user, hasPermission, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const enLaSolicitud = useComposicionTraslado((s) => s.renglones.length);
  const decide = hasPermission('traslados', 'can_approve');
  // `null` = la que corresponde: «Te piden» si la persona contesta, si no «Recibir».
  const [elegida, setVista] = useState(null);
  const vista = elegida ?? (decide ? 'piden' : 'recibir');
  const [datos, setDatos] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [enviosCerrados, setEnviosCerrados] = useState(null);
  const [semana, setSemana] = useState(() => getLocalMonday());
  const [salaFiltro, setSalaFiltro] = useState(null);
  const [desenlace, setDesenlace] = useState('todos');
  const [recargando, setRecargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [escaneando, setEscaneando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [salaRecibir, setSalaRecibir] = useState(null);
  const [grupos, setGrupos] = useState({});

  const todas = getScope?.('traslados') === 'ALL';
  const miSala = salaDelUsuario(user);
  const persona = useMemo(() => buscadorDePersonas(empleados), [empleados]);

  const cargar = useCallback(async () => {
    const cubro = todas || !miSala ? [] : await fetchSalasQueCubro(miSala).catch(() => []);
    const salas = todas ? null : [String(miSala), ...(cubro || []).map((s) => String(s.branch_id ?? s))];
    const [c, r, e] = await Promise.all([
      decide ? fetchTrasladosPorConfirmar({ branchIds: salas }) : { filas: [] },
      // Con alcance de todas, el recorte por sala lo hace la CONSULTA, como en
      // el portal: «en camino» mira el destino.
      fetchTrasladosPorRecibir({ branchId: todas ? salaRecibir : miSala }),
      fetchEnviosVivos(),
    ]);
    setDatos({ piden: c.filas || [], recibir: r.filas || [], envios: e.envios || [] });
    // El estado de los grupos va después y sólo por los que aparecen: es adorno;
    // si falla, las tarjetas se ven igual, sin el encabezado.
    const ids = (r.filas || []).map((f) => f.metadata?.grupo_id).filter(Boolean);
    const g = await fetchEstadoDeGrupos(ids).catch(() => ({ grupos: {} }));
    setGrupos(g.grupos || {});
  }, [todas, miSala, decide, salaRecibir]);

  // El historial pide la SEMANA elegida (y la sala) a la consulta: arriba hay
  // un tope de filas, y un tope se aplica antes del filtro. Recortar acá afuera
  // devolvería «las de esa semana entre las 200 más nuevas».
  const salaHistorial = todas ? salaFiltro : miSala;
  const cargarHistorial = useCallback(async () => {
    const [r, e] = await Promise.all([
      fetchTrasladosHistorial({ branchId: salaHistorial, semana }),
      fetchEnviosHistorial(200),
    ]);
    setHistorial(r.filas || r.data || []);
    setEnviosCerrados(e.envios || []);
  }, [salaHistorial, semana]);
  useEffect(() => { if (vista === 'historial') cargarHistorial(); }, [vista, cargarHistorial]);

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
    return abrirCaja(traslado, codigo);
  };
  // Escribir el número a mano, para cuando la cámara no lee el ticket (arrugado,
  // mojado, mal impreso). El número es el mismo que va en las barras.
  const escribirNumero = () => {
    Alert.prompt('Recibir por número', 'Escribe el número que trae el ticket de la caja.', async (t) => {
      const codigo = String(t ?? '').trim();
      if (!codigo) return;
      const { traslado, error } = await fetchTrasladoPorCodigo(codigo);
      if (error || !traslado) { fallo('No se encontró', `No encontramos ${codigo}, o es de otra sala.`); return; }
      if (traslado.es_de_un_pedido) { fallo('Es de un pedido', 'Esa caja es de un pedido de Bodega: se recibe en Pedidos.'); return; }
      abrirCaja(traslado, codigo);
    }, 'plain-text', '', 'number-pad');
  };
  const abrirCaja = (traslado, codigo) => {
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
    { id: 'envios', label: envios.length ? `Envíos (${envios.length})` : 'Envíos' },
    { id: 'historial', label: 'Historial' },
  ].filter(Boolean);

  const abrir = (f) => router.push({ pathname: '/traslado/[id]', params: { id: String(f.id) } });

  const historialVisto = filtrar(historial ?? []).filter((f) => desenlace === 'todos' || f.status === desenlace);
  // Con alcance de todas y sin sala elegida, el historial se corta por sala de
  // ORIGEN —la que despachó o rechazó— ordenada por cuántos cerró, y dentro de
  // cada una por desenlace. Igual que el portal (`HistorialTraslados`).
  const historialPorSala = useMemo(() => {
    if (!todas || salaFiltro) return null;
    const mapa = new Map();
    for (const f of historialVisto) {
      const sala = f.metadata?.origen_branch_name || 'Sin sala';
      if (!mapa.has(sala)) mapa.set(sala, []);
      mapa.get(sala).push(f);
    }
    return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historial, busqueda, desenlace, todas, salaFiltro]);

  // «En camino», partido en lo que se pidió junto y lo que no. Sólo se agrupa
  // lo que TIENE hermanas en la lista: un grupo de uno no es un grupo.
  const bloques = useMemo(() => {
    const porGrupo = new Map();
    const sueltas = [];
    for (const f of recibir) {
      const g = f.metadata?.grupo_id;
      if (!g) { sueltas.push(f); continue; }
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(f);
    }
    const lista = [];
    for (const [grupoId, filas] of porGrupo) {
      if (filas.length > 1) lista.push({ grupoId, filas }); else sueltas.push(...filas);
    }
    return { grupos: lista, sueltas };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, busqueda]);
  const puedeRecibir = hasPermission('traslados', 'can_approve');
  // Recibir las N cajas de un grupo DE UNA EN UNA: cada recepción es un viaje
  // al sistema de origen. Si una falla, las anteriores ya quedaron; esa se
  // reintenta desde su tarjeta.
  const recibirGrupo = (filas) => Alert.alert(`Ya llegaron las ${filas.length} completas`,
    'Se reciben todas sin faltantes. Si a una le faltó algo, recíbela desde su propia tarjeta: ahí se dice qué no venía.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Recibir todas', onPress: async () => {
        let hechas = 0;
        for (const f of filas) {
          trabajando(`Recibiendo ${f.metadata?.origen_branch_name ?? 'la otra sala'}… (${hechas} de ${filas.length})`);
          const r = await recibirTraslado(f.id);
          if (!r?.ok && r?.codigo !== 'YA_RECIBIDO') {
            fallo('No entraron todas', `Entraron ${hechas} de ${filas.length}. ${f.metadata?.origen_branch_name ?? 'Una sala'}: ${r?.error ?? 'no se pudo recibir'}. Vuelve a intentar sólo esa desde su tarjeta.`);
            break;
          }
          hechas += 1;
        }
        if (hechas === filas.length) listo('Recibidas', `Las ${filas.length} cajas quedaron recibidas.`);
        if (hechas > 0) cargar();
      } },
    ]);
  const tarjetaRecibir = (f) => {
    const salio = f.metadata?.erp_traslado?.at ?? f.updated_at;
    const tarde = (Date.now() - new Date(salio).getTime()) / 3600000 > HORAS_EN_CAMINO_ALERTA;
    return (
      <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} desdeCuando={salio} alerta={tarde}
        estado={{ texto: 'En camino', color: MARCA.azulClaro }} onPress={() => abrir(f)} />
    );
  };
  // Los envíos cerrados: los 200 más recientes, como en el portal. NO se
  // recortan por semana ni por sala acá afuera: la consulta trae un tope, y
  // recortar después de un tope esconde sin avisar (la regla de las 1000 filas).
  const enviosVistos = (enviosCerrados ?? []).filter((e) => {
    if (!busqueda.trim()) return true;
    return smartFilter(busqueda, [e], (x) => [[x.origen_branch_name, x.branch_name, x.motivo_tipo, x.reason, ...(x.lineas || []).map((l) => l.descripcion)].filter(Boolean).join(' ')]).results.length > 0;
  });
  const nombreDeSala = (sid) => (sucursales || []).find((b) => String(b.id) === String(sid))?.name ?? `Sala ${sid}`;
  const elegirSala = (poner = setSalaFiltro) => {
    const salas = (sucursales || []).filter((b) => b.type === 'FARMACIA' || b.type === 'BODEGA');
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Sala', options: ['Todas las salas', ...salas.map((b) => b.name), 'Cancelar'], cancelButtonIndex: salas.length + 1 },
      (i) => { if (i === 0) poner(null); else if (i <= salas.length) poner(String(salas[i - 1].id)); });
  };
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
          <Stack.Toolbar.MenuAction icon="number" onPress={escribirNumero}>Recibir escribiendo el número</Stack.Toolbar.MenuAction>
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
        <Segmentos opciones={opciones} activa={vista} onCambiar={setVista} />

        {vista === 'piden' ? (
          piden.length ? piden.map((f) => (
            <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} onPress={() => abrir(f)}
              estado={{ texto: 'Por contestar', color: MARCA.ambar }} />
          )) : datos ? <Vacio titulo="Nadie te está pidiendo nada" detalle="Lo que otra sala le pida a la tuya aparece acá." /> : null
        ) : null}

        {vista === 'recibir' ? (
          <>
            {todas ? (
              <Pressable onPress={() => elegirSala(setSalaRecibir)} style={({ pressed }) => ({ alignSelf: 'center', minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{salaRecibir ? `Sala: ${nombreDeSala(salaRecibir)}  ✕` : 'Todas las salas ▾'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={escribirNumero} style={({ pressed }) => ({ alignSelf: 'center', minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: colorSistema.acento, fontSize: 15 }}>¿La cámara no lee el ticket? Escribe el número</Text>
            </Pressable>
            {recibir.length ? (
              <>
                {bloques.grupos.map(({ grupoId, filas }) => {
                  const g = grupos[grupoId];
                  const salas = g?.total ?? filas.length;
                  const sinResponder = g?.sinResponder ?? 0;
                  return (
                    <View key={grupoId} style={{ gap: 10 }}>
                      <Titulo texto={`Lo pediste a ${salas} salas`} />
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 32, marginTop: -6 }}>
                        {(sinResponder > 0 ? `${salas - sinResponder} de ${salas} respondieron · ${sinResponder} sin responder` : `Las ${salas} respondieron`)
                          + (g?.rechazadas > 0 ? ` · ${g.rechazadas} no pudo mandarlo` : '')}
                      </Text>
                      {filas.map(tarjetaRecibir)}
                      {puedeRecibir && sinResponder === 0 ? (
                        <View style={{ marginHorizontal: 16, gap: 4 }}>
                          <BotonGrande texto={`Ya llegaron las ${filas.length} completas`} color={MARCA.verde} onPress={() => recibirGrupo(filas)} />
                          <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 4 }}>Si a una le faltó algo, recíbela desde su propia tarjeta: ahí se dice qué no venía.</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {bloques.grupos.length && bloques.sueltas.length ? <Titulo texto="Las demás" n={bloques.sueltas.length} /> : null}
                {bloques.sueltas.map(tarjetaRecibir)}
              </>
            ) : datos ? <Vacio titulo="Nada en camino" detalle="Cuando una sala despache lo que pediste, aparece acá. También puedes escanear la caja." /> : null}
          </>
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
          <>
            <PasoDeSemana semana={semana} onCambiar={setSemana} />
            <Segmentos activa={desenlace} onCambiar={setDesenlace} opciones={[
              { id: 'todos', label: 'Todos' }, { id: 'APPROVED', label: 'Recibidos' }, { id: 'REJECTED', label: 'Rechazados' },
            ]} />
            {todas ? (
              <Pressable onPress={() => elegirSala()} style={({ pressed }) => ({ alignSelf: 'center', minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{salaFiltro ? `Sala: ${nombreDeSala(salaFiltro)}  ✕` : 'Todas las salas ▾'}</Text>
              </Pressable>
            ) : null}
            {historial == null ? null : historialVisto.length ? (
              <>
                <Titulo texto="Traslados" n={historialVisto.length} />
                {(historialPorSala ?? [[null, historialVisto]]).map(([sala, deLaSala]) => (
                  <View key={sala ?? 'todas'} style={{ gap: 10 }}>
                    {sala ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', marginHorizontal: 32, marginTop: 6 }}>{`${sala} · ${deLaSala.length}`}</Text> : null}
                    {[...deLaSala].sort((a, b) => (a.status === 'REJECTED') - (b.status === 'REJECTED')).map((f) => (
                      <TarjetaTraslado key={f.id} fila={f} persona={persona(f.employee_id)} desdeCuando={f.updated_at} onPress={() => abrir(f)}
                        estado={f.status === 'REJECTED'
                          ? { texto: motivoDeRechazoCorto(f) || 'Rechazado', color: MARCA.rojo }
                          : f.metadata?.erp_recibido ? { texto: 'Recibido', color: MARCA.verde } : { texto: 'En camino', color: MARCA.azulClaro }} />
                    ))}
                  </View>
                ))}
              </>
            ) : <Vacio titulo="Nada esa semana" detalle="Usa las flechas para mirar otra semana." />}
            {desenlace === 'todos' && enviosVistos.length ? (
              <>
                <Titulo texto="Envíos cerrados · los más recientes" n={enviosVistos.length} />
                {enviosVistos.map((e) => {
                  const devueltas = (e.lineas || []).filter((l) => String(l.estado).startsWith('devuelta')).length;
                  return <TarjetaEnvio key={e.id} envio={e} color={devueltas ? MARCA.rojo : MARCA.verde}
                    onPress={() => router.push({ pathname: '/envio/[id]', params: { id: String(e.id) } })} />;
                })}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Escaner visible={escaneando} titulo="Recibir una caja" ayuda="Apunta al código del ticket pegado a la bolsa"
        onCodigo={alEscanear} onCerrar={() => { setEscaneando(false); setAviso(null); }}
        pie={aviso ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{aviso.texto}</Text> : null} />
    </>
  );
}
