// «Pregúntale a la farmacia» (2026-10-12): un chat con el equipo de Farmacia
// Salud. Lo del cliente a la derecha; lo del equipo a la izquierda, con la foto
// y el nombre corto de quien contestó (los arma el servidor). Se mandan textos,
// fotos y productos; el equipo además puede mandar una oferta.
//
// No hay conexión en vivo: mientras la pantalla está a la vista se pregunta
// cada 5 s por lo NUEVO (`desde_id`) —cada 3 s si alguien del equipo está
// escribiendo o atendiendo—, y enseguida al llegar el push de una respuesta.
// Con cada respuesta llega `vivo` (2026-10-12): quién escribe ahora, quién
// atiende y si el equipo ya vio lo último del cliente («Visto»/«Enviado»).
// Mientras el cliente escribe se avisa (`chat_escribiendo`), a lo sumo cada 3 s.
// Hacia atrás, de a 30 (`antes_id`). Fuera de horario se avisa cuándo se responde.
//
// Reacciones y respuestas (2026-10-12): mantener presionado un mensaje abre su
// menú (6 reacciones, Responder, Copiar); deslizarlo a la derecha lo responde.
// Las piezas viven en componentes/ChatPiezas.js.
//
// Rediseño (2026-10-13). Pedido del usuario: «mejora la interfaz y cómo se ve
// la mensajería, que se sienta nativo, intuitivo, que permita consultar de un
// medicamento», y «que se vean cuáles son los mensajes nuevos, que no me
// confunda, más al estilo iMessage con mezcla de WhatsApp». Lo que cambió:
//   · Globos de iMessage agrupados (esquinas que se juntan dentro de una
//     racha), la foto del equipo sólo en el último de la racha y la hora al
//     tocar un globo. Separadores de día «Hoy / Ayer / fecha» en píldora y la
//     hora cuando pasa más de una hora entre mensajes.
//   · Lo nuevo, como WhatsApp: al entrar con respuestas sin leer se pone la
//     franja «N mensajes nuevos» antes de la primera y se abre AHÍ, no al
//     final. Se queda hasta salir de la pantalla. Lo que llega con la lista
//     subida suma en el botón flotante «↓ N»; lo que llega entra con un
//     destello suave.
//   · Los propios llevan ✓ (enviado) o ✓✓ (visto por el equipo) junto a la hora.
//   · El título es la farmacia: logo, «Farmacia Salud» y debajo en línea /
//     fuera de horario / quién atiende / «está escribiendo…».
//   · Consultar un medicamento: «+» → «Consultar un producto», el botón
//     «Preguntar a la farmacia» de la ficha y de Mis tratamientos (llegan con
//     `?producto=<id>`), y los atajos sobre la barra. El producto viaja como
//     tarjeta; nombre, precio y foto los pone el servidor.
//   · Un mensaje que no salió se queda con «No se envió» y se reintenta
//     tocándolo (antes desaparecía).
//   · «¿Cómo te atendimos?» cuando el equipo marca la consulta como resuelta.
//   · Enlaces, correos y teléfonos de los mensajes se pueden tocar.
//
// Abrir al instante (2026-10-14, «al abrirlo tarda un poco» y «errores de
// animación al abrir»):
//   · El último hilo queda en MEMORIA (`HILO`): al volver se pinta enseguida y
//     sólo se pide lo nuevo, después de la transición (InteractionManager).
//     El esqueleto sale sólo la primera vez.
//   · La primera carga trae los últimos 3 días (mínimo 15 mensajes, y siempre
//     desde el primero sin leer); «Cargar mensajes anteriores» trae de a una
//     semana (servidor: `desde_fecha` / `antes_de`).
//   · La lista va INVERTIDA, como toda app de mensajería: nace abajo, sin el
//     salto de arriba a abajo ni ocultarla mientras se ubica. Sólo con la
//     franja «N nuevos» se espera a ubicarla (sin mostrar el salto).
//   · Ningún globo entra animado al abrir: sólo lo que llega después, y con
//     un fundido (un deslizamiento en una lista invertida se ve al revés).
//   · El teclado: la pantalla lo sigue cuadro a cuadro con
//     `useAnimatedKeyboard` en iOS (sin el parpadeo del margen de abajo) y en
//     iOS 26 la barra es una cápsula de vidrio como el teclado flotante.
//   · Atención preferente: Platino y Clientes Mayoristas lo ven en el título.
//
// «Los mensajes están mal, se ve blur» y «aún tarda un poco al abrir»
// (2026-10-14, iOS 26 con el teclado abierto). Las dos causas:
//   · El DESENFOQUE no era un efecto nuestro: era el «scroll edge effect» de
//     iOS 26, que el sistema pone en la lista que queda debajo de una barra de
//     título TRANSPARENTE. La lista va invertida (scaleY: -1) y UIKit calcula
//     el borde en las coordenadas de la lista sin invertir: el difuminado del
//     título caía abajo y el del teclado subía hasta cubrir casi todo el hilo
//     —por eso lo de más arriba (debajo de la hora) se veía nítido—. Los
//     cuatro bordes van en `hidden` (app/_layout, BARRA_CHAT): nada difumina
//     los mensajes. Primero se probó una barra opaca con fondo liso: el
//     usuario la rechazó («ahora es negro… al deslizar se pone negro, un
//     desorden»). Hoy la barra es transparente sobre la aurora QUIETA, como
//     antes, y la lista empieza DEBAJO de ella: nada pasa por detrás, así que
//     se ve igual en reposo y al desplazar.
//   · La DEMORA de la primera apertura era la red (el esqueleto esperaba
//     `chat_mensajes`) más la aurora animada detrás de una pantalla
//     transparente durante la transición, y cada tecla volvía a dibujar todos
//     los globos. Ahora el hilo se precarga antes del toque (lib/chatHilo), la
//     pantalla es opaca, los globos son `memo` con acciones estables y lo caro
//     por globo (fechas, enlaces) se calcula una vez. En desarrollo se anota
//     en la consola cuánto tardó el primer cuadro y de dónde salió el hilo.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Dimensions, FlatList, InteractionManager, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import Animated, { Easing, FadeIn, useAnimatedKeyboard, withSpring, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import { Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { llamar } from '../lib/api';
import { alLlegarAviso, marcarChatALaVista } from '../lib/avisos';
import { elegirFotos, subirFoto } from '../lib/fotos';
import { nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { nombreProducto } from '../lib/catalogo';
import { datosDePrecio } from '../lib/precioTuyo';
import { LIVIANO } from '../lib/rendimiento';
import { usarVistaPreviaFoto } from '../componentes/VistaPreviaFoto';
import { Cita, Compositor, copiar, Deslizable, MenuMensaje, preguntarAdjunto, Reacciones, Respondiendo, subidaConTeclado, useMedir } from '../componentes/ChatPiezas';
import { BuscadorProducto, Calificar, ProductoPendiente, respuestasSugeridas, Sugerencias, TarjetaProducto, TextoConEnlaces } from '../componentes/ChatConsultas';
import VisorFotos from '../componentes/VisorFotos';
import { Documento, elegirPdf, HAY_AUDIO, NotaDeVoz } from '../componentes/ChatMedios';
import { escucharTimbre } from '../lib/enVivo';
import BuscarEnChat from '../componentes/BuscarEnChat';
import { suave, useTema } from '../tema/tema';
import { useMiNivel } from '../lib/exclusiva';
import { chatAbierto, desdeFechaPrimera, guardarHilo, leerHilo } from '../lib/chatHilo';
import { SUAVE } from '../componentes/movimiento';

// La entrada del mensaje propio: crece de 0.9 a 1 con el resorte SUAVE y se
// funde en 0.15 s. Una animación de entrada a medida de Reanimated (worklet).
function entradaPropia() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
    animations: {
      opacity: withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }),
      transform: [{ scale: withSpring(1, SUAVE) }],
    },
  };
}

const IOS = Platform.OS === 'ios';
const CADA_MS = 5000;
// Con el timbre en vivo conectado (lib/enVivo), el sondeo es sólo la red de
// seguridad: cada 20 s.
const CADA_EN_VIVO_MS = 20_000;
// Editar lo propio hasta 15 min; borrarlo, hasta 1 hora (el servidor manda igual).
const EDITAR_MS = 15 * 60_000, BORRAR_MS = 60 * 60_000;
// Con alguien del equipo escribiendo o atendiendo, la respuesta está cerca.
const CADA_RAPIDO_MS = 3000;
// «Está escribiendo» le dura 6 s al equipo: avisar cada 3 s lo mantiene encendido.
const ESCRIBIENDO_CADA_MS = 3000;
const SIN_VIVO = { escribiendo: null, atiende: null, visto: false };
// Una racha de globos se corta si pasan más de 10 min; la hora suelta, con más de una hora.
const RACHA_MS = 10 * 60_000;
const HUECO_MS = 60 * 60_000;
// Los radios de iMessage: grande afuera de la racha, chico donde se juntan.
const R = 18, r = 5;

const horaDe = (iso) => {
  const d = new Date(iso);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const claveDia = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
const diaDe = (iso) => {
  const d = new Date(iso);
  const hoy = new Date();
  if (claveDia(d) === claveDia(hoy)) return 'Hoy';
  if (claveDia(d) === claveDia(new Date(hoy.getTime() - 86400_000))) return 'Ayer';
  try {
    // Dentro de la semana, el día («martes»); más atrás, la fecha.
    const dias = (hoy - d) / 86400_000;
    return dias < 7 ? d.toLocaleDateString('es-SV', { weekday: 'long' })
      : d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) });
  } catch { return `${d.getDate()}/${d.getMonth() + 1}`; }
};
const iniciales = (n) => String(n ?? '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '·';
// La hora de El Salvador (UTC-6, sin horario de verano), por si el servidor no contestó.
// Mientras llega el horario real del servidor: 7:00 a 22:00 de El Salvador.
const fueraDeHorarioLocal = () => { const h = new Date(Date.now() - 6 * 3600_000).getUTCHours(); return h < 7 || h >= 22; };
const delEquipo = (m) => m.autor === 'equipo';
// El fondo del hilo es la aurora de la raíz, como en el resto de la app
// (2026-10-14, «deja el chat como estaba antes con el fondo, estaba más
// bonito»): la pantalla es transparente y la aurora, QUIETA detrás del chat
// (app/_layout, AuroraRaiz) — se dibuja una vez y no cuesta nada al desplazar.
// Los colores de los globos y las píldoras son los de antes, pensados para ella.
const globoEquipo = (oscuro) => (oscuro ? '#26252A' : '#FFFFFF');
// La altura del teclado, cuadro a cuadro, sólo en iOS: en Android la ventana
// se redimensiona sola (adjustResize) y sumarle la altura lo empujaría dos veces.
const useTecladoAlto = IOS ? () => useAnimatedKeyboard().height : () => null;
const fechaCorta = (iso) => {
  try { return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'long' }); } catch { return ''; }
};

const claveDe = (f) => f.clave;

// Lo que ya está en pantalla no se vuelve a poner (2026-10-15): el sondeo trae
// cada 3–5 s un objeto NUEVO de `conversacion` y `horario` aunque no haya
// cambiado nada, y ponerlo tal cual redibujaba la pantalla entera y el título.
const igualA = (a, b) => a === b || (a != null && b != null && JSON.stringify(a) === JSON.stringify(b));
const siCambio = (nuevo) => (ant) => (igualA(ant, nuevo) ? ant : nuevo);

// La foto que firma el servidor cambia de URL en cada respuesta: la caché de
// la imagen se ata a la RUTA estable (`<campo>_clave`), no a la URL, y así no
// se vuelve a bajar al abrir el chat (2026-10-15). Un servidor viejo no la
// manda: entonces la caché sigue por URL, como antes.
const fuenteFoto = (uri, clave) => (clave ? { uri, cacheKey: clave } : { uri });

// ¿Este mensaje del servidor es el que se mandó? Para cuando la respuesta de
// `chat_enviar` no llegó (2026-10-15): el mensaje pudo haber entrado igual, y
// ofrecer «Reintentar» sin mirar lo mandaría dos veces. Es del cliente,
// posterior al último id que se conocía al mandarlo, y con el mismo contenido.
const mismoTexto = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
function esElEnviado(m, e) {
  if (!e || !m || m.autor !== 'cliente' || typeof m.id !== 'number' || m.id <= (e.idAntes ?? 0)) return false;
  if (!mismoTexto(m.texto, e.texto) || !!m.foto_url !== !!e.uri) return false;
  const prodDe = m.adjunto?.tipo === 'producto' ? Number(m.adjunto.id) : null;
  if (prodDe !== (e.prod ? Number(e.prod.id) : null)) return false;
  // La cita, sólo si el servidor la trae (puede no resolverla).
  return !m.responde_a || !e.cita || m.responde_a.id === e.cita.id;
}
const CONTENIDO_LISTA = { paddingBottom: 8, paddingHorizontal: 10, paddingTop: 12 };
const MANTENER_POSICION = { minIndexForVisible: 0, autoscrollToTopThreshold: 80 };

/** El primer mensaje sin leer: el N-ésimo del equipo contando desde el final. */
function primeroSinLeer(lista, n) {
  if (!n || !lista?.length) return null;
  let vistos = 0, id = null;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (!delEquipo(lista[i])) continue;
    vistos += 1;
    id = lista[i].id;
    if (vistos >= n) break;
  }
  return id == null ? null : { id, n };
}

export default function Chat() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  // La barra de título va transparente sobre la aurora; la lista empieza DEBAJO
  // de ella (no pasa por detrás): así la barra se ve igual quieta y al
  // desplazar, y iOS 26 no tiene qué difuminar.
  const altoBarra = useHeaderHeight();
  const arriba = IOS ? (altoBarra || ins.top + 52) : 0;
  const pedir = useSesion((s) => s.pedir);
  const token = useSesion((s) => s.token);
  const { producto: productoParam, consulta: consultaParam } = useLocalSearchParams();
  // El hilo en memoria (precargado por la burbuja o de la última visita), si
  // es de esta misma sesión: con él, el primer cuadro ya trae los globos.
  const [cache] = useState(() => leerHilo(token));
  // Precargado con respuestas sin leer: la franja «N nuevos» va desde el primer cuadro.
  const [franjaInicial] = useState(() => (cache?.sinLeer ? primeroSinLeer(cache.mensajes, cache.sinLeer) : null));
  const marcarLeidoAlEntrar = useRef(!!cache?.sinLeer);
  // Cuánto tarda el primer cuadro y de dónde salió el hilo (sólo en desarrollo).
  const medida = useRef({ t0: Date.now(), origen: cache ? 'memoria' : 'red', anotado: false });
  const [mensajes, setMensajes] = useState(cache?.mensajes ?? null);
  const [hayMas, setHayMas] = useState(cache?.hayMas ?? false);
  const [fuera, setFuera] = useState(cache?.fuera ?? fueraDeHorarioLocal());
  // El texto del horario lo arma el servidor con el horario REAL de las sucursales (2026-10-12).
  const [horario, setHorario] = useState(cache?.horario ?? null);
  const tecladoAlto = useTecladoAlto();
  // Atención preferente (2026-10-14): Platino o Cliente Mayorista aprobado.
  const { nivel: miNivel, mayorista: soyMayorista } = useMiNivel();
  const preferente = soyMayorista ? 'mayorista' : miNivel?.clave === 'platino' ? 'platino' : null;
  const [error, setError] = useState(null);
  const [pendiente, setPendiente] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargandoViejos, setCargandoViejos] = useState(false);
  // El visor a pantalla completa (2026-10-20): TODAS las fotos del hilo, para pasar de una a otra.
  const [visor, setVisor] = useState(null); // { fotos: [{ uri, cacheKey? }], i }
  const [buscar, setBuscar] = useState(false);
  // En vivo (2026-10-20): el canal secreto de la conversación y la hora del
  // servidor desde la que se piden los cambios (ediciones, borrados).
  const [canal, setCanal] = useState(null);
  const enVivo = useRef(false);
  const cambiosDesde = useRef(null);
  const [editando, setEditando] = useState(null); // { id, texto }
  const lista = useRef(null);
  const campo = useRef(null);
  const ultimoId = useRef(0);
  // Abierto desde la memoria: lo primero que llegue del equipo lleva la franja «N nuevos».
  const desdeCache = useRef(!!cache && !franjaInicial);
  const preguntando = useRef(0);
  const alFondo = useRef(true);
  const [vivo, setVivo] = useState(() => (cache?.vivo
    ? { escribiendo: cache.vivo.escribiendo || null, atiende: cache.vivo.atiende || null, visto: !!cache.vivo.visto } : SIN_VIVO));
  const rapido = useRef(false);
  const avisoEscribiendo = useRef(0);
  const anotarVivo = (v) => {
    const x = v ? { escribiendo: v.escribiendo || null, atiende: v.atiende || null, visto: !!v.visto } : SIN_VIVO;
    rapido.current = !!(x.escribiendo || x.atiende);
    setVivo((a) => (a.escribiendo === x.escribiendo && a.atiende === x.atiende && a.visto === x.visto ? a : x));
  };
  const foto = usarVistaPreviaFoto();
  // Responder citando y el menú de un mensaje (2026-10-12).
  const [respondiendo, setRespondiendo] = useState(null); // { id, autor, texto, foto, nombre }
  const [menu, setMenu] = useState(null); // { m, caja }
  const [resaltado, setResaltado] = useState(null);
  // 2026-10-13: lo nuevo, el producto a consultar, la calificación.
  const [nuevosDesde, setNuevosDesde] = useState(franjaInicial); // { id, n }: la franja «N mensajes nuevos»
  const [lejos, setLejos] = useState(false);            // la lista está subida: se ve el botón ↓
  const [sinVer, setSinVer] = useState(0);              // llegaron con la lista subida
  const recien = useRef(new Set());                     // ids que entran con destello
  const [horaDe_, setHoraDe] = useState(null);          // el globo tocado muestra su hora
  const [producto, setProducto] = useState(null);       // { id, nombre, foto, precio } sobre la barra
  const [buscador, setBuscador] = useState(false);
  const preguntaDelAtajo = useRef(null);
  const [conversacion, setConversacion] = useState(cache?.conversacion ?? null);
  const [calificarCerrado, setCalificarCerrado] = useState(false);
  const inicial = useRef(true);
  // La lista nace abajo (invertida): sólo se oculta mientras se ubica en la franja de lo nuevo.
  const [listo, setListo] = useState(!franjaInicial);
  const mensajesRef = useRef(null);
  mensajesRef.current = mensajes;
  // El id más nuevo del hilo en memoria: desde ahí se pide lo nuevo.
  if (cache && !ultimoId.current) {
    for (const m of cache.mensajes ?? []) if (typeof m.id === 'number' && m.id > ultimoId.current) ultimoId.current = m.id;
  }
  // Guardar el hilo en memoria (sin lo que está saliendo todavía). Con la
  // pantalla abierta, la precarga de la burbuja no lo pisa.
  useEffect(() => {
    chatAbierto(true);
    return () => chatAbierto(false);
  }, []);
  useEffect(() => {
    if (!token || mensajes == null || pendiente) return;
    guardarHilo({ token, mensajes: mensajes.filter((m) => !m.enviando), hayMas, fuera, horario, conversacion, sinLeer: 0, vivo: null, en: Date.now() });
  }, [token, mensajes, hayMas, fuera, horario, conversacion, pendiente]);

  // Lo que cambió (editados, borrados): se reemplaza en su lugar.
  const aplicarCambios = (r) => {
    if (r?.hora) cambiosDesde.current = r.hora;
    if (r?.canal) setCanal((c) => (c === r.canal ? c : r.canal));
    if (!r?.cambios?.length) return;
    const porId = new Map(r.cambios.map((m) => [m.id, m]));
    setMensajes((ant) => (ant ?? []).map((m) => (porId.has(m.id) ? { ...porId.get(m.id), reacciones: porId.get(m.id).reacciones ?? m.reacciones } : m)));
  };
  // El id más nuevo que ya se tiene (los temporales no cuentan).
  const anotarUltimo = (arr) => {
    for (const m of arr) if (typeof m.id === 'number' && m.id > ultimoId.current) ultimoId.current = m.id;
  };
  const leido = useCallback(() => {
    pedir('chat_leido').catch?.(() => {});
    // El punto de «sin leer» de Cuenta se apaga sin esperar al próximo resumen.
    useCuenta.setState((x) => (x.resumen ? { resumen: { ...x.resumen, chat_sin_leer: 0 } } : x));
  }, [pedir]);

  const cargar = useCallback(async () => {
    const r = await pedir('chat_mensajes', { desde_fecha: desdeFechaPrimera() });
    if (r?.pendiente) { setPendiente(true); setMensajes([]); return; }
    if (!r?.ok) { setError(r?.mensaje ?? 'Revisa tu conexión.'); setMensajes((x) => x ?? []); return; }
    setError(null);
    if (r.hora) cambiosDesde.current = r.hora;
    if (r.canal) setCanal(r.canal);
    setFuera(!!r.fuera_de_horario);
    if (r.horario) setHorario(siCambio(r.horario));
    if ('vivo' in r) anotarVivo(r.vivo);
    if (r.conversacion) setConversacion(siCambio(r.conversacion));
    setHayMas(!!r.hay_mas);
    anotarUltimo(r.mensajes);
    // La franja de lo nuevo se calcula ANTES de marcar leído (2026-10-13).
    if (r.sin_leer) {
      const franja = primeroSinLeer(r.mensajes, Number(r.sin_leer));
      setNuevosDesde(franja);
      // Con franja, la lista se muestra cuando ya está ubicada en ella.
      if (franja) setListo(false);
    }
    setMensajes(r.mensajes);
    if (r.sin_leer) leido();
  }, [pedir, leido]);

  // Lo nuevo desde el último que se tiene.
  const nuevos = useCallback(async () => {
    // `preguntando` guarda la hora: si una consulta quedó colgada más de 15 s,
    // se da por perdida y se vuelve a preguntar (2026-10-12).
    if ((preguntando.current && Date.now() - preguntando.current < 15_000) || AppState.currentState !== 'active') return;
    if (!ultimoId.current) { await cargar(); return; }
    preguntando.current = Date.now();
    try {
      const r = await pedir('chat_mensajes', { desde_id: ultimoId.current, ...(cambiosDesde.current ? { cambios_desde: cambiosDesde.current } : {}) });
      if (r?.ok) aplicarCambios(r);
      // Lo «en vivo» cambia aunque no haya mensajes nuevos.
      if (r?.ok && 'vivo' in r) anotarVivo(r.vivo);
      if (r?.ok && r.conversacion) setConversacion(siCambio(r.conversacion));
      if (!r?.ok || !r.mensajes?.length) {
        if (r?.ok) { setFuera(!!r.fuera_de_horario); desdeCache.current = false; }
        return;
      }
      setFuera(!!r.fuera_de_horario);
      if (r.horario) setHorario(siCambio(r.horario));
      anotarUltimo(r.mensajes);
      // Lo que de verdad es nuevo se cuenta contra lo que hay en pantalla (el
      // actualizador de `setMensajes` corre después, en el próximo render).
      const yaEstan = new Set((mensajesRef.current ?? []).map((m) => m.id));
      const frescos = r.mensajes.filter((m) => !yaEstan.has(m.id));
      for (const m of frescos) recien.current.add(m.id);
      const llegaron = frescos.filter((m) => m.autor !== 'cliente').length;
      // Abierto desde la memoria: lo que llegó del equipo mientras tanto lleva
      // la franja «N nuevos», igual que en una carga completa.
      if (desdeCache.current) {
        desdeCache.current = false;
        const primero = frescos.find((m) => m.autor === 'equipo');
        if (primero) setNuevosDesde({ id: primero.id, n: frescos.filter((m) => m.autor === 'equipo').length });
      }
      setMensajes((ant) => {
        const vistos = new Set((ant ?? []).map((m) => m.id));
        const llegados = r.mensajes.filter((m) => !vistos.has(m.id));
        // Un envío que quedó «sin confirmar» y que en realidad entró: llega
        // por acá, y su globo fallido se va (no queda repetido).
        const base = (ant ?? []).filter((m) => !(m.dudoso && llegados.some((n) => esElEnviado(n, m.reintento))));
        return [...base, ...llegados];
      });
      // Con la lista subida, lo que llega suma en el botón ↓ (como WhatsApp).
      if (llegaron && !alFondo.current) setSinVer((n) => n + llegaron);
      if (llegaron) Haptics.selectionAsync().catch(() => {});
      if (r.mensajes.some((m) => m.autor !== 'cliente')) leido();
    } finally {
      preguntando.current = 0;
    }
  }, [pedir, cargar, leido]);

  useFocusEffect(useCallback(() => {
    marcarChatALaVista(true);
    // Sin nada en pantalla se pide ya (en paralelo con la transición); con el
    // hilo en memoria, lo nuevo se pide cuando la transición terminó.
    let tarea = null;
    if (mensajes == null) cargar();
    else {
      tarea = InteractionManager.runAfterInteractions(() => {
        // Precargado con respuestas sin leer: se marcan leídas ya en pantalla.
        if (marcarLeidoAlEntrar.current) { marcarLeidoAlEntrar.current = false; leido(); }
        nuevos();
      });
    }
    // Un reloj que se reprograma solo: 3 s con el equipo activo, 5 s si no.
    let reloj = null;
    let vivoAca = true;
    const tic = async () => {
      await nuevos();
      if (vivoAca) reloj = setTimeout(tic, enVivo.current ? CADA_EN_VIVO_MS : rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    };
    reloj = setTimeout(tic, enVivo.current ? CADA_EN_VIVO_MS : rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    // Llegó el push de una respuesta: se pregunta ya, sin esperar los 5 s.
    const quitar = alLlegarAviso((a) => { if (typeof a.url === 'string' && a.url.startsWith('/chat')) nuevos(); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') nuevos(); });
    return () => {
      vivoAca = false; marcarChatALaVista(false); clearTimeout(reloj); quitar(); app.remove(); tarea?.cancel?.();
      // Al irse de la pantalla, el menú de un mensaje no se queda abierto.
      setMenu(null);
      // La franja «N mensajes nuevos» dura hasta salir de la pantalla.
      setNuevosDesde(null);
    };
  }, [cargar, nuevos])); // eslint-disable-line react-hooks/exhaustive-deps -- `mensajes` sólo decide la primera carga

  // El timbre en vivo (2026-10-20): con la pantalla a la vista y el canal de
  // la conversación conocido, cada cambio en la base pide lo nuevo al
  // instante. Si no conecta, el sondeo de arriba sigue como antes.
  const nuevosRef = useRef(nuevos);
  nuevosRef.current = nuevos;
  useFocusEffect(useCallback(() => {
    if (!canal) return undefined;
    let espera = null;
    const soltar = escucharTimbre(canal, () => {
      // Varios timbres seguidos (un mensaje y su «visto») piden una sola vez.
      clearTimeout(espera);
      espera = setTimeout(() => nuevosRef.current(), 120);
    }, (conectado) => { enVivo.current = conectado; if (conectado) nuevosRef.current(); });
    return () => { clearTimeout(espera); soltar(); enVivo.current = false; };
  }, [canal]));

  // El menú de un mensaje se cierra si se abre el teclado (2026-10-14).
  useEffect(() => {
    const s = Keyboard.addListener(IOS ? 'keyboardWillShow' : 'keyboardDidShow', () => setMenu(null));
    return () => s.remove();
  }, []);

  // Las acciones de los globos, ESTABLES: así un globo memoizado no se vuelve a
  // dibujar con cada tecla que se escribe en la barra (antes, escribir
  // redibujaba todos los globos a la vista en cada letra).
  const acciones = useRef({});
  const acc = useMemo(() => ({
    verFoto: (u) => acciones.current.verFoto?.(u),
    tocar: (m) => acciones.current.tocar?.(m),
    responder: (m) => acciones.current.responder?.(m),
    menu: (m, caja) => acciones.current.menu?.(m, caja),
    reaccionar: (m, e) => acciones.current.reaccionar?.(m, e),
    irA: (id) => acciones.current.irA?.(id),
  }), []);

  // Llegó con un producto (`/chat?producto=<id>`, desde la ficha o Mis
  // tratamientos): se pone sobre la barra. Nombre, foto y precio, del catálogo.
  useEffect(() => {
    const id = Number(productoParam);
    if (!Number.isInteger(id) || id <= 0) return;
    let vigente = true;
    llamar('catalogo_producto', { id, ...datosDePrecio() }).then((r) => {
      if (!vigente || !r?.ok) return;
      const precios = (r.producto.presentaciones ?? []).map((x) => Number(x.precio)).filter((n) => n > 0);
      setProducto({ id: r.producto.id, nombre: r.producto.nombre, foto: r.producto.foto ?? null, precio: precios.length ? Math.min(...precios) : null });
      setTimeout(() => campo.current?.focus?.(), 350);
    });
    return () => { vigente = false; };
  }, [productoParam]);

  // Llegó con una consulta escrita (`/chat?consulta=…`, desde «Más
  // información» de una historia): queda en la barra, lista para enviar o
  // corregir. Una sola vez por consulta, y sin pisar lo que ya se escribió.
  const consultaPuesta = useRef(null);
  useEffect(() => {
    const c = typeof consultaParam === 'string' ? consultaParam.trim().slice(0, 500) : '';
    if (!c || consultaPuesta.current === c) return undefined;
    consultaPuesta.current = c;
    setTexto((x) => (x.trim() ? x : c));
    const id = setTimeout(() => campo.current?.focus?.(), 450);
    return () => clearTimeout(id);
  }, [consultaParam]);

  // Si en 1.5 s no se pudo ubicar la lista (sin mensajes que medir), se muestra igual.
  useEffect(() => {
    if (mensajes == null || listo) return undefined;
    const id = setTimeout(() => setListo(true), 1500);
    return () => clearTimeout(id);
  }, [mensajes, listo]);

  const anteriores = async () => {
    if (cargandoViejos || !mensajes?.length) return;
    const primero = mensajes.find((m) => typeof m.id === 'number');
    if (!primero) return;
    setCargandoViejos(true);
    // De a una semana (2026-10-14); el servidor la corta en 50.
    const r = await pedir('chat_mensajes', { antes_id: primero.id, antes_de: primero.created_at });
    setCargandoViejos(false);
    if (!r?.ok) return;
    alFondo.current = false;
    setHayMas(!!r.hay_mas);
    setMensajes((ant) => {
      const vistos = new Set((ant ?? []).map((m) => m.id));
      return [...r.mensajes.filter((m) => !vistos.has(m.id)), ...(ant ?? [])];
    });
  };

  // Enviar: aparece al instante (temporal) y se reemplaza por el del servidor.
  // Si falla, se queda marcado «No se envió» y se reintenta tocándolo.
  //
  // Sin confirmar (2026-10-15): un envío sin respuesta se corta a los ~30 s
  // (`sinConfirmar`, lib/api) y el mensaje PUDO haber entrado. Antes de
  // ofrecer «Reintentar» se busca en el hilo; si no se pudo mirar, el globo
  // queda «Sin confirmar», el sondeo lo quita si aparece y el reintento vuelve
  // a mirar antes de mandar. Así no se manda dos veces.
  const enviarYa = useRef(false);
  // Busca el mensaje mandado: en pantalla (el sondeo pudo traerlo) o en lo
  // nuevo del servidor. `null` = no se pudo mirar; `false` = no está.
  const buscarEnviado = async (envio) => {
    const enPantalla = (mensajesRef.current ?? []).find((m) => esElEnviado(m, envio));
    if (enPantalla) return enPantalla;
    const r = await pedir('chat_mensajes', { desde_id: envio.idAntes });
    if (!r?.ok) return null;
    return (r.mensajes ?? []).find((m) => esElEnviado(m, envio)) ?? false;
  };
  // El globo temporal pasa a ser el del servidor (sin repetirlo si ya estaba).
  const ponerEnviado = (tmpId, real) => {
    setMensajes((ant) => (ant ?? []).filter((m) => m.id !== real.id).map((m) => (m.id === tmpId ? real : m)));
  };
  const mandar = async ({ texto: tx = null, uri = null, prod = null, cita = null, reemplaza = null, previo = null, archivo = null }) => {
    if (enviarYa.current) return false;
    enviarYa.current = true;
    setEnviando(true);
    // Lo mandado y el último id conocido ANTES de mandarlo: lo que se busque
    // después, si la respuesta no llega, tiene que ser posterior a él.
    const envio = { texto: tx, uri, prod, cita, archivo, idAntes: ultimoId.current };
    const tmp = { id: reemplaza ?? `tmp-${Date.now()}`, autor: 'cliente', texto: tx, foto_url: uri, created_at: new Date().toISOString(), enviando: true,
      adjunto: prod ? { tipo: 'producto', ...prod } : archivo ? { tipo: archivo.tipo, url: archivo.uri, nombre: archivo.nombre ?? null, duracion: archivo.duracion ?? null } : null,
      responde_a: cita ? { id: cita.id, autor: cita.autor, texto: cita.texto, foto: cita.foto } : null, reacciones: [] };
    alFondo.current = true;
    setSinVer(0);
    recien.current.add(tmp.id);
    setMensajes((ant) => (reemplaza ? (ant ?? []).map((m) => (m.id === reemplaza ? tmp : m)) : [...(ant ?? []), tmp]));
    try {
      // El reintento de un envío sin confirmar: primero se mira si entró.
      if (previo) {
        const ya = await buscarEnviado(previo);
        if (ya) { ponerEnviado(tmp.id, ya); return true; }
        // Todavía no se puede mirar: mandarlo a ciegas podría repetirlo.
        if (ya === null) throw Object.assign(new Error('Todavía no pudimos confirmar si se envió. Revisa tu conexión.'), { dudoso: true });
      }
      let fotoRuta = null;
      if (uri) {
        const s = await subirFoto(pedir, 'chat_subir_url', {}, uri);
        if (!s.ok) throw new Error(s.mensaje);
        fotoRuta = s.ruta;
      }
      // Un documento o una nota de voz (2026-10-20): se sube con su tipo.
      let archivoRuta = null;
      if (archivo) {
        const s2 = await subirFoto(pedir, 'chat_subir_url', { tipo: archivo.tipo }, archivo.uri, archivo.tipo === 'pdf' ? 'application/pdf' : 'audio/mp4');
        if (!s2.ok) throw new Error(s2.mensaje);
        archivoRuta = s2.ruta;
      }
      const r = await pedir('chat_enviar', { texto: tx, foto_ruta: fotoRuta, ...(cita ? { respuesta_a: cita.id } : {}), ...(prod ? { producto_id: prod.id } : {}),
        ...(archivo ? { archivo_ruta: archivoRuta, archivo_tipo: archivo.tipo, archivo_nombre: archivo.nombre ?? null, duracion: archivo.duracion ?? null } : {}) });
      if (!r?.ok && r?.sinConfirmar) {
        const ya = await buscarEnviado(envio);
        if (ya) { ponerEnviado(tmp.id, ya); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); return true; }
        // No se pudo mirar: queda en duda, no como «no se envió».
        if (ya === null) throw Object.assign(new Error(r.mensaje ?? 'No pudimos confirmar si se envió.'), { dudoso: true });
        throw new Error('No se envió. Revisa tu conexión.');
      }
      if (!r?.ok) throw new Error(r?.mensaje ?? 'No se pudo enviar. Revisa tu conexión.');
      if (typeof r.fuera_de_horario === 'boolean') setFuera(r.fuera_de_horario);
      if (r.horario) setHorario(siCambio(r.horario));
      if (r.conversacion) setConversacion(siCambio(r.conversacion));
      anotarUltimo([r.mensaje]);
      recien.current.add(r.mensaje.id);
      // Lo que contestó el sistema: el acuse y, desde el 2026-10-20, las
      // respuestas automáticas (`automaticas`, en orden).
      const extra = r.automaticas ?? (r.automatico ? [r.automatico] : []);
      const idsExtra = new Set(extra.map((x) => x.id));
      setMensajes((ant) => {
        const sin = (ant ?? []).filter((m) => m.id !== r.mensaje.id && !idsExtra.has(m.id)).map((m) => (m.id === tmp.id ? r.mensaje : m));
        return [...sin, ...extra];
      });
      if (extra.length) { anotarUltimo(extra); for (const x of extra) recien.current.add(x.id); }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return true;
    } catch (e) {
      setMensajes((ant) => (ant ?? []).map((m) => (m.id === tmp.id
        ? { ...m, enviando: false, fallido: e?.message ?? 'Revisa tu conexión.', dudoso: !!e?.dudoso,
          // Un reintento de algo en duda sigue en duda respecto del PRIMER envío.
          reintento: e?.dudoso && previo ? previo : envio } : m)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return false;
    } finally {
      enviarYa.current = false;
      setEnviando(false);
    }
  };
  const reintentar = (m) => {
    const elegir = (i) => {
      // En duda: el reintento primero mira si el primero entró.
      if (i === 0) mandar({ ...m.reintento, reemplaza: m.id, previo: m.dudoso ? m.reintento : null });
      if (i === 1) setMensajes((ant) => (ant ?? []).filter((x) => x.id !== m.id));
    };
    const titulo = m.dudoso ? `Sin confirmar: ${m.fallido}` : `No se envió: ${m.fallido}`;
    if (Platform.OS === 'web') {
      Alert.alert(m.dudoso ? 'Sin confirmar' : 'No se envió', m.fallido, [{ text: 'Eliminar', style: 'destructive', onPress: () => elegir(1) }, { text: 'Reintentar', onPress: () => elegir(0) }]);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: ['Reintentar', 'Eliminar', 'Cancelar'], destructiveButtonIndex: 1, cancelButtonIndex: 2 }, elegir);
  };
  // «El cliente está escribiendo»: a lo sumo una vez cada 3 s, nunca con el campo vacío.
  const alEscribir = (v) => {
    setTexto(v.slice(0, 2000));
    if (!v.trim() || pendiente) return;
    const ahora = Date.now();
    if (ahora - avisoEscribiendo.current < ESCRIBIENDO_CADA_MS) return;
    avisoEscribiendo.current = ahora;
    pedir('chat_escribiendo').catch?.(() => {});
  };
  // Enviar lo de la barra: el texto y, si hay, el producto elegido. Lo que
  // falla se queda en la conversación para reintentar, no vuelve a la barra.
  const enviarBarra = async () => {
    const tx = texto.trim();
    // Editando (2026-10-20): se guarda el texto nuevo en su lugar.
    if (editando) {
      const ed = editando;
      if (!tx) return;
      setEditando(null);
      setTexto('');
      setMensajes((ant) => (ant ?? []).map((m) => (m.id === ed.id ? { ...m, texto: tx, editado: true } : m)));
      const r = await pedir('chat_editar', { id: ed.id, texto: tx });
      if (!r?.ok) {
        setMensajes((ant) => (ant ?? []).map((m) => (m.id === ed.id ? { ...m, texto: ed.texto, editado: ed.editado } : m)));
        Alert.alert('No se editó', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
      } else if (r.mensaje) setMensajes((ant) => (ant ?? []).map((m) => (m.id === ed.id ? { ...r.mensaje, reacciones: m.reacciones } : m)));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    if ((!tx && !producto) || enviando) return;
    const cita = respondiendo;
    const prod = producto;
    setTexto('');
    setProducto(null);
    setRespondiendo(null);
    await mandar({ texto: tx || null, prod, cita });
  };
  // «+»: un producto, o una foto (siempre pasa por la vista previa con zoom).
  const adjuntar = async (origenDado) => {
    if (enviando) return;
    const origen = origenDado ?? await preguntarAdjunto();
    if (!origen) return;
    if (origen === 'producto') { preguntaDelAtajo.current = null; setBuscador(true); return; }
    if (origen === 'pdf') {
      const d = await elegirPdf();
      if (d?.error) { Alert.alert('No se pudo usar el documento', d.error); return; }
      if (!d) return;
      const cita = respondiendo;
      setRespondiendo(null);
      await mandar({ archivo: { tipo: 'pdf', uri: d.uri, nombre: d.nombre }, cita });
      return;
    }
    // De la galería, VARIAS a la vez (2026-10-20, hasta 6), una tras otra y
    // en el orden en que se eligieron; la cámara sigue con su vista previa.
    if (origen === 'galeria') {
      const fs = await elegirFotos(6);
      if (fs?.error) { Alert.alert('No se pudo usar la foto', fs.error); return; }
      if (!fs?.length) return;
      const cita = respondiendo;
      setRespondiendo(null);
      for (let k = 0; k < fs.length; k += 1) {
        // Si una no sale, las demás no se mandan solas: queda para reintentar.
        if (!(await mandar({ uri: fs[k].uri, cita: k === 0 ? cita : null }))) break;
      }
      return;
    }
    const f = await foto.elegir({ origen });
    if (!f) return;
    const cita = respondiendo;
    setRespondiendo(null);
    await mandar({ uri: f.uri, cita });
  };
  // Nota de voz (2026-10-20): el gesto (mantener, deslizar, bloquear) vive en
  // `useMicrofono` de ChatMedios, dentro de la barra; acá sólo llega la nota
  // terminada y sale por el MISMO envío que una foto o un PDF
  // (`chat_subir_url` + `chat_enviar`, con la cita si se respondía).
  const enviarNota = async ({ uri, duracion }) => {
    const cita = respondiendo;
    setRespondiendo(null);
    await mandar({ archivo: { tipo: 'audio', uri, duracion }, cita });
  };
  // Borrar lo propio: se confirma, y queda «Eliminaste este mensaje».
  const borrar = (m) => {
    Alert.alert('¿Eliminar este mensaje?', 'Se elimina para ti y para la farmacia.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        const antes = m;
        setMensajes((ant) => (ant ?? []).map((x) => (x.id === m.id ? { ...x, borrado: true, texto: null, foto_url: null, adjunto: null, reacciones: [] } : x)));
        const r = await pedir('chat_borrar', { id: m.id });
        if (!r?.ok) {
          setMensajes((ant) => (ant ?? []).map((x) => (x.id === m.id ? antes : x)));
          Alert.alert('No se eliminó', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
        } else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } },
    ]);
  };
  const editar = (m) => {
    setEditando({ id: m.id, texto: m.texto, editado: !!m.editado });
    setRespondiendo(null);
    setTexto(m.texto ?? '');
    setTimeout(() => campo.current?.focus?.(), 50);
  };
  const elegirProducto = (p) => {
    setBuscador(false);
    setProducto(p);
    // El atajo («¿Necesita receta?») deja su pregunta escrita, si la barra está vacía.
    if (preguntaDelAtajo.current && !texto.trim()) setTexto(preguntaDelAtajo.current);
    preguntaDelAtajo.current = null;
    setTimeout(() => campo.current?.focus?.(), 450);
  };
  const atajo = (s) => {
    if (s.accion === 'foto') { adjuntar(); return; }
    if (s.accion === 'producto') { preguntaDelAtajo.current = s.mensaje; setBuscador(true); return; }
    if (s.accion === 'escribir') { setTexto(s.mensaje); setTimeout(() => campo.current?.focus?.(), 50); return; }
    mandar({ texto: s.mensaje });
  };

  // Reaccionar: al instante en pantalla, y si el servidor no lo acepta se
  // vuelve atrás. Tocar la misma reacción la quita.
  const reaccionar = async (m, emoji) => {
    if (typeof m.id !== 'number') return;
    const antes = m.reacciones ?? [];
    const yaEra = antes.find((x) => x.mia)?.emoji === emoji;
    const nuevas = [...antes.filter((x) => !x.mia), ...(yaEra ? [] : [{ emoji, mia: true }])];
    const poner = (l) => setMensajes((ant) => (ant ?? []).map((x) => (x.id === m.id ? { ...x, reacciones: l } : x)));
    poner(nuevas);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const res = await pedir('chat_reaccionar', { mensaje_id: m.id, emoji: yaEra ? null : emoji });
    if (!res?.ok) { poner(antes); Alert.alert('No se guardó la reacción', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); }
  };
  const responderA = (m) => {
    if (typeof m.id !== 'number') return;
    setRespondiendo({ id: m.id, autor: m.autor, texto: m.texto ?? null, foto: !!m.foto_url,
      nombre: m.autor === 'equipo' ? (m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud') : null });
    setTimeout(() => campo.current?.focus?.(), 50);
  };
  // Calificar: el agradecimiento se ve antes de que la tarjeta se vaya.
  const convTrasCalificar = useRef(null);
  const calificar = async (nota, comentario) => {
    const res = await pedir('chat_calificar', { calificacion: nota, comentario: comentario || null });
    if (!res?.ok) { Alert.alert('No se guardó', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return false; }
    convTrasCalificar.current = res.conversacion ?? null;
    return true;
  };
  const cerrarCalificar = () => {
    setCalificarCerrado(true);
    if (convTrasCalificar.current) { setConversacion(convTrasCalificar.current); convTrasCalificar.current = null; }
  };

  // Las filas: la píldora del día, la hora suelta tras un hueco largo, la
  // franja de lo nuevo y los globos, cada uno sabiendo si abre o cierra su racha.
  const filas = useMemo(() => {
    const out = [];
    if (!mensajes) return out;
    let dia = null;
    // Lo del cliente ya lo vio el equipo si después contestó alguien del equipo.
    let ultimoEquipo = -1;
    mensajes.forEach((m, i) => { if (delEquipo(m)) ultimoEquipo = i; });
    const corta = (a, b) => !a || !b || claveDia(new Date(a.created_at)) !== claveDia(new Date(b.created_at))
      || Date.parse(b.created_at) - Date.parse(a.created_at) > HUECO_MS || (nuevosDesde && b.id === nuevosDesde.id);
    // Las respuestas automáticas seguidas también forman racha (un solo rótulo).
    const misma = (a, b) => a && b && a.autor === b.autor && (a.autor !== 'sistema' || (a.automatica && b.automatica)) && !a.fallido && !b.fallido
      && (a.autor !== 'equipo' || a.equipo?.nombre === b.equipo?.nombre)
      && Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < RACHA_MS && !corta(a, b);
    // El rótulo del día se arma UNA vez por día, no por mensaje: `toLocaleDateString`
    // es caro en Hermes y con 50 mensajes se notaba al abrir.
    const rotulos = new Map();
    const rotuloDe = (iso) => {
      const k = claveDia(new Date(iso));
      if (!rotulos.has(k)) rotulos.set(k, diaDe(iso));
      return rotulos.get(k);
    };
    mensajes.forEach((m, i) => {
      const d = rotuloDe(m.created_at);
      const previo = mensajes[i - 1];
      if (d !== dia) { dia = d; out.push({ clave: `d:${d}:${i}`, dia: d, hora: horaDe(m.created_at) }); }
      else if (previo && Date.parse(m.created_at) - Date.parse(previo.created_at) > HUECO_MS) out.push({ clave: `h:${i}`, hora: horaDe(m.created_at) });
      if (nuevosDesde && m.id === nuevosDesde.id) out.push({ clave: 'nuevos', nuevos: nuevosDesde.n });
      out.push({ clave: `m:${m.id}`, m, primero: !misma(previo, m), ultimo: !misma(m, mensajes[i + 1]), visto: i < ultimoEquipo });
    });
    return out;
  }, [mensajes, nuevosDesde]);

  // La lista va invertida (2026-10-14): el índice 0 es lo más nuevo, abajo.
  const datos = useMemo(() => [...filas].reverse(), [filas]);
  const iNuevos = datos.findIndex((f) => f.nuevos);

  // Al abrir: la lista invertida ya nace abajo. Con la franja de lo nuevo, se
  // lleva la franja arriba de la pantalla ANTES de mostrarla (sin el salto).
  const ubicar = () => {
    if (!inicial.current || !datos.length) return;
    inicial.current = false;
    if (iNuevos < 0) { setListo(true); return; }
    alFondo.current = false;
    requestAnimationFrame(() => {
      try { lista.current?.scrollToIndex({ index: iNuevos, viewPosition: 0.92, animated: false }); } catch { /* fuera de lo medido */ }
      requestAnimationFrame(() => setListo(true));
    });
  };
  const alFinal = () => {
    alFondo.current = true;
    setSinVer(0);
    lista.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // ── La lista, con props ESTABLES (2026-10-14, «al hacer scroll se siente
  // lento»). `FlatList` es un PureComponent: si nada de lo que recibe cambia,
  // escribir en la barra, el sondeo cada 5 s o el «escribiendo…» del equipo NO
  // la vuelven a dibujar. Por eso cada manejador lee lo que necesita de un ref
  // y el encabezado y el pie son elementos memorizados.
  const idConEstado = useMemo(() => {
    // «Visto» / «Enviado» junto al último mensaje del cliente, si es lo último
    // de la conversación (los avisos del sistema no cuentan).
    let ultimoReal = null;
    for (let i = (mensajes?.length ?? 0) - 1; i >= 0; i -= 1) if (mensajes[i].autor !== 'sistema') { ultimoReal = mensajes[i]; break; }
    return ultimoReal?.autor === 'cliente' && !ultimoReal.enviando && !ultimoReal.fallido ? ultimoReal.id : null;
  }, [mensajes]);
  // El nombre de quien escribió cada mensaje del equipo, para las citas.
  const nombres = useMemo(() => {
    const x = new Map();
    for (const m of mensajes ?? []) if (m.equipo?.nombre) x.set(m.id, nombrePropio(m.equipo.nombre));
    return x;
  }, [mensajes]);
  const vistoVivo = vivo.visto;
  const renderItem = useCallback(({ item: f }) => {
    if (f.nuevos) return <FranjaNuevos n={f.nuevos} />;
    if (f.hora && !f.m) return <Separador dia={f.dia} hora={f.hora} />;
    const m = f.m;
    return (
      <Burbuja m={m} primero={f.primero} ultimo={f.ultimo} entra={recien.current.has(m.id)}
        estado={m.autor === 'cliente' ? (m.id === idConEstado ? (vistoVivo ? 'visto' : 'enviado') : f.visto ? 'visto' : 'enviado') : null}
        rotuloEstado={m.id === idConEstado}
        verHora={horaDe_ === m.id}
        resaltado={resaltado === m.id} nombreCitado={m.responde_a ? (nombres.get(m.responde_a.id) ?? null) : null}
        acc={acc} />
    );
  }, [acc, idConEstado, vistoVivo, horaDe_, resaltado, nombres]);

  const lejosRef = useRef(false);
  const sinVerRef = useRef(0);
  sinVerRef.current = sinVer;
  const alDesplazar = useCallback(({ nativeEvent: e }) => {
    const y = e.contentOffset.y;
    alFondo.current = y < 80;
    if (alFondo.current && sinVerRef.current) setSinVer(0);
    const l = y > 240;
    if (l !== lejosRef.current) { lejosRef.current = l; setLejos(l); }
  }, []);
  const ubicarRef = useRef(ubicar);
  ubicarRef.current = ubicar;
  const alCambiarAlto = useCallback(() => {
    if (__DEV__ && !medida.current.anotado) {
      medida.current.anotado = true;
      console.log(`[chat] primer cuadro con globos: ${Date.now() - medida.current.t0} ms (hilo de ${medida.current.origen})`);
    }
    if (inicial.current) { ubicarRef.current(); return; }
    if (alFondo.current) lista.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);
  const alFallarIndice = useCallback((e) => {
    lista.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: false });
    setTimeout(() => {
      try { lista.current?.scrollToIndex({ index: e.index, viewPosition: 0.9, animated: false }); } catch { /* sin medir */ }
      setListo(true);
    }, 120);
  }, []);
  const estiloLista = useMemo(() => ({ opacity: listo ? 1 : 0 }), [listo]);

  // El pie (arriba en pantalla: la lista va invertida) y el encabezado (abajo).
  const anterioresRef = useRef(null);
  const pedirAnteriores = useCallback(() => anterioresRef.current?.(), []);
  const calificarRef = useRef(null);
  const enviarCalificacion = useCallback((nota, comentario) => calificarRef.current?.(nota, comentario), []);
  const cerrarCalificarRef = useRef(null);
  const alCerrarCalificar = useCallback(() => cerrarCalificarRef.current?.(), []);
  const masViejo = useMemo(() => (mensajes ?? []).find((m) => typeof m.id === 'number'), [mensajes]);
  const vacio = !mensajes?.length;
  const pie = useMemo(() => (
    <View style={{ gap: 10, marginBottom: 6 }}>
      {hayMas ? (
        <Presionable onPress={pedirAnteriores} disabled={cargandoViejos} accessibilityRole="button"
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14 }}>
          {cargandoViejos ? <Icono sf="clock" respaldo="…" tam={14} color={colorSistema.texto3} /> : null}
          <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>{cargandoViejos ? 'Cargando…' : 'Cargar mensajes anteriores'}</Text>
        </Presionable>
      ) : null}
      {hayMas && masViejo ? (
        <Text style={{ alignSelf: 'center', marginTop: -8, fontSize: 12, color: colorSistema.texto3 }}>Mostrando desde el {fechaCorta(masViejo.created_at)}</Text>
      ) : null}
      {vacio ? <Bienvenida preferente={preferente} /> : null}
      {/* El horario de atención, como el aviso centrado de iMessage. */}
      <View style={{ alignSelf: 'center', maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
        backgroundColor: fuera ? suave(t.color.aviso, t.oscuro ? 0.22 : 0.16) : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)') }}>
        <Icono sf={fuera ? 'clock' : 'checkmark.seal.fill'} respaldo="" tam={13} color={fuera ? t.color.avisoTexto : t.color.verdeTexto} />
        <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 17, textAlign: 'center', color: fuera ? t.color.avisoTexto : colorSistema.texto2 }}>
          {horario?.texto || (fuera ? 'Estamos fuera de horario: escríbenos igual y te respondemos al abrir.' : 'Te responde el equipo de Farmacia Salud en unos minutos.')}
        </Text>
      </View>
      {error ? <Text style={{ fontSize: 14, color: colorSistema.rojo, textAlign: 'center' }}>{error}</Text> : null}
    </View>
  ), [hayMas, cargandoViejos, masViejo, vacio, preferente, fuera, horario, error, t, pedirAnteriores]);
  const verCalificar = !!conversacion?.puede_calificar && !calificarCerrado;
  const resuelta = conversacion?.estado === 'resuelta';
  const escribiendoNombre = vivo.escribiendo ? nombrePropio(vivo.escribiendo) : null;
  const encabezado = useMemo(() => (
    <View>
      {resuelta ? (
        <Text style={{ alignSelf: 'center', fontSize: 12, color: colorSistema.texto3, marginTop: 14, textAlign: 'center' }}>
          Consulta resuelta · escríbenos cuando quieras
        </Text>
      ) : null}
      {verCalificar ? <Calificar alEnviar={enviarCalificacion} alCerrar={alCerrarCalificar} /> : null}
      {escribiendoNombre ? <Escribiendo nombre={escribiendoNombre} /> : null}
    </View>
  ), [resuelta, verCalificar, escribiendoNombre, enviarCalificacion, alCerrarCalificar]);

  // Las opciones del título, ESTABLES (2026-10-15): `Stack.Screen` llama a
  // `setOptions` cada vez que recibe un objeto nuevo, y antes cada dibujo
  // —también cada sondeo— armaba uno con un `headerTitle` nuevo: la barra se
  // volvía a dibujar entera. Ahora cambian sólo si cambia lo que muestran.
  const atiendeNombre = vivo.atiende ? nombrePropio(vivo.atiende) : null;
  const conPreferencia = !!preferente;
  const abrirBuscar = useCallback(() => { Haptics.selectionAsync().catch(() => {}); Keyboard.dismiss(); setBuscar(true); }, []);
  // Vaciar el chat SÓLO en la app del cliente (PENDIENTES 29, 2026-10-29): la
  // farmacia sigue viendo la conversación; se borra de verdad a los 12 meses
  // sin mensajes. El servidor guarda desde dónde mostrar, así que vale también
  // en otro teléfono.
  const vaciar = useCallback(() => {
    Keyboard.dismiss();
    // Dos pasos (usuario, 2026-10-29: «que salga un aviso que no se puede
    // recuperar, no se borre de un solo»).
    const confirmar = () => Alert.alert('Esto no se puede deshacer', 'Los mensajes, fotos y audios no se podrán recuperar en tu app.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Vaciar chat', style: 'destructive', onPress: async () => {
        const r = await pedir('chat_vaciar');
        if (!r?.ok) { Alert.alert('No se vació', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
        setMensajes([]);
        setHayMas(false);
        // Vaciado, no queda qué calificar (el servidor tampoco lo vuelve a pedir).
        setConversacion((c) => (c ? { ...c, puede_calificar: false } : c));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } },
    ]);
    Alert.alert('¿Vaciar el chat?', 'Se quitarán todos los mensajes de tu app. La farmacia conserva la conversación.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Continuar', onPress: confirmar },
    ]);
  }, [pedir]);
  const opcionesTitulo = useMemo(() => ({ title: 'Farmacia Salud', headerTitle: () => (
    <TituloChat fuera={fuera} atiende={atiendeNombre} escribiendo={escribiendoNombre} preferente={conPreferencia} />
  ), headerRight: () => (
    <View style={{ flexDirection: 'row' }}>
      {/* Buscar en el chat y su galería (2026-10-20). */}
      <Presionable onPress={abrirBuscar} hitSlop={10} accessibilityRole="button" accessibilityLabel="Buscar en el chat, fotos y productos"
        style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Icono sf="magnifyingglass" respaldo="⌕" tam={18} color={t.color.magentaTexto} />
      </Presionable>
      <Presionable onPress={vaciar} hitSlop={10} accessibilityRole="button" accessibilityLabel="Vaciar el chat"
        style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Icono sf="trash" respaldo="🗑" tam={17} color={t.color.magentaTexto} />
      </Presionable>
    </View>
  ) }), [fuera, atiendeNombre, escribiendoNombre, conPreferencia, abrirBuscar, vaciar, t]);
  // El teclado en iOS, con transformaciones y no con el alto (ver «El teclado», al pie).
  const insAbajo = Math.max(ins.bottom, 8);
  const subida = useAnimatedStyle(() => ({ transform: [{ translateY: tecladoAlto ? -subidaConTeclado(tecladoAlto.value, insAbajo) : 0 }] }));
  // Lo que la subida esconde ARRIBA de la lista se recupera como margen del
  // desplazamiento (en la lista invertida, el «abajo» nativo es arriba en
  // pantalla): así los mensajes más viejos se siguen pudiendo leer con el
  // teclado abierto. Cambia una vez por apertura, no cuadro a cuadro.
  const [margenTeclado, setMargenTeclado] = useState(0);
  useEffect(() => {
    if (!IOS) return undefined;
    // Lo que el teclado TAPA (desde dónde empieza hasta abajo): un teclado
    // que se va también avisa un cambio de marco, con su alto pero fuera de
    // la pantalla.
    const poner = (e) => {
      const y = e?.endCoordinates?.screenY;
      const alto = Number.isFinite(y) ? Math.max(0, Dimensions.get('window').height - y) : (e?.endCoordinates?.height ?? 0);
      setMargenTeclado(Math.round(subidaConTeclado(alto, insAbajo)));
    };
    const a = Keyboard.addListener('keyboardWillShow', poner);
    const b = Keyboard.addListener('keyboardWillChangeFrame', poner);
    const c = Keyboard.addListener('keyboardWillHide', () => setMargenTeclado(0));
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [insAbajo]);
  const insetLista = useMemo(() => ({ top: 0, left: 0, right: 0, bottom: margenTeclado }), [margenTeclado]);

  if (pendiente) {
    return (
      <View style={{ flex: 1, padding: 16, paddingTop: IOS ? arriba + 8 : 16 }}>
        <Vacio titulo="Todavía no puedes escribirnos aquí" icono="bubble.left.and.bubble.right.fill" respaldo="💬">
          Cuando completes tu registro en cualquier sucursal podrás chatear con la farmacia desde la app.
        </Vacio>
      </View>
    );
  }
  const titulo = <Stack.Screen options={opcionesTitulo} />;
  // El esqueleto sólo la primera vez: con el hilo en memoria se pinta enseguida.
  if (mensajes == null) return <View style={{ flex: 1 }}>{titulo}<Esqueleto arriba={arriba} /></View>;
  // Los atajos: con la conversación vacía o justo después de la respuesta automática.
  const ultimo = mensajes[mensajes.length - 1];
  const conAtajos = !texto.trim() && !producto && !respondiendo && (!mensajes.length || (ultimo?.autor === 'sistema' && !ultimo.automatica));
  // Después de un mensaje del equipo, respuestas de un toque según lo que dijo (2026-10-20).
  const sugeridas = !texto.trim() && !producto && !respondiendo && !enviando ? respuestasSugeridas(ultimo) : [];

  // Tocar la cita lleva al mensaje original, si ya está cargado, y lo resalta.
  const irA = (id) => {
    const i = datos.findIndex((f) => f.m?.id === id);
    if (i < 0) return;
    alFondo.current = false;
    try { lista.current?.scrollToIndex({ index: i, viewPosition: 0.5, animated: true }); } catch { /* fuera de lo medido */ }
    setResaltado(id);
    setTimeout(() => setResaltado((x) => (x === id ? null : x)), 1400);
  };
  // Desde la búsqueda (2026-10-20): si el mensaje todavía no está cargado, se
  // traen semanas anteriores hasta encontrarlo (a lo sumo 12 vueltas).
  const irAlBuscado = async (m) => {
    setBuscar(false);
    let lista_ = mensajesRef.current ?? [];
    let mas = hayMas;
    for (let k = 0; k < 12 && !lista_.some((x) => x.id === m.id) && mas; k += 1) {
      const primero = lista_.find((x) => typeof x.id === 'number');
      if (!primero) break;
      const r = await pedir('chat_mensajes', { antes_id: primero.id, antes_de: primero.created_at });
      if (!r?.ok) break;
      mas = !!r.hay_mas;
      const vistos = new Set(lista_.map((x) => x.id));
      lista_ = [...r.mensajes.filter((x) => !vistos.has(x.id)), ...lista_];
    }
    setHayMas(mas);
    setMensajes(lista_);
    setTimeout(() => acciones.current.irA?.(m.id), 450);
  };
  anterioresRef.current = anteriores;
  calificarRef.current = calificar;
  cerrarCalificarRef.current = cerrarCalificar;
  acciones.current = {
    // Una foto abre el visor con TODAS las del hilo, empezando por ella.
    verFoto: (u) => {
      const fotos = (mensajesRef.current ?? []).filter((x) => x.foto_url).map((x) => fuenteFoto(x.foto_url, x.foto_clave));
      const i = Math.max(0, fotos.findIndex((f) => f.uri === u.uri));
      setVisor({ fotos: fotos.length ? fotos : [u], i: fotos.length ? i : 0 });
    },
    tocar: (m) => {
      if (m.fallido) { reintentar(m); return; }
      Haptics.selectionAsync().catch(() => {});
      setHoraDe((x) => (x === m.id ? null : m.id));
    },
    responder: responderA,
    menu: (m, caja) => setMenu({ m, caja }),
    reaccionar,
    irA,
  };

  return (
    <View style={{ flex: 1 }}>
      {titulo}
      {/* La lista empieza debajo de la barra de título (que es transparente
          sobre la aurora): nada pasa por detrás de ella. Con el teclado, la
          lista SUBE (transformación) dentro de esta caja, que la recorta debajo
          del título: nada pasa por detrás de él tampoco. */}
      <View style={{ flex: 1, marginTop: arriba, overflow: 'hidden' }}>
        <Animated.View style={[{ flex: 1 }, subida]}>
          <FlatList
            ref={lista}
            data={datos}
            inverted
            keyExtractor={claveDe}
            style={estiloLista}
            // Lo de la primera pantalla, no el hilo entero: el resto se dibuja al subir.
            initialNumToRender={Math.max(12, iNuevos + 4)}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            windowSize={9}
            // Android: las filas fuera de la ventana se sueltan del árbol nativo.
            // En iOS no: con la lista invertida recorta globos al volver a subir.
            removeClippedSubviews={!IOS}
            // Invertida: el relleno de ARRIBA de la pantalla es el de abajo del contenido.
            contentContainerStyle={CONTENIDO_LISTA}
            // La lista empieza debajo de la barra: no hay nada que iOS ajuste ni difumine.
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustKeyboardInsets={false}
            contentInset={insetLista}
            scrollIndicatorInsets={insetLista}
            // Con la lista abajo, lo que llega se ve; subida, no se mueve lo que se lee.
            maintainVisibleContentPosition={MANTENER_POSICION}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={alDesplazar}
            scrollEventThrottle={100}
            onContentSizeChange={alCambiarAlto}
            onScrollToIndexFailed={alFallarIndice}
            ListFooterComponent={pie}
            renderItem={renderItem}
            ListHeaderComponent={encabezado}
          />
          {/* Ir al final, con cuántas respuestas llegaron mientras se leía arriba. */}
          {lejos && listo ? <BotonAlFinal n={sinVer} alTocar={alFinal} /> : null}
        </Animated.View>
      </View>

      {/* La barra para escribir, como iMessage (componentes/ChatPiezas). */}
      <Compositor texto={texto} alEscribir={alEscribir} alEnviar={enviarBarra} alAdjuntar={adjuntar} enviando={enviando}
        campoRef={campo} listo={!!producto} tecladoAlto={tecladoAlto}
        voz={HAY_AUDIO && !editando ? { alEnviar: enviarNota } : null}
        encima={(
          <>
            {editando ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, paddingLeft: 10,
                borderLeftWidth: 3, borderLeftColor: t.color.magenta }}>
                <Icono sf="pencil" respaldo="✎" tam={14} color={t.color.magentaTexto} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Editando mensaje</Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: colorSistema.texto3 }}>{editando.texto}</Text>
                </View>
                <Presionable onPress={() => { setEditando(null); setTexto(''); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancelar la edición"
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Icono sf="xmark" respaldo="✕" tam={14} color={colorSistema.texto3} />
                </Presionable>
              </View>
            ) : null}
            {conAtajos ? <Sugerencias alElegir={atajo} /> : sugeridas.length ? <Sugerencias alElegir={atajo} lista={sugeridas} /> : null}
            {respondiendo ? <Respondiendo cita={respondiendo} alCancelar={() => setRespondiendo(null)} /> : null}
            {producto ? <ProductoPendiente p={producto} alQuitar={() => { Haptics.selectionAsync().catch(() => {}); setProducto(null); }} /> : null}
          </>
        )} />

      <BuscadorProducto visible={buscador} alElegir={elegirProducto} alCerrar={() => { preguntaDelAtajo.current = null; setBuscador(false); }}
        titulo={preguntaDelAtajo.current ? '¿Por cuál producto?' : 'Consultar un producto'} />
      <VisorFotos fotos={visor?.fotos} inicio={visor?.i ?? 0} alCerrar={() => setVisor(null)} />
      <BuscarEnChat visible={buscar} alCerrar={() => setBuscar(false)} alIr={irAlBuscado}
        alVerFotos={(fotos, i) => { setBuscar(false); setTimeout(() => setVisor({ fotos, i }), 450); }} />
      {foto.vista}
      {menu ? (
        <MenuMensaje menu={menu} alCerrar={() => setMenu(null)}
          alReaccionar={(e) => { const m = menu.m; setMenu(null); reaccionar(m, e); }}
          alResponder={() => { const m = menu.m; setMenu(null); responderA(m); }}
          alCopiar={() => {
            const m = menu.m; setMenu(null);
            if (copiar(m.texto)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
          alCopiarProducto={() => {
            const m = menu.m; setMenu(null);
            if (copiar(nombreProducto(m.adjunto?.nombre))) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
          alEditar={menu.m.autor === 'cliente' && menu.m.texto && !menu.m.borrado && Date.now() - Date.parse(menu.m.created_at) < EDITAR_MS
            ? () => { const m = menu.m; setMenu(null); editar(m); } : null}
          alBorrar={menu.m.autor === 'cliente' && !menu.m.borrado && Date.now() - Date.parse(menu.m.created_at) < BORRAR_MS
            ? () => { const m = menu.m; setMenu(null); borrar(m); } : null} />
      ) : null}
    </View>
  );
}

// El teclado (2026-10-15, antes `Pantalla`). En iOS la lista y la barra lo
// siguen cuadro a cuadro (`useAnimatedKeyboard`, también al bajarlo
// arrastrando la lista), pero con `translateY` y no con el ALTO: antes un
// `paddingBottom` animado volvía a medir la pantalla —y la lista— en cada
// cuadro de la animación. Ahora nada cambia de tamaño: la lista sube dentro
// de una caja que la recorta bajo el título, la barra sube con ella
// (`subidaConTeclado`, la MISMA cuenta en las dos) y lo que queda tapado
// arriba se recupera con `contentInset`. En Android la ventana ya se
// redimensiona sola (adjustResize) y no se hace nada.

// El título: la farmacia como un contacto — logo, nombre y, debajo, el estado.
function TituloChat({ fuera, atiende, escribiendo, preferente = false }) {
  const t = useTema();
  const estado = escribiendo ? `${escribiendo} está escribiendo…` : atiende ? `En línea · te atiende ${atiende}` : fuera ? 'Fuera de horario' : 'En línea';
  const activo = !!(escribiendo || atiende || !fuera);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 260 }} accessible accessibilityRole="header"
      accessibilityLabel={`Farmacia Salud. ${estado}${preferente ? '. Atención preferente' : ''}`}>
      <View>
        <Image source={require('../assets/icono.png')} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF' }} contentFit="cover" />
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2,
          borderColor: t.oscuro ? '#1C1C1E' : '#F2F2F7', backgroundColor: activo ? t.color.verde : colorSistema.texto3 }} />
      </View>
      <View style={{ flexShrink: 1, alignItems: 'flex-start' }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Farmacia Salud</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3}
            style={{ flexShrink: 1, fontSize: 12, fontWeight: '600', color: escribiendo ? t.color.magentaTexto : activo ? t.color.verdeTexto : colorSistema.texto3 }}>{estado}</Text>
          {/* Atención preferente (2026-10-14): Platino y Clientes Mayoristas. */}
          {preferente && !escribiendo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
              backgroundColor: t.oscuro ? 'rgba(233,237,245,0.14)' : 'rgba(20,22,28,0.08)' }}>
              <Icono sf="crown.fill" respaldo="👑" tam={9} color={colorSistema.texto2} />
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 10, fontWeight: '800', color: colorSistema.texto2 }}>Atención preferente</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// La conversación vacía: quién responde y qué se puede preguntar.
function Bienvenida({ preferente = null }) {
  const t = useTema();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingTop: 24, paddingBottom: 8, paddingHorizontal: 24 }}>
      <Image source={require('../assets/icono.png')} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFFFFF' }} contentFit="cover"
        accessibilityIgnoresInvertColors />
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>¿En qué te ayudamos?</Text>
      <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2, textAlign: 'center' }}>
        Pregúntanos si tenemos un medicamento, su precio, si necesita receta o por tus reservas. Te responde una persona del equipo de Farmacia Salud.
      </Text>
      {preferente ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
          backgroundColor: t.oscuro ? 'rgba(233,237,245,0.12)' : 'rgba(20,22,28,0.06)' }}>
          <Icono sf="crown.fill" respaldo="👑" tam={13} color={colorSistema.texto2} />
          <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: '600', color: colorSistema.texto2 }}>
            {preferente === 'mayorista' ? 'Como Cliente Mayorista' : 'Como cliente Platino'}, tu consulta se atiende primero.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icono sf="plus.circle.fill" respaldo="+" tam={14} color={t.color.magentaTexto} />
        <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Con «+» puedes enviar un producto o una foto de tu receta.</Text>
      </View>
    </View>
  );
}

// El día en píldora («Hoy», «Ayer», «martes», «3 de octubre») con la hora, o sólo la hora tras un hueco largo.
function Separador({ dia, hora }) {
  const t = useTema();
  return (
    <View style={{ alignItems: 'center', marginTop: 14, marginBottom: 6 }} accessible accessibilityRole="header"
      accessibilityLabel={dia ? `${dia}, ${hora}` : hora}>
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)' }}>
        {dia ? <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto2, textTransform: dia.length > 4 ? 'capitalize' : 'none' }}>{dia}</Text> : null}
        <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>{hora}</Text>
      </View>
    </View>
  );
}

// «3 mensajes nuevos», como la franja de WhatsApp antes del primero sin leer.
function FranjaNuevos({ n }) {
  const t = useTema();
  return (
    <View style={{ marginVertical: 10, marginHorizontal: -10, paddingVertical: 5, alignItems: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.16 : 0.09) }}
      accessible accessibilityRole="header" accessibilityLabel={`${n} ${n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: t.oscuro ? '#2C2C2E' : '#FFFFFF' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>{n === 1 ? '1 mensaje nuevo' : `${n} mensajes nuevos`}</Text>
      </View>
    </View>
  );
}

// El botón redondo para bajar al final, con lo que llegó mientras tanto.
function BotonAlFinal({ n, alTocar }) {
  const t = useTema();
  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ position: 'absolute', right: 12, bottom: 12 }}>
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} hitSlop={6} accessibilityRole="button"
        accessibilityLabel={n ? `Ir al final, ${n} ${n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : 'Ir al final'}
        style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.oscuro ? '#2C2C2E' : '#FFFFFF', transform: [{ scale: pressed ? 0.92 : 1 }],
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 })}>
        <Icono sf="chevron.down" respaldo="↓" tam={17} color={t.color.magentaTexto} />
      </Presionable>
      {n ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: -6, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
          alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta }}>
          <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{n > 99 ? '99+' : n}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

// Mientras carga: globos grises que respiran (quietos si se pide reducir el movimiento).
function Esqueleto({ arriba }) {
  const t = useTema();
  const reducir = useReducedMotion() || LIVIANO;
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reducir) o.value = withRepeat(withSequence(withTiming(0.45, { duration: 650 }), withTiming(1, { duration: 650 })), -1);
  }, [reducir, o]);
  const animado = useAnimatedStyle(() => ({ opacity: o.value }));
  const gris = t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
  const filas = [[false, 180], [false, 120], [true, 200], [false, 230], [true, 140], [true, 90]];
  return (
    <Animated.View style={[{ flex: 1, justifyContent: 'flex-end', paddingTop: arriba, paddingHorizontal: 12, paddingBottom: 100, gap: 6 }, animado]}
      accessible accessibilityLabel="Cargando la conversación">
      {filas.map(([mio, ancho], i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
          {!mio ? <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i === 1 || i === 3 ? gris : 'transparent' }} /> : null}
          <View style={{ width: ancho, height: 36, borderRadius: R, backgroundColor: mio ? suave(t.color.magenta, 0.25) : gris }} />
        </View>
      ))}
    </Animated.View>
  );
}

// «Ana está escribiendo…» con tres puntos que saltan (quietos si se pide
// reducir el movimiento o el teléfono es liviano).
function Escribiendo({ nombre }) {
  const t = useTema();
  const reducir = useReducedMotion() || LIVIANO;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 }} accessible accessibilityLiveRegion="polite"
      accessibilityLabel={`${nombre} está escribiendo`}>
      <View style={{ width: 28 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: R, paddingHorizontal: 14, height: 36,
        backgroundColor: globoEquipo(t.oscuro), alignSelf: 'flex-start' }}>
        {[0, 1, 2].map((i) => <Punto key={i} i={i} quieto={reducir} />)}
      </View>
    </View>
  );
}

function Punto({ i, quieto }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (quieto) { y.value = 0; return; }
    y.value = withDelay(i * 150, withRepeat(withSequence(withTiming(-4, { duration: 260 }), withTiming(0, { duration: 260 }), withTiming(0, { duration: 380 })), -1));
  }, [quieto, i, y]);
  const animado = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colorSistema.texto3 }, animado]} />;
}

// ✓ enviado, ✓✓ visto (en el color de la marca), como WhatsApp.
function Palomitas({ visto }) {
  const t = useTema();
  const color = visto ? t.color.magentaTexto : colorSistema.texto3;
  return (
    <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icono sf="checkmark" respaldo="✓" tam={11} color={color} />
      {visto ? <View style={{ marginLeft: -6 }}><Icono sf="checkmark" respaldo="✓" tam={11} color={color} /></View> : null}
    </View>
  );
}

// Un destello que se apaga: lo que acaba de llegar se nota sin estorbar.
function Destello({ color }) {
  const o = useSharedValue(1);
  useEffect(() => { o.value = withDelay(500, withTiming(0, { duration: 1300 })); }, [o]);
  const animado = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: -6, right: -6, top: -2, bottom: -2, borderRadius: 14, backgroundColor: color }, animado]} />;
}

// Un mensaje. Del cliente: a la derecha, en magenta. Del equipo: a la
// izquierda, con la foto (o las iniciales) en el último de la racha y el
// nombre arriba del primero. Del sistema: centrado, en gris.
// `memo` con acciones estables (`acc`): escribir, el «escribiendo…» del equipo
// o el sondeo cada 5 s ya no redibujan los globos que no cambiaron.
const Burbuja = memo(function Burbuja({ m, primero, ultimo, entra, estado, rotuloEstado, verHora, resaltado, nombreCitado, acc }) {
  const t = useTema();
  const alVerFoto = acc.verFoto;
  const alTocar = () => acc.tocar(m);
  const alResponder = () => acc.responder(m);
  const alMenu = (caja) => acc.menu(m, caja);
  const alReaccionar = (e) => acc.reaccionar(m, e);
  const alIrA = acc.irA;
  const reducir = useReducedMotion() || LIVIANO;
  const [ref, medir] = useMedir();
  const mio = m.autor === 'cliente';
  const real = typeof m.id === 'number';
  // Un fundido y nada más: en la lista invertida un deslizamiento se ve al revés.
  // Lo propio entra creciendo un poco (2026-10-20), como el globo que sale del
  // botón de enviar en Mensajes; lo del equipo, con el fundido y el destello.
  // Era un `ZoomIn` desde 0 con resorte de razón 0.52 —rebotaba—; desde el
  // 2026-10-21 crece de 0.9 con el resorte SUAVE (sin rebote a la vista).
  const entrada = entra && !reducir ? (m.autor === 'cliente' ? entradaPropia : FadeIn.duration(200)) : undefined;
  // La respuesta automática (2026-10-20): como un globo de la farmacia, con el
  // logo y «Respuesta automática» arriba, y el producto si lo trae.
  if (m.autor === 'sistema' && m.automatica) {
    return (
      <Animated.View entering={entrada} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: primero ? 10 : 2 }}>
        <View style={{ width: 28 }}>
          {ultimo ? <Image source={require('../assets/icono.png')} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF' }} contentFit="cover" /> : null}
        </View>
        <View style={{ maxWidth: '78%', gap: 4, alignItems: 'flex-start' }}>
          {primero ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 12 }}>
              <Icono sf="sparkles" respaldo="✦" tam={11} color={t.color.magentaTexto} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>Respuesta automática</Text>
            </View>
          ) : null}
          {m.adjunto?.tipo === 'producto' ? <TarjetaProducto a={m.adjunto} mio={false} /> : null}
          {m.texto ? (
            <View style={{ backgroundColor: globoEquipo(t.oscuro), borderRadius: R, paddingHorizontal: 13, paddingVertical: 8 }}>
              <TextoConEnlaces texto={m.texto} color={colorSistema.texto} colorEnlace={t.color.magentaTexto} estilo={{ fontSize: IOS ? 17 : 16, lineHeight: IOS ? 22 : 21 }} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    );
  }
  if (m.autor === 'sistema') {
    return (
      <Animated.View entering={entrada} style={{ alignSelf: 'center', maxWidth: '86%', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }}>
        <TextoConEnlaces texto={m.texto} color={colorSistema.texto2} colorEnlace={t.color.magentaTexto} estilo={{ fontSize: 13, lineHeight: 18, textAlign: 'center' }} />
      </Animated.View>
    );
  }
  // Borrado (2026-10-20): el globo queda, en gris y en cursiva.
  if (m.borrado) {
    return (
      <View style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', marginTop: primero ? 10 : 2, paddingLeft: mio ? 0 : 36 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: R,
          borderWidth: StyleSheet.hairlineWidth, borderColor: colorSistema.separador, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)' }}>
          <Icono sf="nosign" respaldo="⊘" tam={13} color={colorSistema.texto3} />
          <Text style={{ fontSize: 15, fontStyle: 'italic', color: colorSistema.texto3 }}>{mio ? 'Eliminaste este mensaje' : 'Se eliminó este mensaje'}</Text>
        </View>
      </View>
    );
  }
  const fondo = mio ? t.color.magenta : globoEquipo(t.oscuro);
  const colorTexto = mio ? '#FFFFFF' : colorSistema.texto;
  const nombre = m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud';
  // Esquinas de la racha: del lado del autor se juntan (chicas) salvo al
  // principio y al final; del otro lado, siempre grandes.
  const radios = mio
    ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: primero ? R : r, borderBottomRightRadius: ultimo ? R : r }
    : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: primero ? R : r, borderBottomLeftRadius: ultimo ? R : r };
  const hora = horaDe(m.created_at);
  const leyenda = `${mio ? 'Tú' : nombre}: ${m.texto ?? (m.foto_url ? 'Foto' : m.adjunto?.tipo === 'audio' ? 'Nota de voz' : m.adjunto?.tipo === 'pdf' ? 'Documento' : m.adjunto ? 'Producto' : '')}. ${hora}${mio && estado ? `. ${estado === 'visto' ? 'Visto' : 'Enviado'}` : ''}`;
  return (
    <Animated.View entering={entrada} style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8,
      marginTop: primero ? 10 : 2, borderRadius: 14, backgroundColor: resaltado ? suave(t.color.magenta, 0.14) : 'transparent' }}>
      {entra && !mio && !reducir ? <Destello color={suave(t.color.magenta, t.oscuro ? 0.16 : 0.1)} /> : null}
      {!mio ? (
        <View style={{ width: 28 }}>
          {ultimo ? (
            m.equipo?.foto_url ? (
              <Image source={fuenteFoto(m.equipo.foto_url, m.equipo.foto_clave)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colorSistema.separador }} contentFit="cover"
                cachePolicy="memory-disk" recyclingKey={m.equipo.foto_clave || m.equipo.foto_url} accessibilityLabel={`Foto de ${nombre}`} />
            ) : (
              <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.3 : 0.16) }}>
                <Text maxFontSizeMultiplier={1.1} style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>{iniciales(nombre)}</Text>
              </View>
            )
          ) : null}
        </View>
      ) : null}
      <View style={{ maxWidth: '78%', gap: 2, alignItems: mio ? 'flex-end' : 'flex-start' }}>
        {!mio && primero ? <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3, marginLeft: 12, marginBottom: 1 }}>{nombre}</Text> : null}
        {/* Deslizar a la derecha responde; mantener presionado abre el menú; tocar muestra la hora. */}
        <Deslizable alResponder={() => { if (real) alResponder(); }} alMantener={() => { if (real) medir(alMenu); }}>
          {/* `onLongPress` vacío: soltar después del menú no cuenta como toque. */}
          <Presionable ref={ref} collapsable={false} onPress={alTocar} onLongPress={() => {}} delayLongPress={350} accessibilityLabel={leyenda}
            accessibilityHint={m.fallido ? 'Toca para reintentar' : 'Mantén presionado para reaccionar, responder o copiar'}
            accessibilityActions={real ? [{ name: 'longpress', label: 'Más opciones' }, { name: 'magicTap', label: 'Responder' }] : undefined}
            onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'longpress') medir(alMenu); if (e.nativeEvent.actionName === 'magicTap') alResponder(); }}
            style={{ gap: 2, alignItems: mio ? 'flex-end' : 'flex-start', flexDirection: 'row' }}>
            {m.fallido ? (
              <View style={{ alignSelf: 'center', marginRight: 6 }}>
                <Icono sf="exclamationmark.circle.fill" respaldo="!" tam={20} color={colorSistema.rojo} />
              </View>
            ) : null}
            <View style={{ gap: 2, alignItems: mio ? 'flex-end' : 'flex-start', flexShrink: 1 }}>
              {m.responde_a && !m.texto ? (
                <View style={{ maxWidth: 260 }}><Cita c={m.responde_a} mio={false} nombreEquipo={nombreCitado} alTocar={() => alIrA(m.responde_a.id)} /></View>
              ) : null}
              {m.foto_url ? (
                <Presionable onPress={() => alVerFoto(fuenteFoto(m.foto_url, m.foto_clave))} accessibilityRole="imagebutton" accessibilityLabel="Ver foto">
                  <Image source={fuenteFoto(m.foto_url, m.foto_clave)} style={{ width: 210, height: 250, borderRadius: R, backgroundColor: colorSistema.separador, opacity: m.enviando ? 0.6 : 1 }}
                    contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={m.foto_clave || m.foto_url} />
                </Presionable>
              ) : null}
              {m.adjunto ? (m.adjunto.tipo === 'producto' ? <TarjetaProducto a={m.adjunto} mio={mio} />
                : m.adjunto.tipo === 'audio' ? <NotaDeVoz a={m.adjunto} mio={mio} />
                : m.adjunto.tipo === 'pdf' ? <Documento a={m.adjunto} mio={mio} />
                : <Oferta a={m.adjunto} />) : null}
              {m.texto ? (
                <View style={{ backgroundColor: fondo, ...radios, paddingHorizontal: 13, paddingVertical: 8, opacity: m.enviando ? 0.75 : 1,
                  ...(resaltado ? { borderWidth: 2, borderColor: mio ? '#FFFFFF' : t.color.magenta } : {}) }}>
                  {m.responde_a ? <Cita c={m.responde_a} mio={mio} nombreEquipo={nombreCitado} alTocar={() => alIrA(m.responde_a.id)} /> : null}
                  {/* Sin `selectable`: mantener presionado es el menú (con «Copiar»). */}
                  <TextoConEnlaces texto={m.texto} color={colorTexto} colorEnlace={mio ? '#FFFFFF' : t.color.magentaTexto}
                    estilo={{ fontSize: IOS ? 17 : 16, lineHeight: IOS ? 22 : 21 }} />
                </View>
              ) : null}
            </View>
          </Presionable>
        </Deslizable>
        <Reacciones lista={m.reacciones} mio={mio} alTocar={alReaccionar} />
        {m.fallido ? (
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.rojo, marginHorizontal: 6 }}>{m.dudoso ? 'Sin confirmar · toca para revisar' : 'No se envió · toca para reintentar'}</Text>
        ) : m.enviando ? (
          ultimo ? <Text style={{ fontSize: 11, color: colorSistema.texto3, marginHorizontal: 6 }}>Enviando…</Text> : null
        ) : ultimo || verHora ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 6 }}>
            {m.editado ? <Text style={{ fontSize: 11, color: colorSistema.texto3 }}>Editado ·</Text> : null}
            <Text style={{ fontSize: 11, color: colorSistema.texto3 }}>{hora}</Text>
            {mio && estado ? <Palomitas visto={estado === 'visto'} /> : null}
            {mio && rotuloEstado ? (
              <Text style={{ fontSize: 11, fontWeight: estado === 'visto' ? '600' : '400', color: estado === 'visto' ? t.color.magentaTexto : colorSistema.texto3 }}>
                {estado === 'visto' ? 'Visto' : 'Enviado'}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});

// Una oferta que mandó el equipo: se toca para abrirla.
function Oferta({ a }) {
  const t = useTema();
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); navegar(`/oferta/${a.id}`); };
  return (
    <Presionable onPress={abrir} accessibilityRole="button" accessibilityLabel={`Ver la oferta ${a.titulo}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: R, padding: 12, width: 248,
        backgroundColor: t.oscuro ? '#2C2C2E' : '#FFFFFF', borderWidth: 1, borderColor: suave(t.color.magenta, 0.35),
        transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
        <Icono sf="tag.fill" respaldo="%" tam={18} color={t.color.magentaTexto} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: colorSistema.texto3 }}>OFERTA</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={2}>{a.titulo}</Text>
      </View>
      <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
    </Presionable>
  );
}
