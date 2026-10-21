// Mis reservas (2026-10-06): lo que el cliente apartó, si es de una promoción o
// un producto normal, en qué va, cómo se entrega (retiro en qué sucursal, o a
// domicilio), cómo se paga y si ya está pagado. Una reserva «lista» muestra la
// cuenta regresiva del plazo; una pendiente o lista se puede cancelar.
//
// Paginada y con filtros (2026-10-09): chips Todas · Abiertas · Retiradas ·
// Vencidas/Canceladas. El filtro lo aplica el servidor (para que «ver más»
// traiga más de lo filtrado), de a 20 por cursor. Las abiertas llegan siempre
// completas en la primera página; lo que se pagina son las terminadas.
//
// Un pedido del carrito es UNA tarjeta (2026-10-09). El servidor guarda una
// fila por producto (mismo `pedido`), y antes cada una era su tarjeta, con su
// QR, su «Pagar el pedido» y su «Cancelar»: tres botones de pagar que cobraban
// lo mismo. Hoy se agrupa AL VUELO sobre lo que haya cargado (`agruparPorPedido`):
// como se pagina por renglón, los de un mismo pedido terminado pueden llegar
// en páginas distintas, y al bajar la siguiente se suman a la tarjeta que ya
// estaba. Las reservas sueltas siguen como antes.
//
// Receta (2026-10-12): lo que lleva un producto bajo receta nace «en revisión»
// y va en su propia sección, ARRIBA: sin código para retirar y sin pagar
// (todavía se puede rechazar). Ahí se ve la foto que se mandó, el motivo si la
// sucursal pidió otra («Subir otra foto»), y en Anteriores, «Rechazada: …».
//
// Recetas y saldo a favor (2026-10-19, decisiones del dueño): la sala tiene
// plazos (24 h sin foto, 48 h con la foto sin revisar, 48 h para preparar) y
// al vencer se dice por qué —si fue de la sala, no cuenta en contra—. En un
// pedido con productos bajo receta, el cliente puede QUITAR esos productos y
// seguir con lo demás; si la sala rechaza la receta, sólo se cancelan esos.
// Lo pagado en línea que no se entrega queda A FAVOR (arriba, con su
// vigencia, y en cada tarjeta). Un cobro de PRUEBA se dice como tal.
//
// Modo de prueba (2026-10-20): la cuenta de prueba puede ver reservas de
// MUESTRA, una en cada paso, y un saldo a favor de muestra (lib/demo.js). Se
// suman a las reales DESPUÉS de leerlas —no van a la pantalla bloqueada— y
// sus acciones no llaman al servidor: el cambio queda sólo en este teléfono.
//
// Pantalla bloqueada (2026-10-15, APAGADA el 2026-10-20 hasta que haya
// domicilio — ver ENCENDIDA en modules/reserva-viva): cada vez que se lee la lista, las reservas
// abiertas se ponen en la pantalla bloqueada (Live Activity en iPhone,
// notificación fija en Android) y las que terminaron se quitan — ver
// modules/reserva-viva. Sólo con «Todas» o «Abiertas»: son las lecturas que
// traen TODAS las abiertas; con otro filtro se darían por terminadas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Boton, Cargando, Pantalla, Seccion as SeccionUi, Tarjeta, Vacio } from '../componentes/ui';
import GrupoDeBotones from '../componentes/GrupoDeBotones';
import Icono from '../componentes/Icono';
import CodigoReserva from '../componentes/CodigoReserva';
import { Entrada, Latido } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { diaDelPlazo, dolares, fecha, quedaDelPlazo } from '../lib/formato';
import { suave, useTema } from '../tema/tema';
import { navegar } from '../lib/navegar';
import { useCuenta } from '../lib/cuenta';
import { subirReceta } from '../lib/fotos';
import { PISTA_RECETA, usarVistaPreviaFoto } from '../componentes/VistaPreviaFoto';
import { sinBloquear } from '../lib/bloqueo';
import { useVisible } from '../lib/visible';
import { sincronizarReservasVivas, vigilarReservasVivas } from '../modules/reserva-viva';
import { esDeMuestra, misReservasConDemo, useDemo } from '../lib/demo';
import { useModoPrueba } from '../lib/prueba';

// Colores del tema (cambian con el modo oscuro y se leen sobre el vidrio).
const ESTADO_BASE = {
  en_revision: { texto: 'En revisión de receta', tono: 'aviso' },
  pendiente: { texto: 'En preparación', tono: 'aviso' },
  lista: { texto: '¡Lista para retirar!', tono: 'exito' },
  retirada: { texto: 'Retirada', tono: 'neutro' },
  vencida: { texto: 'Venció sin retirar', tono: 'peligro' },
  cancelada: { texto: 'Cancelada', tono: 'neutro' },
};
const FONDOS = { aviso: 'rgba(255,159,10,0.18)', exito: 'rgba(52,199,89,0.2)', peligro: 'rgba(255,59,48,0.14)', neutro: 'rgba(120,110,130,0.16)' };
const estadoDe = (t, e) => {
  const b = ESTADO_BASE[e] ?? ESTADO_BASE.pendiente;
  const color = { aviso: t.color.avisoTexto, exito: t.color.exitoTexto, peligro: t.color.peligroTexto, neutro: colorSistema.texto2 }[b.tono];
  return { texto: b.texto, color, fondo: FONDOS[b.tono] };
};

// El plazo cuenta el día entero en que vence: ver `quedaDelPlazo` en lib/formato.

// Los filtros: la clave es la que entiende el servidor (`estado`).
const FILTROS = [['todas', 'Todas'], ['abiertas', 'Abiertas'], ['retiradas', 'Retiradas'], ['cerradas', 'Vencidas o canceladas']];
const ABIERTA = (r) => r.estado === 'en_revision' || r.estado === 'pendiente' || r.estado === 'lista';
const VACIO_FILTRO = {
  abiertas: 'No tienes reservas en preparación ni listas para retirar.',
  retiradas: 'Todavía no has retirado ninguna reserva.',
  cerradas: 'Ninguna reserva tuya venció ni se canceló.',
};
// «Todas» va sin parámetros: es la misma lectura que hacen el carrito y el pago
// (y la que queda guardada para cuando no hay conexión).
const datosDe = (filtro) => (filtro === 'todas' ? undefined : { estado: filtro });

// Las filas en grupos: un grupo por pedido del carrito (en el orden de su
// primera fila) y uno por cada reserva suelta. Se llama por separado para las
// abiertas y las terminadas: un renglón cancelado de un pedido abierto va con
// las terminadas.
function agruparPorPedido(filas) {
  const grupos = [];
  const porPedido = new Map();
  for (const r of filas) {
    if (!r.pedido) { grupos.push({ clave: `r:${r.id}`, pedido: null, filas: [r] }); continue; }
    let g = porPedido.get(r.pedido);
    if (!g) { g = { clave: `p:${r.pedido}`, pedido: r.pedido, filas: [] }; porPedido.set(r.pedido, g); grupos.push(g); }
    g.filas.push(r);
  }
  return grupos;
}
// Un pedido está listo cuando lo están todos sus productos: se retiran juntos.
const estadoDeGrupo = (g) => (g.filas.every((r) => r.estado === 'lista') ? 'lista' : 'pendiente');
// El pago del pedido: pagado si lo están todos; si no, el de la primera fila
// con anticipo, o pendiente.
// Un cobro de PRUEBA (2026-10-19) no es dinero: el pedido se paga en caja.
const pagoDeGrupo = (g) => (g.filas.every((r) => r.pago_estado === 'pagado')
  ? (g.filas.some((r) => r.pago_prueba) ? 'prueba' : 'pagado')
  : g.filas.find((r) => r.pago_estado && r.pago_estado !== 'pendiente' && r.pago_estado !== 'pagado')?.pago_estado ?? 'pendiente');
const pagoDeFila = (r) => (r.pago_estado === 'pagado' && r.pago_prueba ? 'prueba' : r.pago_estado);
// «13 horas», «menos de una hora»; null sin plazo. Para los plazos por hora
// (receta); los de «lista» vencen al terminar el día y usan `quedaDelPlazo`.
const horasQueQuedan = (iso, ahora = Date.now()) => {
  const fin = Date.parse(iso ?? '');
  if (!Number.isFinite(fin)) return null;
  const h = Math.floor((fin - ahora) / 3600_000);
  if (h < 1) return 'menos de una hora';
  return h === 1 ? '1 hora' : `${h} horas`;
};
const totalDeFila = (r) => Number(r.total ?? Number(r.precio_unitario ?? 0) * Number(r.cantidad ?? 1));

export default function Reservas() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [filtro, setFiltro] = useState('todas');
  const [porFiltro, setPorFiltro] = useState({});
  // Con el modo de prueba, las de muestra encima de las reales.
  const demo = useDemo();
  const d = useMemo(() => misReservasConDemo(porFiltro[filtro], demo, filtro), [porFiltro, filtro, demo]);
  const [ahora, setAhora] = useState(Date.now());
  const [refrescando, setRefrescando] = useState(false);
  const [encargos, setEncargos] = useState([]);
  const preRegistro = useCuenta((s) => !!s.resumen?.pendiente);
  // Desde el aviso «ya tienes una reserva» o el carrito: esa reserva va primero y marcada.
  const { resaltar } = useLocalSearchParams();
  const cargar = useCallback(() => Promise.all([
    pedir('mis_reservas', datosDe(filtro)).then((r) => {
      setPorFiltro((ant) => ({ ...ant, [filtro]: r?.ok || !ant[filtro]?.ok ? r : ant[filtro] }));
      // Lo guardado sin conexión no: podría quitar una que sigue abierta.
      if (r?.ok && !r.sinConexion && (filtro === 'todas' || filtro === 'abiertas')) sincronizarReservasVivas(r.reservas);
    }),
    pedir('mis_encargos').then((r) => { if (r?.ok) setEncargos(r.encargos); }),
  ]), [pedir, filtro]);
  // Ver más: desde la última reserva mostrada (cursor), se suma a la lista.
  const [masCargando, setMasCargando] = useState(false);
  const pidiendo = useRef(false);
  const cargarMas = useCallback(async () => {
    const actual = porFiltro[filtro];
    if (pidiendo.current || !actual?.ok || !actual.siguiente) return;
    pidiendo.current = true; setMasCargando(true);
    try {
      const r = await pedir('mis_reservas', { ...datosDe(filtro), antes: actual.siguiente });
      if (r?.ok) {
        setPorFiltro((ant) => {
          const previo = ant[filtro];
          // Si entretanto se recargó la lista, esta página ya no le corresponde.
          if (!previo?.ok || previo.siguiente !== actual.siguiente) return ant;
          const vistas = new Set(previo.reservas.map((x) => String(x.id)));
          return { ...ant, [filtro]: { ...previo, siguiente: r.siguiente, reservas: [...previo.reservas, ...r.reservas.filter((x) => !vistas.has(String(x.id)))] } };
        });
      }
    } finally { pidiendo.current = false; setMasCargando(false); }
  }, [pedir, filtro, porFiltro]);
  // Pagar el anticipo de un encargo confirmado (Wompi, como las reservas).
  // Con candado (2026-10-12): dos toques abrían dos cobros. La ref corta el
  // segundo toque al instante; el estado deshabilita el botón.
  const pagandoYa = useRef(false);
  const [pagandoEncargo, setPagandoEncargo] = useState(null);
  const pagarEncargo = async (e) => {
    if (pagandoYa.current) return;
    pagandoYa.current = true;
    setPagandoEncargo(e.id);
    try {
      const res = await pedir('pagar_encargo', { id: e.id });
      if (!res?.ok) { Alert.alert('No se pudo abrir el pago', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
      try {
        await sinBloquear(() => WebBrowser.openAuthSessionAsync(res.url, 'puntossalud://reservas'));
      } catch {
        Alert.alert('No se pudo abrir el pago', 'Intenta de nuevo en un momento.');
        return;
      }
      // El servidor dice si el cobro es de PRUEBA (2026-10-19): no se carga
      // dinero, así que se paga al retirar. Se avisa al volver de la hoja.
      if (res.prueba) Alert.alert('Cobro de prueba', 'Este cobro fue de prueba: no se cargó dinero. Pagas al retirar en la sucursal.');
      for (let i = 0; i < 4; i++) {
        const r = await pedir('mis_encargos');
        if (r?.ok) setEncargos(r.encargos);
        if (r?.encargos?.find((x) => x.id === e.id)?.pago_estado === 'pagado') { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); break; }
        await new Promise((ok) => setTimeout(ok, 1500));
      }
    } finally {
      pagandoYa.current = false;
      setPagandoEncargo(null);
    }
  };
  const cancelarEncargo = (e) => Alert.alert('Cancelar encargo', `¿Cancelar ${e.producto_nombre}?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar encargo', style: 'destructive', onPress: async () => {
      const res = await pedir('cancelar_encargo', { id: e.id });
      if (!res?.ok) Alert.alert('No se pudo cancelar', res?.mensaje ?? 'Revisa tu conexión.');
      cargar();
    } },
  ]);
  // Se recarga cada vez que la pantalla vuelve a verse (2026-10-15): al
  // enfocarla, al volver la app a primer plano y al cambiar de filtro. Antes
  // sólo al enfocarla: quien dejaba la app en segundo plano con una reserva
  // «en preparación» volvía y no veía que ya estaba lista.
  const visible = useVisible();
  useEffect(() => { if (visible) cargar(); }, [visible, cargar]);
  // Pone al día la pantalla bloqueada al volver a primer plano y con los
  // avisos de reserva, aunque después se salga de esta pantalla.
  useEffect(() => { vigilarReservasVivas({ alArrancar: false }); }, []);
  useFocusEffect(useCallback(() => { pedir('pago_preparar'); }, [pedir]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  // Las de muestra (modo de prueba): el cambio va a la memoria, nunca al servidor.
  const cambiarMuestra = (filas, cambio) => {
    useModoPrueba.getState().cambiarReservas(Object.fromEntries(filas.map((f) => [f.id, cambio])));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  const avisoMuestra = (texto) => Alert.alert('En el modo de prueba no se guarda', texto);
  const pagarMuestra = (r) => {
    const filas = r.pedido ? (d?.reservas ?? []).filter((x) => x.pedido === r.pedido && ABIERTA(x)) : [r];
    Alert.alert('En el modo de prueba no se cobra', 'No se abre la página de pago ni se carga dinero. ¿Ver cómo queda pagada en línea?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Ver pagada', onPress: () => cambiarMuestra(filas, { pago_estado: 'pagado', pago_metodo: 'en_linea', pagado_at: new Date().toISOString() }) },
    ]);
  };

  // Subir (otra) foto de la receta (2026-10-12): contra el primer renglón; el
  // servidor la anota en todo el pedido.
  const [subiendo, setSubiendo] = useState(null);
  const subiendoYa = useRef(false);
  // Antes de subirla se revisa en grande, con zoom (componentes/VistaPreviaFoto).
  const vistaPrevia = usarVistaPreviaFoto();
  const subirOtra = async (g) => {
    if (subiendoYa.current) return;
    const f = await vistaPrevia.elegir({
      titulo: 'Foto de tu receta', mensaje: 'Que se lean bien el nombre del medicamento, la firma y el sello del médico.', pista: PISTA_RECETA,
    });
    if (!f) return;
    if (esDeMuestra(g.filas[0])) {
      cambiarMuestra(g.filas, { receta_estado: 'pendiente', receta_motivo: null, receta_url: f.uri, receta_subida_at: new Date().toISOString() });
      avisoMuestra('La foto no se envía: queda sólo en este teléfono, como si la sucursal la estuviera revisando.');
      return;
    }
    subiendoYa.current = true;
    setSubiendo(g.clave);
    try {
      const r = await subirReceta(pedir, g.filas[0].id, f.uri);
      if (r.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Alert.alert('No se pudo enviar la receta', r.mensaje);
      await cargar();
    } finally {
      subiendoYa.current = false;
      setSubiendo(null);
    }
  };
  // Quitar lo bajo receta y seguir con lo demás (2026-10-19): la otra salida
  // de un pedido mixto, además de subir (otra) foto.
  const quitarReceta = (g) => {
    const conReceta = g.filas.filter((f) => f.bajo_receta).map((f) => f.producto_nombre);
    Alert.alert('Quitar los productos bajo receta', `Se quita ${conReceta.join(', ')} y lo demás del pedido sigue: lo pagas o lo retiras como siempre.`, [
      { text: 'No', style: 'cancel' },
      { text: 'Quitar y seguir', style: 'destructive', onPress: async () => {
        if (esDeMuestra(g.filas[0])) {
          const ahora = new Date().toISOString();
          const quedan = g.filas.filter((f) => !f.bajo_receta);
          const resto = Math.round(quedan.reduce((n, f) => n + totalDeFila(f), 0) * 100) / 100;
          cambiarMuestra(g.filas.filter((f) => f.bajo_receta), { estado: 'cancelada', cerrada_at: ahora });
          cambiarMuestra(quedan, { estado: 'pendiente', receta_estado: null, receta_motivo: null, total_pedido: resto });
          avisoMuestra('Se quitó lo bajo receta sólo en este teléfono; lo demás sigue en preparación.');
          return;
        }
        const res = await pedir('quitar_receta', { reserva_id: g.filas[0].id });
        if (res?.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        else Alert.alert('No se pudo quitar', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
        cargar();
        useCuenta.getState().cargar({ forzar: true }).catch(() => {});
      } },
    ]);
  };
  // El reloj de la cuenta regresiva corre SÓLO mientras alguien la ve
  // (2026-10-15): con la pantalla tapada o la app en segundo plano el
  // intervalo seguía despertando cada 30 s. Al volver se pone al día al
  // instante, sin esperar el siguiente tic.
  useEffect(() => {
    if (!visible) return undefined;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(id);
  }, [visible]);

  // Un pedido se cancela entero: cada renglón por su cuenta (la misma acción
  // del servidor, que sólo cancela los suyos, abiertos y sin pagar en línea).
  const cancelarPedido = (g) => Alert.alert('Cancelar pedido', `¿Cancelar el pedido ${g.pedido} completo (${g.filas.length} productos)?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar pedido', style: 'destructive', onPress: async () => {
      if (esDeMuestra(g.filas[0])) {
        cambiarMuestra(g.filas, { estado: 'cancelada', cerrada_at: new Date().toISOString() });
        avisoMuestra('El pedido se canceló sólo en este teléfono.');
        return;
      }
      const res = await Promise.all(g.filas.map((r) => pedir('cancelar_reserva', { id: r.id })));
      const fallidas = res.filter((x) => !x?.ok);
      if (!fallidas.length) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Alert.alert(fallidas.length === res.length ? 'No se pudo cancelar' : 'Se canceló sólo una parte del pedido',
        fallidas[0]?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      cargar();
      useCuenta.getState().cargar({ forzar: true }).catch(() => {});
    } },
  ]);
  const cancelar = (r) => Alert.alert('Cancelar reserva', `¿Cancelar ${r.producto_nombre}?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Cancelar reserva', style: 'destructive', onPress: async () => {
      if (esDeMuestra(r)) {
        cambiarMuestra([r], { estado: 'cancelada', cerrada_at: new Date().toISOString() });
        avisoMuestra('La reserva se canceló sólo en este teléfono.');
        return;
      }
      const res = await pedir('cancelar_reserva', { id: r.id });
      if (res?.ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Alert.alert('No se pudo cancelar', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      cargar();
      // El carrito y el aviso de duplicado leen las reservas del resumen.
      useCuenta.getState().cargar({ forzar: true }).catch(() => {});
    } },
  ]);

  // Pagar en línea (Wompi, 2026-10-07): el servidor arma el cobro con el total
  // de la reserva y la pantalla de Wompi se abre en una hoja sobre la app.
  // Al pagar, Wompi vuelve a `puntossalud://reservas` y la hoja se cierra
  // sola. Quien marca «pagado» es el servidor, nunca esta pantalla: acá sólo
  // se vuelve a leer, un par de veces, por si el aviso de Wompi se atrasa.
  const [pagando, setPagando] = useState(null);
  const pagar = async (r) => {
    if (esDeMuestra(r)) { pagarMuestra(r); return; }
    if (pagandoYa.current) return;
    pagandoYa.current = true;
    setPagando(r.id);
    try {
      const res = await pedir('pagar_reserva', { id: r.id });
      if (!res?.ok) { Alert.alert('No se pudo abrir el pago', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
      try {
        await sinBloquear(() => WebBrowser.openAuthSessionAsync(res.url, 'puntossalud://reservas'));
      } catch {
        Alert.alert('No se pudo abrir el pago', 'Intenta de nuevo en un momento.');
        return;
      }
      // El servidor dice si el cobro es de PRUEBA (2026-10-19): no se carga
      // dinero, así que se paga al retirar. Se avisa al volver de la hoja.
      if (res.prueba) Alert.alert('Cobro de prueba', 'Este cobro fue de prueba: no se cargó dinero. Pagas al retirar en la sucursal.');
      for (let i = 0; i < 4; i++) {
        const nuevo = await pedir('mis_reservas');
        if (nuevo?.reservas?.find((x) => x.id === r.id)?.pago_estado === 'pagado') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          break;
        }
        await new Promise((ok) => setTimeout(ok, 1500));
      }
      // Se recarga el filtro que se está viendo (desde su primera página).
      await cargar();
    } finally {
      pagandoYa.current = false;
      setPagando(null);
    }
  };

  // Android: botones conectados de Material 3 Expressive (2026-10-14).
  const chips = (
    <GrupoDeBotones opciones={FILTROS} valor={filtro} alCambiar={setFiltro} />
  );
  // Al cambiar de filtro los chips se quedan: sólo la lista muestra que carga.
  if (!d) return filtro === 'todas' ? <Cargando /> : <Pantalla conPestanas={false}>{chips}<ActivityIndicator style={{ marginTop: 24 }} /></Pantalla>;
  // Sin ficha todavía (2026-10-12): se explica en vez de «No se pudieron cargar».
  if (d.pendiente || (!d.ok && preRegistro)) {
    return <Pantalla conPestanas={false}><Vacio titulo="Sin reservas">Cuando completes tu registro en cualquier sucursal podrás reservar productos y verlos aquí.</Vacio></Pantalla>;
  }
  if (!d.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>{filtro === 'todas' ? null : chips}<Vacio titulo="No se pudieron cargar" accion="Reintentar" alAccion={refrescar}>{d.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio></Pantalla>;
  if (filtro === 'todas' && !d.reservas.length && !encargos.length) {
    return (
      <Pantalla conPestanas={false}>
        <Vacio titulo="Sin reservas">Aparta productos de las ofertas o del catálogo (desde el carrito) y pásalos a retirar sin hacer fila.</Vacio>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Presionable onPress={() => navegar('/ofertas')} accessibilityRole="button" style={{ padding: 12, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto }}>Ver ofertas</Text>
          </Presionable>
          <Presionable onPress={() => navegar('/catalogo')} accessibilityRole="button" style={{ padding: 12, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto }}>Ver catálogo</Text>
          </Presionable>
        </View>
      </Pantalla>
    );
  }
  // Primero lo que se puede retirar ya, después lo que se está preparando, y
  // abajo lo terminado. La reserva señalada (desde un aviso) va primero en su grupo.
  // Un pedido del carrito cuenta (y se muestra) como UNA tarjeta.
  const esResaltado = (g) => g.filas.some((r) => String(r.id) === String(resaltar));
  const primero = (a, b) => esResaltado(b) - esResaltado(a);
  const todosAbiertos = agruparPorPedido(d.reservas.filter(ABIERTA));
  // Con receta en revisión, el grupo entero espera (todo el pedido).
  const enRevision = todosAbiertos.filter((g) => g.filas.some((r) => r.estado === 'en_revision')).sort(primero);
  const gruposAbiertos = todosAbiertos.filter((g) => !g.filas.some((r) => r.estado === 'en_revision'));
  const listas = gruposAbiertos.filter((g) => estadoDeGrupo(g) === 'lista').sort(primero);
  const preparando = gruposAbiertos.filter((g) => estadoDeGrupo(g) === 'pendiente').sort(primero);
  const abiertas = [...enRevision, ...listas, ...preparando];
  const cerradas = agruparPorPedido(d.reservas.filter((r) => !ABIERTA(r)));
  const tarjeta = (g, i) => {
    const r = g.filas[0];
    return (
      <Entrada key={`a:${g.clave}`} indice={Math.min(i, 8)}>
        {g.filas.length > 1 ? (
          <PedidoAbierto g={g} ahora={ahora} alCancelar={() => cancelarPedido(g)} alPagar={() => pagar(r)} pagando={pagando === r.id} resaltada={esResaltado(g)} />
        ) : (
          <ReservaAbierta r={r} ahora={ahora} alCancelar={() => cancelar(r)} alPagar={() => pagar(r)} pagando={pagando === r.id} resaltada={esResaltado(g)} />
        )}
      </Entrada>
    );
  };
  return (
    <Pantalla sinVidrio conPestanas={false} alRefrescar={refrescar} refrescando={refrescando} alFinal={d.siguiente ? cargarMas : undefined}>
      {chips}
      {vistaPrevia.vista}
      {filtro === 'todas' && encargos.length ? (
        <>
          <SeccionUi>Encargos</SeccionUi>
          {encargos.map((e) => <Encargo key={e.id} e={e} alPagar={() => pagarEncargo(e)} pagando={pagandoEncargo === e.id} alCancelar={() => cancelarEncargo(e)} />)}
        </>
      ) : null}
      {d.saldo_a_favor?.total > 0 ? <ResumenSaldo s={d.saldo_a_favor} /> : null}
      {filtro !== 'todas' && !d.reservas.length ? <Vacio titulo="Nada por aquí">{VACIO_FILTRO[filtro]}</Vacio> : null}
      {abiertas.length ? <ResumenReservas listas={listas.length} preparando={preparando.length + enRevision.length} /> : null}
      {enRevision.length ? <Seccion texto="Receta en revisión" n={enRevision.length} /> : null}
      {enRevision.map((g, i) => (
        <Entrada key={`v:${g.clave}`} indice={Math.min(i, 8)}>
          <EnRevision g={g} resaltada={esResaltado(g)} alSubir={() => subirOtra(g)} subiendo={subiendo === g.clave}
            alQuitarReceta={() => quitarReceta(g)}
            alCancelar={() => (g.filas.length > 1 ? cancelarPedido(g) : cancelar(g.filas[0]))} />
        </Entrada>
      ))}
      {listas.length ? <Seccion texto="Listas para retirar" n={listas.length} /> : null}
      {listas.map((g, i) => tarjeta(g, enRevision.length + i))}
      {preparando.length ? <Seccion texto="En preparación" n={preparando.length} /> : null}
      {preparando.map((g, i) => tarjeta(g, enRevision.length + listas.length + i))}
      {cerradas.length && filtro === 'todas' ? <Seccion texto="Anteriores" /> : null}
      {cerradas.map((g, i) => (
        <Entrada key={`c:${g.clave}`} indice={Math.min(abiertas.length + i, 8)}>
          {g.filas.length > 1 ? <PedidoCerrado g={g} /> : <ReservaCerrada r={g.filas[0]} />}
        </Entrada>
      ))}
      {d.siguiente ? (
        <Presionable onPress={cargarMas} disabled={masCargando} accessibilityRole="button"
          style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, minHeight: 44, borderRadius: 999, opacity: pressed ? 0.6 : 1 })}>
          {masCargando ? <ActivityIndicator /> : null}
          <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>{masCargando ? 'Cargando más…' : 'Ver más reservas'}</Text>
        </Presionable>
      ) : null}
    </Pantalla>
  );
}

// El rótulo de un grupo, con cuántas lleva (el de componentes/ui, 2026-10-13).
function Seccion({ texto, n }) {
  return <SeccionUi n={n} estilo={{ marginTop: 8 }}>{texto}</SeccionUi>;
}

// Arriba de todo, de un vistazo: cuántas se pueden retirar ya y cuántas faltan.
function ResumenReservas({ listas, preparando }) {
  const t = useTema();
  const caja = (n, texto, color, fondo) => (
    <View style={{ flex: 1, borderRadius: 18, padding: 14, gap: 2, backgroundColor: fondo }}>
      <Text style={{ fontSize: 28, fontWeight: '900', color, fontVariant: ['tabular-nums'] }}>{n}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2 }}>{texto}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {caja(listas, listas === 1 ? 'Lista para retirar' : 'Listas para retirar', listas ? t.color.exitoTexto : colorSistema.texto3, listas ? FONDOS.exito : FONDOS.neutro)}
      {caja(preparando, 'En preparación', preparando ? t.color.avisoTexto : colorSistema.texto3, preparando ? FONDOS.aviso : FONDOS.neutro)}
    </View>
  );
}

// Promoción o producto normal, cómo se paga y cómo se entrega (2026-10-06).
const PAGO = {
  pendiente: { texto: 'Pendiente de pago', tono: 'aviso', sf: 'clock' },
  anticipo: { texto: 'Anticipo pagado', tono: 'aviso', sf: 'circle.lefthalf.filled' },
  pagado: { texto: 'Pagado', tono: 'exito', sf: 'checkmark.seal.fill' },
  prueba: { texto: 'Cobro de prueba · pagas al retirar', tono: 'aviso', sf: 'exclamationmark.triangle.fill' },
  devuelto: { texto: 'Devuelto', tono: 'neutro', sf: 'arrow.uturn.backward' },
};
const METODO = {
  al_retirar: 'En caja, al retirar', efectivo: 'Efectivo', tarjeta: 'Tarjeta',
  en_linea: 'En línea', transferencia: 'Transferencia',
};
const tonoColor = (t, tono) => ({ aviso: t.color.avisoTexto, exito: t.color.exitoTexto, peligro: t.color.peligroTexto, neutro: colorSistema.texto2 }[tono]);
const fechaHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  // El día en la hora del teléfono (no el de UTC: de noche ya sería mañana).
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fecha(dia)}, ${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const mapa = (r) => {
  const q = encodeURIComponent(`Farmacia ${r.sala}, ${r.sala_direccion ?? ''}, El Salvador`);
  return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
};

// Promoción (con el nombre de la oferta) o producto a precio normal.
function Tipo({ r }) {
  const t = useTema();
  const promo = r.tipo === 'promocion';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
      backgroundColor: promo ? suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)') }}>
      <Icono sf={promo ? 'tag.fill' : 'shippingbox.fill'} respaldo="" tam={11} color={promo ? t.color.magentaTexto : colorSistema.texto2} />
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: promo ? t.color.magentaTexto : colorSistema.texto2 }}>
        {promo ? 'Promoción' : 'Producto'}
      </Text>
    </View>
  );
}

// Un renglón de datos: ícono, rótulo, valor y, si hace falta, una acción.
function Dato({ sf, rotulo, valor, detalle, color, accion }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
        <Icono sf={sf} respaldo="•" tam={15} color={color ?? colorSistema.texto2} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{rotulo}</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: color ?? colorSistema.texto }}>{valor}</Text>
        {detalle ? <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{detalle}</Text> : null}
      </View>
      {accion ? (
        <Presionable onPress={accion.alTocar} hitSlop={8} accessibilityRole="button" accessibilityLabel={accion.texto}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>{accion.texto}</Text>
        </Presionable>
      ) : null}
    </View>
  );
}

const Separador = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 42 }} />;

// Una reserva en curso: qué es (promoción o producto), en qué paso va
// (Recibida → Lista → Retirada), cómo se entrega, cómo se paga y cuánto.
function ReservaAbierta({ r, ahora, alCancelar, alPagar, pagando, resaltada = false, productosDelPedido = 1 }) {
  const t = useTema();
  const lista = r.estado === 'lista';
  const e = estadoDe(t, r.estado);
  const pago = PAGO[pagoDeFila(r)] ?? PAGO.pendiente;
  const domicilio = r.entrega === 'domicilio';
  const ahorro = r.precio_normal != null && r.precio_unitario != null && r.precio_normal > r.precio_unitario
    ? (r.precio_normal - r.precio_unitario) * r.cantidad : 0;
  // El código para retirar (2026-10-07): el del pedido del carrito o el de la
  // reserva. En la sucursal lo escanean para encontrarla, prepararla y facturarla.
  const [verCodigo, setVerCodigo] = useState(lista);
  const codigo = r.pedido ?? r.codigo;
  return (
    <Tarjeta tono={lista ? t.color.verde : resaltada ? t.color.magenta : undefined} estilo={{ gap: 14 }}>
      {resaltada ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono sf="arrow.down.circle.fill" respaldo="↓" tam={14} color={t.color.magentaTexto} />
          <Text style={{ fontSize: 13, fontWeight: '800', color: t.color.magentaTexto }}>Esta es la reserva de ese producto</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {lista ? <Latido><Pildora e={e} /></Latido> : <Pildora e={e} />}
          <Tipo r={r} />
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{r.codigo}</Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{r.producto_nombre}</Text>
        {r.tipo === 'promocion' && r.oferta_titulo ? (
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.color.magentaTexto }} numberOfLines={1}>{r.oferta_titulo}</Text>
        ) : null}
        {r.pedido && productosDelPedido > 1 ? (
          <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>
            Parte del pedido {r.pedido} · {productosDelPedido} productos que se retiran juntos
          </Text>
        ) : null}
      </View>

      {/* Los pasos: dónde va la reserva. */}
      <Pasos lista={lista} />

      {lista && r.vence_at ? (
        <CuentaRegresiva vence={r.vence_at} ahora={ahora} domicilio={domicilio} />
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          La sucursal la está preparando. Te avisamos cuando esté lista{r.oferta_fin ? `; la oferta vale hasta el ${fecha(r.oferta_fin)}` : ''}.
        </Text>
      )}

      <View>
        {domicilio ? (
          <Dato sf="house.fill" rotulo="Entrega" valor="A domicilio" detalle={r.direccion_entrega} />
        ) : (
          <Dato sf="storefront.fill" rotulo="Retiro en sucursal" valor={r.sala ?? 'Sucursal'} detalle={r.sala_direccion}
            accion={r.sala ? { texto: 'Cómo llegar', alTocar: () => Linking.openURL(mapa(r)).catch(() => {}) } : null} />
        )}
        <Separador />
        <Dato sf={pago.sf} rotulo="Pago" valor={pago.texto} color={tonoColor(t, pago.tono)}
          detalle={`${METODO[r.pago_metodo] ?? 'En caja, al retirar'}${r.pago_estado === 'anticipo' && r.anticipo ? ` · anticipo ${dolares(r.anticipo)}` : ''}${r.pagado_at ? ` · ${fechaHora(r.pagado_at)}` : ''}`} />
        <Separador />
        <Dato sf="calendar" rotulo="Reservada" valor={fechaHora(r.created_at)} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
        paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>
            {r.cantidad} {r.cantidad === 1 ? 'UNIDAD' : 'UNIDADES'}{r.precio_unitario != null ? ` × ${dolares(r.precio_unitario)}` : ''}
          </Text>
          {ahorro > 0 ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Ahorras {dolares(ahorro)}</Text> : null}
        </View>
        {r.precio_unitario != null ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>{r.pago_estado === 'pagado' ? 'PAGASTE' : 'TOTAL'}</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(r.total ?? r.precio_unitario * r.cantidad)}</Text>
          </View>
        ) : null}
      </View>

      {/* Lo pagado de una reserva cerrada queda a favor 60 días (2026-10-20, `saldo_favor_dias`). */}
      <SaldoAFavor r={r} />
      {r.pago_estado === 'pendiente' && Number(r.total) > 0 ? (
        <View style={{ gap: 6 }}>
          {/* Un pedido del carrito se cobra entero: sus productos + el envío. */}
          <Boton alTocar={alPagar} cargando={pagando}>{r.total_pedido != null
            ? `Pagar el pedido ${dolares(r.total_pedido)}${Number(r.costo_envio) > 0 ? ' (con envío)' : ''}`
            : `Pagar en línea ${dolares(r.total)}`}</Boton>
          <Text style={{ fontSize: 12, textAlign: 'center', color: colorSistema.texto3 }}>
            O paga al retirar, en la sucursal. Pagada en línea tienes 7 días para retirarla.
          </Text>
        </View>
      ) : null}

      {/* El código para retirar: se muestra solo cuando está lista. */}
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVerCodigo((x) => !x); }} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icono sf="qrcode" respaldo="" tam={16} color={colorSistema.texto} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{r.pedido ? `Pedido ${r.pedido}` : `Código ${r.codigo}`}</Text>
        </View>
        <Icono sf={verCodigo ? 'chevron.up' : 'chevron.down'} respaldo="" tam={12} color={colorSistema.texto3} />
      </Presionable>
      {/* Compartir (2026-10-09): si no puede ir, se lo pasa a otra persona. A domicilio no aplica. */}
      {verCodigo ? (
        <CodigoReserva codigo={codigo} tam={140} compartir={domicilio ? null : {
          ...(r.pedido && productosDelPedido > 1
            ? { producto: `${productosDelPedido} productos (${r.producto_nombre} y más)` }
            : { productos: [{ nombre: r.producto_nombre, cantidad: r.cantidad }] }),
          sala: r.sala, pedido: !!r.pedido,
          // La tarjeta que se comparte (2026-10-14): total, plazo y si lleva receta.
          total: r.total_pedido ?? r.total ?? (r.precio_unitario != null ? r.precio_unitario * r.cantidad : null),
          pagado: r.pago_estado === 'pagado', vence: lista ? r.vence_at : null, receta: r.receta_estado != null,
        }} />
      ) : null}

      {/* Con anticipo, o apartada en la sucursal, la cancela la sucursal (2026-10-21):
          ahí el anticipo queda a favor. Desde la app se perdía sin rastro. */}
      {r.pago_estado === 'pagado' || Number(r.anticipo) > 0 || r.origen === 'sucursal' ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
          {r.pago_estado === 'pagado' ? (r.pago_prueba ? 'El cobro en línea fue de prueba: pagas al retirar.' : 'Ya está pagada.')
            : Number(r.anticipo) > 0 ? `Dejaste ${dolares(r.anticipo)} de anticipo.` : 'La apartaste en la sucursal.'} Para cancelarla, escríbele a la sucursal.
        </Text>
      ) : (
        <Presionable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar reserva</Text>
        </Presionable>
      )}
    </Tarjeta>
  );
}

// Los pasos: Recibida → Lista → Retirada.
function Pasos({ lista }) {
  const t = useTema();
  const pasos = ['Recibida', 'Lista', 'Retirada'];
  const actual = lista ? 1 : 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {pasos.map((p, i) => (
        <View key={p} style={{ flex: i < pasos.length - 1 ? 1 : 0, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
              backgroundColor: i <= actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }}>
              {i <= actual ? <Icono sf="checkmark" respaldo="✓" tam={11} color="#FFFFFF" /> : null}
            </View>
            <Text style={{ fontSize: 11, fontWeight: i === actual ? '800' : '600', color: i <= actual ? colorSistema.texto : colorSistema.texto3 }}>{p}</Text>
          </View>
          {i < pasos.length - 1 ? (
            <View style={{ flex: 1, height: 2, marginHorizontal: 6, marginBottom: 16, borderRadius: 1,
              backgroundColor: i < actual ? (lista ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

// El plazo para retirar: cuánto queda y hasta qué día (todo el día).
function CuentaRegresiva({ vence, ahora, domicilio }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, padding: 12, backgroundColor: 'rgba(52,199,89,0.16)' }}>
      <Icono sf="timer" respaldo="⏱" tam={16} color={t.color.exitoTexto} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.exitoTexto }}>
          Lista para {domicilio ? 'entregar' : 'retirar'}: {quedaDelPlazo(vence, ahora)}
        </Text>
        <Text style={{ fontSize: 12, color: colorSistema.texto2 }}>Puedes {domicilio ? 'recibirla' : 'retirarla'} hasta {diaDelPlazo(vence, ahora)}, todo el día</Text>
      </View>
    </View>
  );
}

// Un pedido del carrito en curso (2026-10-09): UNA tarjeta con sus productos
// (nombre, cantidad, precio), el total con el envío, un solo código y un solo
// pagar / compartir / cancelar. La sucursal, la entrega y la fecha son las del
// pedido (el carrito las elige una vez para todos sus renglones).
function PedidoAbierto({ g, ahora, alCancelar, alPagar, pagando, resaltada = false }) {
  const t = useTema();
  const r = g.filas[0];
  const estado = estadoDeGrupo(g);
  const lista = estado === 'lista';
  const e = estadoDe(t, estado);
  const pagoClave = pagoDeGrupo(g);
  const pago = PAGO[pagoClave] ?? PAGO.pendiente;
  const algunaPagada = g.filas.some((f) => f.pago_estado === 'pagado');
  const domicilio = r.entrega === 'domicilio';
  const unidades = g.filas.reduce((n, f) => n + Number(f.cantidad ?? 1), 0);
  const subtotal = g.filas.reduce((n, f) => n + totalDeFila(f), 0);
  const envio = Math.max(0, ...g.filas.map((f) => Number(f.costo_envio ?? 0)));
  // El total lo calcula el servidor (renglones abiertos + envío una vez); si
  // no viniera, la misma cuenta acá.
  const total = r.total_pedido ?? Math.round((subtotal + envio) * 100) / 100;
  const ahorro = g.filas.reduce((n, f) => n + (f.precio_normal != null && f.precio_unitario != null && f.precio_normal > f.precio_unitario
    ? (f.precio_normal - f.precio_unitario) * f.cantidad : 0), 0);
  const venceLista = lista ? g.filas.map((f) => f.vence_at).filter(Boolean).sort()[0] : null;
  const anticipo = g.filas.reduce((n, f) => n + Number(f.anticipo ?? 0), 0);
  const pagadoAt = g.filas.map((f) => f.pagado_at).filter(Boolean).sort().pop();
  const [verCodigo, setVerCodigo] = useState(lista);
  return (
    <Tarjeta tono={lista ? t.color.verde : resaltada ? t.color.magenta : undefined} estilo={{ gap: 14 }}>
      {resaltada ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono sf="arrow.down.circle.fill" respaldo="↓" tam={14} color={t.color.magentaTexto} />
          <Text style={{ fontSize: 13, fontWeight: '800', color: t.color.magentaTexto }}>Ese producto va en este pedido</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {lista ? <Latido><Pildora e={e} /></Latido> : <Pildora e={e} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }}>
            <Icono sf="cart.fill" respaldo="" tam={11} color={colorSistema.texto2} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: colorSistema.texto2 }}>Pedido</Text>
          </View>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{g.pedido}</Text>
      </View>

      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>
          {g.filas.length} productos
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>
          {unidades} {unidades === 1 ? 'unidad' : 'unidades'} · se {domicilio ? 'entregan' : 'retiran'} juntos
        </Text>
      </View>

      {/* Los productos del pedido. */}
      <View style={{ borderRadius: 16, paddingHorizontal: 12, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' }}>
        {g.filas.map((f, i) => (
          <View key={f.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10,
            borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <Text style={{ minWidth: 26, fontSize: 15, fontWeight: '800', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{f.cantidad}×</Text>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{f.producto_nombre}</Text>
              {f.tipo === 'promocion' && f.oferta_titulo ? (
                <Text style={{ fontSize: 12, fontWeight: '600', color: t.color.magentaTexto }} numberOfLines={1}>{f.oferta_titulo}</Text>
              ) : null}
              {f.precio_unitario != null ? (
                <Text style={{ fontSize: 12, color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{dolares(f.precio_unitario)} c/u</Text>
              ) : null}
            </View>
            {f.precio_unitario != null ? (
              <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(totalDeFila(f))}</Text>
            ) : null}
          </View>
        ))}
      </View>

      <Pasos lista={lista} />

      {lista && venceLista ? (
        <CuentaRegresiva vence={venceLista} ahora={ahora} domicilio={domicilio} />
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          La sucursal está preparando tu pedido. Te avisamos cuando esté listo.
        </Text>
      )}

      <View>
        {domicilio ? (
          <Dato sf="house.fill" rotulo="Entrega" valor="A domicilio" detalle={r.direccion_entrega} />
        ) : (
          <Dato sf="storefront.fill" rotulo="Retiro en sucursal" valor={r.sala ?? 'Sucursal'} detalle={r.sala_direccion}
            accion={r.sala ? { texto: 'Cómo llegar', alTocar: () => Linking.openURL(mapa(r)).catch(() => {}) } : null} />
        )}
        <Separador />
        <Dato sf={pago.sf} rotulo="Pago" valor={pago.texto} color={tonoColor(t, pago.tono)}
          detalle={`${METODO[r.pago_metodo] ?? 'En caja, al retirar'}${pagoClave === 'anticipo' && anticipo ? ` · anticipo ${dolares(anticipo)}` : ''}${pagadoAt ? ` · ${fechaHora(pagadoAt)}` : ''}`} />
        <Separador />
        <Dato sf="calendar" rotulo="Pedido el" valor={fechaHora(r.created_at)} />
      </View>

      <View style={{ gap: 4, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
        {envio > 0 ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Productos</Text>
              <Text style={{ fontSize: 13, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Envío</Text>
              <Text style={{ fontSize: 13, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(envio)}</Text>
            </View>
          </>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          {ahorro > 0 ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Ahorras {dolares(ahorro)}</Text> : <View />}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>{pagoClave === 'pagado' ? 'PAGASTE' : 'TOTAL'}</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(total)}</Text>
          </View>
        </View>
      </View>

      {g.filas.map((f) => <SaldoAFavor key={f.id} r={f} />)}
      {pagoClave === 'pendiente' && !algunaPagada && Number(total) > 0 ? (
        <View style={{ gap: 6 }}>
          <Boton alTocar={alPagar} cargando={pagando}>{`Pagar el pedido ${dolares(total)}${envio > 0 ? ' (con envío)' : ''}`}</Boton>
          <Text style={{ fontSize: 12, textAlign: 'center', color: colorSistema.texto3 }}>
            O paga al retirar, en la sucursal. Pagado en línea tienes 7 días para retirarlo.
          </Text>
        </View>
      ) : null}

      {/* Un solo código para todo el pedido. */}
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVerCodigo((x) => !x); }} accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icono sf="qrcode" respaldo="" tam={16} color={colorSistema.texto} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>Pedido {g.pedido}</Text>
        </View>
        <Icono sf={verCodigo ? 'chevron.up' : 'chevron.down'} respaldo="" tam={12} color={colorSistema.texto3} />
      </Presionable>
      {verCodigo ? (
        <CodigoReserva codigo={g.pedido} tam={140} compartir={domicilio ? null : {
          productos: g.filas.map((f) => ({ nombre: f.producto_nombre, cantidad: f.cantidad })), sala: r.sala, pedido: true,
          total, pagado: pagoClave === 'pagado', vence: venceLista, receta: g.filas.some((f) => f.receta_estado != null),
        }} />
      ) : null}

      {algunaPagada ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
          {pagoClave === 'prueba' ? 'El cobro en línea fue de prueba: pagas al retirar.' : 'Ya está pagado.'} Para cancelarlo, escríbele a la sucursal.
        </Text>
      ) : (
        <Presionable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar pedido</Text>
        </Presionable>
      )}
    </Tarjeta>
  );
}

// Un pedido terminado: compacto, con sus productos debajo. Si sus renglones
// terminaron distinto (uno cancelado y el resto retirado), cada uno dice el suyo.
function PedidoCerrado({ g }) {
  const t = useTema();
  const r = g.filas[0];
  const mismoEstado = g.filas.every((f) => f.estado === r.estado);
  const e = estadoDe(t, mismoEstado ? r.estado : 'retirada');
  const retirada = g.filas.some((f) => f.estado === 'retirada');
  const pagoClave = pagoDeGrupo(g);
  const pago = PAGO[pagoClave] ?? PAGO.pendiente;
  const total = g.filas.reduce((n, f) => n + (f.precio_unitario != null ? totalDeFila(f) : 0), 0);
  const cerrada = g.filas.map((f) => f.cerrada_at ?? f.created_at).filter(Boolean).sort().pop();
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icono sf={retirada ? 'checkmark.circle.fill' : 'xmark.circle'} respaldo="•" tam={24} color={e.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>Pedido de {g.filas.length} productos</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto3 }} numberOfLines={1}>
            {mismoEstado ? `${e.texto} · ` : ''}{r.entrega === 'domicilio' ? 'A domicilio' : r.sala} · {fechaHora(cerrada)}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>Pedido {g.pedido}</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(total)}</Text>
      </View>
      <View style={{ marginLeft: 36, gap: 4 }}>
        {g.filas.map((f) => (
          <View key={f.id} style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colorSistema.texto2 }} numberOfLines={1}>
              {f.cantidad} × {f.producto_nombre}{mismoEstado ? '' : ` · ${estadoDe(t, f.estado).texto}`}
            </Text>
            {f.precio_unitario != null ? (
              <Text style={{ fontSize: 13, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(totalDeFila(f))}</Text>
            ) : null}
          </View>
        ))}
      </View>
      {retirada || pagoClave !== 'pendiente' ? (
        <View style={{ flexDirection: 'row', gap: 6, marginLeft: 36, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: FONDOS[pago.tono] }}>
            <Icono sf={pago.sf} respaldo="" tam={11} color={tonoColor(t, pago.tono)} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: tonoColor(t, pago.tono) }}>{pago.texto}</Text>
          </View>
        </View>
      ) : null}
      <Rechazada r={g.filas.find((f) => f.receta_estado === 'rechazada')} />
      <MotivoVencida r={g.filas.find((f) => f.estado === 'vencida')} />
      {g.filas.map((f) => <SaldoAFavor key={f.id} r={f} />)}
    </Tarjeta>
  );
}

// Una reserva terminada: compacta, con lo que importa después.
function ReservaCerrada({ r }) {
  const t = useTema();
  const e = estadoDe(t, r.estado);
  const pago = PAGO[pagoDeFila(r)] ?? PAGO.pendiente;
  const retirada = r.estado === 'retirada';
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icono sf={retirada ? 'checkmark.circle.fill' : 'xmark.circle'} respaldo="•" tam={24} color={e.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>{r.cantidad} × {r.producto_nombre}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto3 }} numberOfLines={1}>
            {e.texto} · {r.entrega === 'domicilio' ? 'A domicilio' : r.sala} · {fechaHora(r.cerrada_at ?? r.created_at)}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{r.pedido ? `Pedido ${r.pedido}` : `Código ${r.codigo}`}</Text>
        </View>
        {r.precio_unitario != null ? (
          <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(r.total ?? r.precio_unitario * r.cantidad)}</Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginLeft: 36, flexWrap: 'wrap' }}>
        <Tipo r={r} />
        {retirada || r.pago_estado !== 'pendiente' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: FONDOS[pago.tono] }}>
            <Icono sf={pago.sf} respaldo="" tam={11} color={tonoColor(t, pago.tono)} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: tonoColor(t, pago.tono) }}>{pago.texto}</Text>
          </View>
        ) : null}
      </View>
      <Rechazada r={r.receta_estado === 'rechazada' ? r : null} />
      <MotivoVencida r={r} />
      {/* Lo pagado de una vencida queda a favor 60 días: se ve también acá, que es donde vive la vencida. */}
      <SaldoAFavor r={r} />
    </Tarjeta>
  );
}

// La receta rechazada (2026-10-12): la reserva se canceló por eso, y el motivo
// lo escribió la sucursal.
function Rechazada({ r }) {
  const t = useTema();
  if (!r) return null;
  return (
    <View style={{ borderRadius: 14, padding: 12, gap: 2, backgroundColor: FONDOS.peligro }}>
      <Text style={{ fontSize: 14, fontWeight: '800', color: t.color.peligroTexto }}>Receta rechazada{r.receta_motivo ? `: ${r.receta_motivo}` : ''}</Text>
      {r.pedido ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Se quitó sólo lo bajo receta: si tu pedido tenía otros productos, siguen en preparación.</Text> : null}
      <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Si tienes dudas, escríbenos desde «Pregúntale a la farmacia».</Text>
    </View>
  );
}

// Una reserva o un pedido con la receta en revisión (2026-10-12). Sin código
// para retirar y sin pagar: la sucursal todavía la puede rechazar.
function EnRevision({ g, resaltada, alSubir, subiendo, alCancelar, alQuitarReceta }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const r = g.filas[0];
  const [verFoto, setVerFoto] = useState(false);
  const estado = r.receta_estado; // null (falta la foto) · 'pendiente' · 'otra_foto'
  const pide = estado == null || estado === 'otra_foto';
  const e = estadoDe(t, 'en_revision');
  const pildora = estado === 'otra_foto' ? { ...e, texto: 'Necesitamos otra foto' } : estado == null ? { ...e, texto: 'Falta la foto de tu receta' } : e;
  const domicilio = r.entrega === 'domicilio';
  const total = r.total_pedido ?? g.filas.reduce((n, f) => n + totalDeFila(f), 0);
  // Pedido mixto: hay productos sin receta que pueden seguir solos.
  const mixto = g.filas.some((f) => f.bajo_receta) && g.filas.some((f) => !f.bajo_receta);
  // El plazo lo dice el servidor (`plazo_hasta`, de `reserva_plazo_hasta`),
  // no un número escrito acá (2026-10-21).
  const quedan = horasQueQuedan(r.plazo_hasta);
  const plazo = estado === 'pendiente'
    ? `La sucursal tiene ${quedan ?? 'un plazo'} para revisarla. Si no alcanza, la reserva vence y no cuenta en tu contra.`
    : estado === 'otra_foto'
      ? `Tienes ${quedan ?? 'un plazo corto'} para mandar la otra foto; si no, la reserva vence.`
      : `Tienes ${quedan ?? 'un plazo corto'} para subirla; si no, la reserva vence.`;
  return (
    <Tarjeta tono={resaltada ? t.color.magenta : undefined} estilo={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {pide ? <Latido><Pildora e={pildora} /></Latido> : <Pildora e={pildora} />}
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{g.pedido ?? r.codigo}</Text>
      </View>
      <View style={{ gap: 4 }}>
        {g.filas.map((f) => (
          <Text key={f.id} style={{ fontSize: g.filas.length > 1 ? 15 : 20, fontWeight: '800', color: colorSistema.texto }}>
            {g.filas.length > 1 ? `${f.cantidad} × ` : ''}{f.producto_nombre}{mixto && f.bajo_receta ? ' · bajo receta' : ''}
          </Text>
        ))}
      </View>
      {estado === 'otra_foto' ? (
        <View style={{ borderRadius: 14, padding: 12, gap: 4, backgroundColor: FONDOS.aviso }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: t.color.avisoTexto }}>La sucursal necesita otra foto de tu receta</Text>
          {r.receta_motivo ? <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto }}>«{r.receta_motivo}»</Text> : null}
        </View>
      ) : (
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          {estado == null
            ? 'Sube la foto de tu receta para que la sucursal pueda revisarla y confirmar tu reserva.'
            : `${r.sala ?? 'La sucursal'} está revisando tu receta. Cuando la apruebe te avisamos, y ahí ya puedes pagarla y retirarla.`}
        </Text>
      )}
      <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto3 }}>{plazo}</Text>
      {pide ? (
        <Boton alTocar={alSubir} cargando={subiendo}>{estado == null ? 'Subir la foto de mi receta' : 'Subir otra foto'}</Boton>
      ) : null}
      {/* La otra salida (2026-10-19): quitar lo bajo receta y seguir con lo demás. */}
      {mixto ? (
        <Presionable onPress={alQuitarReceta} hitSlop={8} accessibilityRole="button"
          style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: t.color.magentaTexto }}>Quitar lo bajo receta y seguir con lo demás</Text>
        </Presionable>
      ) : null}
      <View>
        {r.receta_url ? (
          <>
            <Dato sf="doc.text.image" rotulo="Tu receta" valor={r.receta_subida_at ? `Enviada ${fechaHora(r.receta_subida_at)}` : 'Enviada'}
              accion={{ texto: 'Ver', alTocar: () => setVerFoto(true) }} />
            <Separador />
          </>
        ) : null}
        {domicilio ? (
          <Dato sf="house.fill" rotulo="Entrega" valor="A domicilio" detalle={r.direccion_entrega} />
        ) : (
          <Dato sf="storefront.fill" rotulo="Retiro en sucursal" valor={r.sala ?? 'Sucursal'} detalle={r.sala_direccion} />
        )}
        <Separador />
        <Dato sf="clock" rotulo="Pago" valor="Después de la revisión" detalle="No se cobra nada hasta que la sucursal apruebe tu receta." />
      </View>
      {r.precio_unitario != null ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto3 }}>TOTAL</Text>
          <Text style={{ fontSize: 22, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(total)}</Text>
        </View>
      ) : null}
      <Presionable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>{g.filas.length > 1 ? 'Cancelar pedido' : 'Cancelar reserva'}</Text>
      </Presionable>
      <Modal visible={verFoto} animationType="fade" presentationStyle="overFullScreen" transparent onRequestClose={() => setVerFoto(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', paddingTop: ins.top + 12, paddingBottom: ins.bottom + 12 }}>
          <Presionable onPress={() => setVerFoto(false)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}
            style={{ alignSelf: 'flex-end', paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>Cerrar</Text>
          </Presionable>
          {r.receta_url ? <Image source={{ uri: r.receta_url }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Foto de tu receta" /> : null}
        </View>
      </Modal>
    </Tarjeta>
  );
}

// El saldo a favor de un renglón (2026-10-08; desde el 2026-10-19 también lo
// pagado en línea que no se entregó). Vale en cualquier sucursal: se muestra
// el código en caja.
const ORIGEN_SALDO = {
  anticipo: 'Tu anticipo',
  pago_en_linea: 'Lo que pagaste en línea',
  pago_tardio: 'Tu pago llegó con la reserva ya cerrada, y',
  pago_duplicado: 'Pagaste de más, y eso',
};
function SaldoAFavor({ r }) {
  if (!(Number(r.saldo_favor) > 0)) return null;
  const usado = !!r.saldo_favor_usado_at;
  const devuelto = !!r.saldo_favor_devuelto_at;
  const codigo = r.pedido ?? r.codigo;
  return (
    <View style={{ borderRadius: 14, padding: 12, gap: 2, backgroundColor: 'rgba(52,199,89,0.12)' }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>
        {usado ? `Usaste tu saldo a favor de ${dolares(r.saldo_favor)}`
          : devuelto ? `Te devolvimos ${dolares(r.saldo_favor)}`
          : `Tienes ${dolares(r.saldo_favor)} a favor`}
      </Text>
      {!usado && !devuelto ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
          {ORIGEN_SALDO[r.saldo_favor_origen] ?? 'Tu anticipo'} te sirve para otra compra. Úsalo en cualquier sucursal hasta el {fecha(r.saldo_favor_vence)}: muestra el código {codigo} en caja.
        </Text>
      ) : null}
    </View>
  );
}
// Arriba de Mis reservas (2026-10-19): todo lo que tiene a favor, de un vistazo.
function ResumenSaldo({ s }) {
  const t = useTema();
  const codigos = (s.detalle ?? []).map((x) => x.codigo);
  return (
    <View style={{ borderRadius: 18, padding: 14, gap: 4, backgroundColor: FONDOS.exito }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2 }}>Saldo a favor</Text>
      <Text style={{ fontSize: 28, fontWeight: '900', color: t.color.exitoTexto, fontVariant: ['tabular-nums'] }}>{dolares(s.total)}</Text>
      <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>
        Úsalo en cualquier sucursal{s.vence ? ` hasta el ${fecha(s.vence)}` : ''}. En caja, muestra {codigos.length > 1 ? 'los códigos' : 'el código'} {codigos.join(', ')}.
      </Text>
    </View>
  );
}
// Por qué venció (2026-10-19): si fue de la sucursal, no cuenta en contra.
const MOTIVO_VENCIDA = {
  sin_receta: 'No llegó la foto de la receta a tiempo.',
  receta_sin_revisar: 'La sucursal no alcanzó a revisar tu receta a tiempo. No cuenta en tu contra.',
  sin_preparar: 'La sucursal no alcanzó a prepararla a tiempo. No cuenta en tu contra.',
  oferta_terminada: 'La oferta terminó antes de que se preparara. No cuenta en tu contra.',
  sin_retirar: 'Se cumplió el plazo para retirarla.',
};
function MotivoVencida({ r }) {
  if (!r || r.estado !== 'vencida' || !MOTIVO_VENCIDA[r.vencida_motivo]) return null;
  return <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{MOTIVO_VENCIDA[r.vencida_motivo]}</Text>;
}
function Pildora({ e }) {
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: e.fondo, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '800', color: e.color }}>{e.texto}</Text>
    </View>
  );
}

// Un encargo (2026-10-07): en qué paso va, el precio y la fecha cuando la
// sucursal confirma, y pagar el anticipo para asegurarlo.
const PASOS_ENCARGO = ['solicitado', 'confirmado', 'aceptado', 'pedido', 'listo'];
const TEXTO_ENCARGO = {
  solicitado: 'La sucursal está revisando si lo puede conseguir',
  confirmado: 'Se puede conseguir: confírmalo pagando el anticipo',
  aceptado: 'Pagado: ya lo estamos pidiendo',
  pedido: 'Pedido al proveedor',
  listo: '¡Llegó! Pasa a retirarlo',
  entregado: 'Entregado',
  rechazado: 'No se pudo conseguir',
  cancelado: 'Cancelado',
};
function Encargo({ e, alPagar, alCancelar, pagando = false }) {
  const t = useTema();
  const paso = PASOS_ENCARGO.indexOf(e.estado);
  const cerrado = paso < 0;
  return (
    <Tarjeta tono={e.estado === 'listo' ? t.color.verde : e.estado === 'confirmado' ? t.color.magenta : undefined} estilo={{ gap: 12, opacity: cerrado ? 0.7 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icono sf="shippingbox.fill" respaldo="" tam={14} color={colorSistema.texto2} />
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: colorSistema.texto2 }}>ENCARGO</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{e.codigo}</Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>{e.cantidad} × {e.producto_nombre}</Text>
      {!cerrado ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {PASOS_ENCARGO.map((p, i) => (
            <View key={p} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= paso ? (e.estado === 'listo' ? '#34C759' : t.color.magenta) : (t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)') }} />
          ))}
        </View>
      ) : null}
      <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto }}>{TEXTO_ENCARGO[e.estado] ?? e.estado}</Text>
      {e.precio_unitario != null ? (
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>
          {dolares(e.anticipo)} en total{e.fecha_estimada ? ` · llega aprox. el ${fecha(e.fecha_estimada)}` : ''} · retiro en {e.sala}
        </Text>
      ) : <Text style={{ fontSize: 14, color: colorSistema.texto2 }}>Retiro en {e.sala}</Text>}
      {e.nota_sucursal ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>«{e.nota_sucursal}»</Text> : null}
      {e.estado === 'confirmado' && e.pago_estado !== 'pagado' ? (
        <Boton alTocar={alPagar} cargando={pagando}>{`Confirmar y pagar ${dolares(e.anticipo)}`}</Boton>
      ) : null}
      {(e.estado === 'solicitado' || e.estado === 'confirmado') && e.pago_estado !== 'pagado' ? (
        <Presionable onPress={alCancelar} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.rojo }}>Cancelar encargo</Text>
        </Presionable>
      ) : null}
    </Tarjeta>
  );
}
