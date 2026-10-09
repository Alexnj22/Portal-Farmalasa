// Ofertas para clientes, NATIVO — `OfertasClientesView`: lo que ve el cliente
// en la pestaña «Ofertas» de Puntos Salud, y los pre-registros de quien se unió
// desde la app y todavía no tiene ficha.
//
// Una oferta se ve en la app si está publicada y hoy cae entre su inicio y su
// fin (`estadoDeOferta`, núcleo: el mismo rótulo que el portal). Cada tarjeta
// lleva su foto con el color de su acento, como la verá el cliente. Tocarla
// la abre para editarla; mantenerla presionada ofrece publicar/retirar y
// borrar. El «+» de la barra crea una.
//
// Pre-registros: el toque abre la búsqueda de su ficha por documento para
// vincularla, o descartarlo (`preregistro/[id]`).
//
// Las cinco pestañas del portal: Ofertas, Historias (`componentes/ofertas/
// Historias`), Banners (`Banners`), Reservas de todas las salas (`Reservas`,
// con `ofertas_clientes` editar) y Pre-registros.
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { borrarOferta, fetchOfertas, fetchPreregistros, fetchSalas, publicarOferta } from '@nucleo/data/ofertasClientes';
import { ESTADOS_DE_OFERTA, estadoDeOferta, etiquetaDeDescuento } from '@nucleo/utils/ofertasClientes';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { MenuDeFiltros, FiltrosActivos } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { colorDeAcento, guardarOferta } from '../componentes/ofertas/acentos';
import { guardarPreregistro } from '../componentes/ofertas/preregistro';
import { fallo, listo } from '../componentes/Progreso';
import Historias, { ESTADOS_DE_HISTORIA, abrirHistoria } from '../componentes/ofertas/Historias';
import Banners, { abrirBanner } from '../componentes/ofertas/Banners';
import Reservas from '../componentes/ofertas/Reservas';

const rango = (o) => `${fechaTexto(o.inicio, { day: 'numeric', month: 'short' })} – ${fechaTexto(o.fin, { day: 'numeric', month: 'short' })}`;

export default function OfertasClientes() {
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('ofertas_clientes', 'can_edit');
  const veClientes = hasPermission('clientes', 'can_view');
  const editaClientes = hasPermission('clientes', 'can_edit');
  const [pestana, setPestana] = useState('ofertas');
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState('todas');
  const [ofertas, setOfertas] = useState(null);
  const [salas, setSalas] = useState([]);
  const [pre, setPre] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const hoy = hoySV();

  const cargar = useCallback(async () => {
    try {
      const [o, s, p] = await Promise.all([fetchOfertas(), fetchSalas(), veClientes ? fetchPreregistros('pendiente') : Promise.resolve([])]);
      setOfertas(o); setSalas(s); setPre(p); setError(null);
    } catch (e) {
      setError(mensajeAmigable(e, 'No se pudieron cargar las ofertas.'));
      setOfertas((x) => x ?? []); setPre((x) => x ?? []);
    }
  }, [veClientes]);
  // Al volver del editor la lista se relee: lo guardado tiene que verse.
  const [vuelta, setVuelta] = useState(0);
  useFocusEffect(useCallback(() => { cargar(); setVuelta((v) => v + 1); }, [cargar]));

  const nombreSala = useMemo(() => new Map(salas.map((s) => [s.id, s.name])), [salas]);
  const conEstado = useMemo(() => (ofertas ?? []).map((o) => ({ ...o, _estado: estadoDeOferta(o, hoy) })), [ofertas, hoy]);
  const cuenta = (k) => conEstado.filter((o) => o._estado.key === k).length;
  const visibles = conEstado
    .filter((o) => estado === 'todas' || o._estado.key === estado)
    .filter((o) => !texto.trim() || tokenMatch(texto, o.titulo, o.etiqueta ?? ''));
  const preVisibles = (pre ?? []).filter((p) => !texto.trim() || tokenMatch(texto, p.nombre, p.documento, p.telefono));

  const grupos = pestana === 'ofertas' || pestana === 'banners' ? [{
    id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'todas', onCambiar: setEstado,
    opciones: [{ id: 'todas', label: 'Todas' }, ...ESTADOS_DE_OFERTA.map((e) => ({ id: e.value, label: e.label }))],
  }] : pestana === 'historias' ? [{
    id: 'estado', titulo: 'Estado', activa: estado, porDefecto: 'todas', onCambiar: setEstado, opciones: ESTADOS_DE_HISTORIA,
  }] : [];
  const cambiarPestana = (p) => { setPestana(p); setEstado('todas'); };
  const nuevo = !puedeEditar ? null
    : pestana === 'ofertas' ? { icono: 'plus', etiqueta: 'Nueva oferta', onPress: () => abrir(null) }
      : pestana === 'historias' ? { icono: 'plus', etiqueta: 'Nueva historia', onPress: () => abrirHistoria(null) }
        : pestana === 'banners' ? { icono: 'plus', etiqueta: 'Nuevo banner', onPress: () => abrirBanner(null) } : null;
  const pestanas = [
    { id: 'ofertas', label: 'Ofertas' }, { id: 'historias', label: 'Historias' }, { id: 'banners', label: 'Banners' },
    ...(puedeEditar ? [{ id: 'reservas', label: 'Reservas' }] : []),
    ...(veClientes ? [{ id: 'preregistros', label: pre?.length ? `Pre-registros · ${pre.length}` : 'Pre-registros' }] : []),
  ];

  const abrir = (o) => {
    if (!puedeEditar) return;
    Haptics.selectionAsync().catch(() => {});
    guardarOferta(o);
    router.push({ pathname: '/oferta/[id]', params: { id: o?.id ? String(o.id) : 'nueva' } });
  };
  const alternar = async (o) => {
    try {
      await publicarOferta(o.id, !o.publicada);
      listo(o.publicada ? 'Oferta retirada' : 'Oferta publicada', o.publicada ? 'Ya no se ve en la app.' : 'Se ve en la app durante sus fechas.');
      cargar();
    } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
  };
  const borrar = (o) => Alert.alert('Borrar oferta', `«${o.titulo}» deja de verse en la app y se borra su imagen.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: async () => {
      try { await borrarOferta(o); listo('Oferta borrada', ''); cargar(); }
      catch (e) { fallo('No se pudo borrar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    } },
  ]);
  const menu = (o) => {
    if (!puedeEditar) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions({
      title: o.titulo, options: [o.publicada ? 'Retirar de la app' : 'Publicar en la app', 'Editar', 'Borrar', 'Cancelar'],
      destructiveButtonIndex: 2, cancelButtonIndex: 3,
    }, (i) => { if (i === 0) alternar(o); else if (i === 1) abrir(o); else if (i === 2) borrar(o); });
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Ofertas para clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: pestana === 'preregistros' ? 'Nombre o documento' : pestana === 'historias' ? 'Buscar historia' : pestana === 'banners' ? 'Buscar banner' : 'Buscar oferta', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={nuevo} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={pestana} onCambiar={cambiarPestana} opciones={pestanas} />
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}

        {pestana === 'historias' ? <Historias busqueda={texto.trim()} estado={estado} puedeEditar={puedeEditar} recarga={vuelta} />
          : pestana === 'banners' ? <Banners busqueda={texto.trim()} estado={estado} puedeEditar={puedeEditar} recarga={vuelta} />
          : pestana === 'reservas' ? <Reservas todas recarga={vuelta} />
          : pestana === 'ofertas' ? (
          ofertas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <FilaDeKpis>
                <Kpi icono="Smartphone" rotulo="En la app" valor={String(cuenta('vigente'))} color={MARCA.verde} apoyo="hoy la ve el cliente" onPress={() => setEstado(estado === 'vigente' ? 'todas' : 'vigente')} />
                <Kpi icono="CalendarClock" rotulo="Programadas" valor={String(cuenta('programada'))} color={MARCA.azulClaro} apoyo={`${cuenta('borrador')} sin publicar`} onPress={() => setEstado(estado === 'programada' ? 'todas' : 'programada')} />
              </FilaDeKpis>
              {visibles.map((o) => {
                const acento = colorDeAcento(o.acento);
                const detalle = [o.etiqueta, o.descuento_tipo ? `Descuento ${etiquetaDeDescuento(o.descuento_tipo, o.descuento_monto)}` : null, o.exclusiva ? 'Exclusiva para socios' : null].filter(Boolean);
                return (
                  <Pressable key={o.id} onPress={() => abrir(o)} onLongPress={() => menu(o)} delayLongPress={350}
                    style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                    <Vidrio radio={20} interactivo>
                      {o.imagen_url ? (
                        <View>
                          <Image source={{ uri: o.imagen_url }} style={{ width: '100%', aspectRatio: 16 / 9, borderTopLeftRadius: 20, borderTopRightRadius: 20 }} resizeMode="cover" />
                          {o.etiqueta ? (
                            <View style={{ position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: acento }}>
                              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{o.etiqueta}</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      <View style={{ padding: 14, gap: 6, borderLeftWidth: o.imagen_url ? 0 : 4, borderLeftColor: acento, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{o.titulo}</Text>
                          <Pildora texto={o._estado.label} color={colorDeVariante(o._estado.variant)} />
                        </View>
                        {detalle.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{detalle.join(' · ')}</Text> : null}
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {[rango(o), o.branch_ids?.length ? o.branch_ids.map((id) => nombreSala.get(id)).filter(Boolean).join(', ') : 'Todas las salas'].join(' · ')}
                        </Text>
                        {o.descuento_erp_id ? <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '600' }}>Sigue a un descuento de la caja</Text> : null}
                      </View>
                    </Vidrio>
                  </Pressable>
                );
              })}
              {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin ofertas con ese filtro</Text> : null}
              {puedeEditar && visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Mantén presionada una oferta para publicarla, retirarla o borrarla.</Text> : null}
            </>
          )
        ) : (
          pre == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <View style={{ marginHorizontal: 16 }}>
                <Aviso texto="Se unieron desde la app y todavía no tienen ficha. Cuando la sala los registra con el mismo documento y teléfono, la app los reconoce sola. Aquí quedan los que no coincidieron." />
              </View>
              {preVisibles.map((p) => (
                <Pressable key={p.id} disabled={!editaClientes}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); guardarPreregistro(p); router.push({ pathname: '/preregistro/[id]', params: { id: String(p.id) } }); }}
                  style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={18} interactivo>
                    <View style={{ padding: 14, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{p.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[`Documento ${p.documento}`, `Tel. ${p.telefono}`].join(' · ')}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se unió el ${fechaTexto(p.created_at, { day: 'numeric', month: 'long' })}`}</Text>
                    </View>
                  </Vidrio>
                </Pressable>
              ))}
              {!preVisibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin pre-registros pendientes</Text> : null}
            </>
          )
        )}
      </ScrollView>
    </>
  );
}
