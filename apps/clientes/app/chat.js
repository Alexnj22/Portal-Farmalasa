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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Text, View } from 'react-native';
import Presionable from '../componentes/Presionable';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
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
import { subirFoto } from '../lib/fotos';
import { nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { nombreProducto } from '../lib/catalogo';
import { datosDePrecio } from '../lib/precioTuyo';
import { LIVIANO } from '../lib/rendimiento';
import { usarVistaPreviaFoto } from '../componentes/VistaPreviaFoto';
import { Cita, Compositor, copiar, Deslizable, MenuMensaje, preguntarAdjunto, Reacciones, Respondiendo, useMedir } from '../componentes/ChatPiezas';
import { BuscadorProducto, Calificar, ProductoPendiente, Sugerencias, TarjetaProducto, TextoConEnlaces } from '../componentes/ChatConsultas';
import { suave, useTema } from '../tema/tema';

const IOS = Platform.OS === 'ios';
const CADA_MS = 5000;
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
  const pedir = useSesion((s) => s.pedir);
  const { producto: productoParam } = useLocalSearchParams();
  const [mensajes, setMensajes] = useState(null);
  const [hayMas, setHayMas] = useState(false);
  const [fuera, setFuera] = useState(fueraDeHorarioLocal());
  // El texto del horario lo arma el servidor con el horario REAL de las sucursales (2026-10-12).
  const [horario, setHorario] = useState(null);
  const [error, setError] = useState(null);
  const [pendiente, setPendiente] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargandoViejos, setCargandoViejos] = useState(false);
  const [fotoGrande, setFotoGrande] = useState(null);
  const lista = useRef(null);
  const campo = useRef(null);
  const ultimoId = useRef(0);
  const preguntando = useRef(0);
  const alFondo = useRef(true);
  const [vivo, setVivo] = useState(SIN_VIVO);
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
  const [nuevosDesde, setNuevosDesde] = useState(null); // { id, n }: la franja «N mensajes nuevos»
  const [lejos, setLejos] = useState(false);            // la lista está subida: se ve el botón ↓
  const [sinVer, setSinVer] = useState(0);              // llegaron con la lista subida
  const recien = useRef(new Set());                     // ids que entran con destello
  const [horaDe_, setHoraDe] = useState(null);          // el globo tocado muestra su hora
  const [producto, setProducto] = useState(null);       // { id, nombre, foto, precio } sobre la barra
  const [buscador, setBuscador] = useState(false);
  const preguntaDelAtajo = useRef(null);
  const [conversacion, setConversacion] = useState(null);
  const [calificarCerrado, setCalificarCerrado] = useState(false);
  const inicial = useRef(true);
  const [listo, setListo] = useState(false);
  const mensajesRef = useRef(null);
  mensajesRef.current = mensajes;

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
    const r = await pedir('chat_mensajes');
    if (r?.pendiente) { setPendiente(true); setMensajes([]); return; }
    if (!r?.ok) { setError(r?.mensaje ?? 'Revisa tu conexión.'); setMensajes((x) => x ?? []); return; }
    setError(null);
    setFuera(!!r.fuera_de_horario);
    if (r.horario) setHorario(r.horario);
    if ('vivo' in r) anotarVivo(r.vivo);
    if (r.conversacion) setConversacion(r.conversacion);
    setHayMas(!!r.hay_mas);
    anotarUltimo(r.mensajes);
    // La franja de lo nuevo se calcula ANTES de marcar leído (2026-10-13).
    if (r.sin_leer) setNuevosDesde(primeroSinLeer(r.mensajes, Number(r.sin_leer)));
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
      const r = await pedir('chat_mensajes', { desde_id: ultimoId.current });
      // Lo «en vivo» cambia aunque no haya mensajes nuevos.
      if (r?.ok && 'vivo' in r) anotarVivo(r.vivo);
      if (r?.ok && r.conversacion) setConversacion(r.conversacion);
      if (!r?.ok || !r.mensajes?.length) { if (r?.ok) setFuera(!!r.fuera_de_horario); return; }
      setFuera(!!r.fuera_de_horario);
      if (r.horario) setHorario(r.horario);
      anotarUltimo(r.mensajes);
      // Lo que de verdad es nuevo se cuenta contra lo que hay en pantalla (el
      // actualizador de `setMensajes` corre después, en el próximo render).
      const yaEstan = new Set((mensajesRef.current ?? []).map((m) => m.id));
      const frescos = r.mensajes.filter((m) => !yaEstan.has(m.id));
      for (const m of frescos) recien.current.add(m.id);
      const llegaron = frescos.filter((m) => m.autor !== 'cliente').length;
      setMensajes((ant) => {
        const vistos = new Set((ant ?? []).map((m) => m.id));
        return [...(ant ?? []), ...r.mensajes.filter((m) => !vistos.has(m.id))];
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
    if (mensajes == null) cargar(); else nuevos();
    // Un reloj que se reprograma solo: 3 s con el equipo activo, 5 s si no.
    let reloj = null;
    let vivoAca = true;
    const tic = async () => {
      await nuevos();
      if (vivoAca) reloj = setTimeout(tic, rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    };
    reloj = setTimeout(tic, rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    // Llegó el push de una respuesta: se pregunta ya, sin esperar los 5 s.
    const quitar = alLlegarAviso((a) => { if (typeof a.url === 'string' && a.url.startsWith('/chat')) nuevos(); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') nuevos(); });
    return () => {
      vivoAca = false; marcarChatALaVista(false); clearTimeout(reloj); quitar(); app.remove();
      // La franja «N mensajes nuevos» dura hasta salir de la pantalla.
      setNuevosDesde(null);
    };
  }, [cargar, nuevos])); // eslint-disable-line react-hooks/exhaustive-deps -- `mensajes` sólo decide la primera carga

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
    const r = await pedir('chat_mensajes', { antes_id: primero.id });
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
  const enviarYa = useRef(false);
  const mandar = async ({ texto: tx = null, uri = null, prod = null, cita = null, reemplaza = null }) => {
    if (enviarYa.current) return false;
    enviarYa.current = true;
    setEnviando(true);
    const tmp = { id: reemplaza ?? `tmp-${Date.now()}`, autor: 'cliente', texto: tx, foto_url: uri, created_at: new Date().toISOString(), enviando: true,
      adjunto: prod ? { tipo: 'producto', ...prod } : null,
      responde_a: cita ? { id: cita.id, autor: cita.autor, texto: cita.texto, foto: cita.foto } : null, reacciones: [] };
    alFondo.current = true;
    setSinVer(0);
    recien.current.add(tmp.id);
    setMensajes((ant) => (reemplaza ? (ant ?? []).map((m) => (m.id === reemplaza ? tmp : m)) : [...(ant ?? []), tmp]));
    try {
      let fotoRuta = null;
      if (uri) {
        const s = await subirFoto(pedir, 'chat_subir_url', {}, uri);
        if (!s.ok) throw new Error(s.mensaje);
        fotoRuta = s.ruta;
      }
      const r = await pedir('chat_enviar', { texto: tx, foto_ruta: fotoRuta, ...(cita ? { respuesta_a: cita.id } : {}), ...(prod ? { producto_id: prod.id } : {}) });
      if (!r?.ok) throw new Error(r?.mensaje ?? 'No se pudo enviar. Revisa tu conexión.');
      if (typeof r.fuera_de_horario === 'boolean') setFuera(r.fuera_de_horario);
      if (r.horario) setHorario(r.horario);
      if (r.conversacion) setConversacion(r.conversacion);
      anotarUltimo([r.mensaje]);
      recien.current.add(r.mensaje.id);
      setMensajes((ant) => {
        const sin = (ant ?? []).filter((m) => m.id !== r.mensaje.id && m.id !== r.automatico?.id).map((m) => (m.id === tmp.id ? r.mensaje : m));
        return r.automatico ? [...sin, r.automatico] : sin;
      });
      if (r.automatico) { anotarUltimo([r.automatico]); recien.current.add(r.automatico.id); }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return true;
    } catch (e) {
      setMensajes((ant) => (ant ?? []).map((m) => (m.id === tmp.id
        ? { ...m, enviando: false, fallido: e?.message ?? 'Revisa tu conexión.', reintento: { texto: tx, uri, prod, cita } } : m)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return false;
    } finally {
      enviarYa.current = false;
      setEnviando(false);
    }
  };
  const reintentar = (m) => {
    const elegir = (i) => {
      if (i === 0) mandar({ ...m.reintento, reemplaza: m.id });
      if (i === 1) setMensajes((ant) => (ant ?? []).filter((x) => x.id !== m.id));
    };
    const titulo = `No se envió: ${m.fallido}`;
    if (Platform.OS === 'web') {
      Alert.alert('No se envió', m.fallido, [{ text: 'Eliminar', style: 'destructive', onPress: () => elegir(1) }, { text: 'Reintentar', onPress: () => elegir(0) }]);
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
    const f = await foto.elegir({ origen });
    if (!f) return;
    const cita = respondiendo;
    setRespondiendo(null);
    await mandar({ uri: f.uri, cita });
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
  const nombreDe = (id) => {
    const x = (mensajes ?? []).find((y) => y.id === id);
    return x?.equipo?.nombre ? nombrePropio(x.equipo.nombre) : null;
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
    const misma = (a, b) => a && b && a.autor === b.autor && a.autor !== 'sistema' && !a.fallido && !b.fallido
      && (a.autor !== 'equipo' || a.equipo?.nombre === b.equipo?.nombre)
      && Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < RACHA_MS && !corta(a, b);
    mensajes.forEach((m, i) => {
      const d = diaDe(m.created_at);
      const previo = mensajes[i - 1];
      if (d !== dia) { dia = d; out.push({ clave: `d:${d}:${i}`, dia: d, hora: horaDe(m.created_at) }); }
      else if (previo && Date.parse(m.created_at) - Date.parse(previo.created_at) > HUECO_MS) out.push({ clave: `h:${i}`, hora: horaDe(m.created_at) });
      if (nuevosDesde && m.id === nuevosDesde.id) out.push({ clave: 'nuevos', nuevos: nuevosDesde.n });
      out.push({ clave: `m:${m.id}`, m, primero: !misma(previo, m), ultimo: !misma(m, mensajes[i + 1]), visto: i < ultimoEquipo });
    });
    return out;
  }, [mensajes, nuevosDesde]);

  // Al abrir: si hay franja de lo nuevo, la lista se abre ahí; si no, al final.
  // Hasta ubicarla no se muestra (sin el salto de arriba abajo).
  const ubicar = () => {
    if (!inicial.current) return;
    inicial.current = false;
    if (!filas.length) { setListo(true); return; }
    const i = filas.findIndex((f) => f.nuevos);
    if (i >= 0) {
      alFondo.current = false;
      setTimeout(() => {
        try { lista.current?.scrollToIndex({ index: i, viewPosition: 0.08, animated: false }); } catch { lista.current?.scrollToEnd({ animated: false }); }
        setTimeout(() => setListo(true), 60);
      }, 30);
    } else {
      lista.current?.scrollToEnd({ animated: false });
      setTimeout(() => setListo(true), 60);
    }
  };
  const alFinal = () => {
    alFondo.current = true;
    setSinVer(0);
    lista.current?.scrollToEnd({ animated: true });
  };

  if (pendiente) {
    return (
      <View style={{ flex: 1, padding: 16, paddingTop: IOS ? ins.top + 60 : 16 }}>
        <Vacio titulo="Todavía no puedes escribirnos aquí" icono="bubble.left.and.bubble.right.fill" respaldo="💬">
          Cuando completes tu registro en cualquier sucursal podrás chatear con la farmacia desde la app.
        </Vacio>
      </View>
    );
  }
  const titulo = (
    <Stack.Screen options={{ title: 'Farmacia Salud', headerTitle: () => (
      <TituloChat fuera={fuera} atiende={vivo.atiende ? nombrePropio(vivo.atiende) : null} escribiendo={vivo.escribiendo ? nombrePropio(vivo.escribiendo) : null} />
    ) }} />
  );
  const arriba = IOS ? ins.top + 52 : 0;
  if (mensajes == null) return <View style={{ flex: 1 }}>{titulo}<Esqueleto arriba={arriba} /></View>;

  // «Visto» / «Enviado» junto al último mensaje del cliente, si es lo último de
  // la conversación (los avisos del sistema no cuentan).
  const ultimoReal = [...mensajes].reverse().find((m) => m.autor !== 'sistema');
  const idConEstado = ultimoReal?.autor === 'cliente' && !ultimoReal.enviando && !ultimoReal.fallido ? ultimoReal.id : null;
  // Los atajos: con la conversación vacía o justo después de la respuesta automática.
  const ultimo = mensajes[mensajes.length - 1];
  const conAtajos = !texto.trim() && !producto && !respondiendo && (!mensajes.length || ultimo?.autor === 'sistema');
  const verCalificar = !!conversacion?.puede_calificar && !calificarCerrado;

  // Tocar la cita lleva al mensaje original, si ya está cargado, y lo resalta.
  const irA = (id) => {
    const i = filas.findIndex((f) => f.m?.id === id);
    if (i < 0) return;
    alFondo.current = false;
    try { lista.current?.scrollToIndex({ index: i, viewPosition: 0.4, animated: true }); } catch { /* fuera de lo medido */ }
    setResaltado(id);
    setTimeout(() => setResaltado((x) => (x === id ? null : x)), 1400);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={IOS ? 'padding' : undefined}>
      {titulo}
      <View style={{ flex: 1 }}>
        <FlatList
          ref={lista}
          data={filas}
          keyExtractor={(f) => f.clave}
          style={{ opacity: listo ? 1 : 0 }}
          initialNumToRender={80}
          contentContainerStyle={{ paddingTop: arriba + 8, paddingHorizontal: 10, paddingBottom: 12, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={({ nativeEvent: e }) => {
            const falta = e.contentSize.height - (e.layoutMeasurement.height + e.contentOffset.y);
            alFondo.current = falta < 80;
            if (alFondo.current && sinVer) setSinVer(0);
            const l = falta > 240;
            if (l !== lejos) setLejos(l);
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (inicial.current) { ubicar(); return; }
            if (alFondo.current) lista.current?.scrollToEnd({ animated: listo });
          }}
          // El teclado encoge la lista: si se estaba al final, se sigue al final.
          onLayout={() => { if (!inicial.current && alFondo.current) lista.current?.scrollToEnd({ animated: false }); }}
          onScrollToIndexFailed={(e) => {
            lista.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: false });
            setTimeout(() => {
              try { lista.current?.scrollToIndex({ index: e.index, viewPosition: 0.1, animated: false }); } catch { /* sin medir */ }
              setListo(true);
            }, 120);
          }}
          ListHeaderComponent={(
            <View style={{ gap: 10, marginBottom: 6 }}>
              {hayMas ? (
                <Presionable onPress={anteriores} disabled={cargandoViejos} accessibilityRole="button"
                  style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14 }}>
                  {cargandoViejos ? <Icono sf="clock" respaldo="…" tam={14} color={colorSistema.texto3} /> : null}
                  <Text style={{ fontSize: 15, fontWeight: '600', color: t.color.magentaTexto }}>{cargandoViejos ? 'Cargando…' : 'Ver mensajes anteriores'}</Text>
                </Presionable>
              ) : null}
              {!mensajes.length ? <Bienvenida /> : null}
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
          )}
          renderItem={({ item: f }) => {
            if (f.nuevos) return <FranjaNuevos n={f.nuevos} />;
            if (f.hora && !f.m) return <Separador dia={f.dia} hora={f.hora} />;
            const m = f.m;
            const entra = recien.current.has(m.id);
            return (
              <Burbuja m={m} primero={f.primero} ultimo={f.ultimo} alVerFoto={setFotoGrande} entra={entra}
                estado={m.autor === 'cliente' ? (m.id === idConEstado ? (vivo.visto ? 'visto' : 'enviado') : f.visto ? 'visto' : 'enviado') : null}
                rotuloEstado={m.id === idConEstado}
                verHora={horaDe_ === m.id}
                alTocar={() => {
                  if (m.fallido) { reintentar(m); return; }
                  Haptics.selectionAsync().catch(() => {});
                  setHoraDe((x) => (x === m.id ? null : m.id));
                }}
                resaltado={resaltado === m.id} nombreCitado={m.responde_a ? nombreDe(m.responde_a.id) : null}
                alResponder={() => responderA(m)} alMenu={(caja) => setMenu({ m, caja })}
                alReaccionar={(e) => reaccionar(m, e)} alIrA={irA} />
            );
          }}
          ListFooterComponent={(
            <View>
              {conversacion?.estado === 'resuelta' ? (
                <Text style={{ alignSelf: 'center', fontSize: 12, color: colorSistema.texto3, marginTop: 14, textAlign: 'center' }}>
                  Consulta resuelta · escríbenos cuando quieras
                </Text>
              ) : null}
              {verCalificar ? <Calificar alEnviar={calificar} alCerrar={cerrarCalificar} /> : null}
              {vivo.escribiendo ? <Escribiendo nombre={nombrePropio(vivo.escribiendo)} /> : null}
            </View>
          )}
        />
        {/* Ir al final, con cuántas respuestas llegaron mientras se leía arriba. */}
        {lejos && listo ? <BotonAlFinal n={sinVer} alTocar={alFinal} /> : null}
      </View>

      {/* La barra para escribir, como iMessage (componentes/ChatPiezas). */}
      <Compositor texto={texto} alEscribir={alEscribir} alEnviar={enviarBarra} alAdjuntar={adjuntar} enviando={enviando}
        campoRef={campo} listo={!!producto}
        encima={(
          <>
            {conAtajos ? <Sugerencias alElegir={atajo} /> : null}
            {respondiendo ? <Respondiendo cita={respondiendo} alCancelar={() => setRespondiendo(null)} /> : null}
            {producto ? <ProductoPendiente p={producto} alQuitar={() => { Haptics.selectionAsync().catch(() => {}); setProducto(null); }} /> : null}
          </>
        )} />

      <BuscadorProducto visible={buscador} alElegir={elegirProducto} alCerrar={() => { preguntaDelAtajo.current = null; setBuscador(false); }}
        titulo={preguntaDelAtajo.current ? '¿Por cuál producto?' : 'Consultar un producto'} />
      <Modal visible={!!fotoGrande} animationType="fade" transparent presentationStyle="overFullScreen" onRequestClose={() => setFotoGrande(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', paddingTop: ins.top + 8, paddingBottom: ins.bottom + 8 }}>
          <Presionable onPress={() => setFotoGrande(null)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}
            style={{ alignSelf: 'flex-end', paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>Cerrar</Text>
          </Presionable>
          {fotoGrande ? <Image source={{ uri: fotoGrande }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Foto" /> : null}
        </View>
      </Modal>
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
          }} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// El título: la farmacia como un contacto — logo, nombre y, debajo, el estado.
function TituloChat({ fuera, atiende, escribiendo }) {
  const t = useTema();
  const estado = escribiendo ? `${escribiendo} está escribiendo…` : atiende ? `En línea · te atiende ${atiende}` : fuera ? 'Fuera de horario' : 'En línea';
  const activo = !!(escribiendo || atiende || !fuera);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 260 }} accessible accessibilityRole="header"
      accessibilityLabel={`Farmacia Salud. ${estado}`}>
      <View>
        <Image source={require('../assets/icono.png')} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF' }} contentFit="cover" />
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2,
          borderColor: t.oscuro ? '#1C1C1E' : '#F2F2F7', backgroundColor: activo ? t.color.verde : colorSistema.texto3 }} />
      </View>
      <View style={{ flexShrink: 1, alignItems: 'flex-start' }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>Farmacia Salud</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3}
          style={{ fontSize: 12, fontWeight: '600', color: escribiendo ? t.color.magentaTexto : activo ? t.color.verdeTexto : colorSistema.texto3 }}>{estado}</Text>
      </View>
    </View>
  );
}

// La conversación vacía: quién responde y qué se puede preguntar.
function Bienvenida() {
  const t = useTema();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingTop: 24, paddingBottom: 8, paddingHorizontal: 24 }}>
      <Image source={require('../assets/icono.png')} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFFFFF' }} contentFit="cover"
        accessibilityIgnoresInvertColors />
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>¿En qué te ayudamos?</Text>
      <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2, textAlign: 'center' }}>
        Pregúntanos si tenemos un medicamento, su precio, si necesita receta o por tus reservas. Te responde una persona del equipo de Farmacia Salud.
      </Text>
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
        backgroundColor: t.oscuro ? '#26252A' : '#FFFFFF', alignSelf: 'flex-start' }}>
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
function Burbuja({ m, primero, ultimo, alVerFoto, entra, estado, rotuloEstado, verHora, alTocar, resaltado, nombreCitado, alResponder, alMenu, alReaccionar, alIrA }) {
  const t = useTema();
  const reducir = useReducedMotion() || LIVIANO;
  const [ref, medir] = useMedir();
  const mio = m.autor === 'cliente';
  const real = typeof m.id === 'number';
  const entrada = entra && !reducir ? FadeInDown.duration(240) : undefined;
  if (m.autor === 'sistema') {
    return (
      <Animated.View entering={entrada} style={{ alignSelf: 'center', maxWidth: '86%', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }}>
        <TextoConEnlaces texto={m.texto} color={colorSistema.texto2} colorEnlace={t.color.magentaTexto} estilo={{ fontSize: 13, lineHeight: 18, textAlign: 'center' }} />
      </Animated.View>
    );
  }
  const fondo = mio ? t.color.magenta : (t.oscuro ? '#26252A' : '#FFFFFF');
  const colorTexto = mio ? '#FFFFFF' : colorSistema.texto;
  const nombre = m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud';
  // Esquinas de la racha: del lado del autor se juntan (chicas) salvo al
  // principio y al final; del otro lado, siempre grandes.
  const radios = mio
    ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: primero ? R : r, borderBottomRightRadius: ultimo ? R : r }
    : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: primero ? R : r, borderBottomLeftRadius: ultimo ? R : r };
  const hora = horaDe(m.created_at);
  const leyenda = `${mio ? 'Tú' : nombre}: ${m.texto ?? (m.foto_url ? 'Foto' : m.adjunto ? 'Producto' : '')}. ${hora}${mio && estado ? `. ${estado === 'visto' ? 'Visto' : 'Enviado'}` : ''}`;
  return (
    <Animated.View entering={entrada} style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8,
      marginTop: primero ? 10 : 2, borderRadius: 14, backgroundColor: resaltado ? suave(t.color.magenta, 0.14) : 'transparent' }}>
      {entra && !mio && !reducir ? <Destello color={suave(t.color.magenta, t.oscuro ? 0.16 : 0.1)} /> : null}
      {!mio ? (
        <View style={{ width: 28 }}>
          {ultimo ? (
            m.equipo?.foto_url ? (
              <Image source={{ uri: m.equipo.foto_url }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colorSistema.separador }} contentFit="cover"
                accessibilityLabel={`Foto de ${nombre}`} />
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
          <Presionable ref={ref} collapsable={false} onPress={alTocar} onLongPress={() => {}} delayLongPress={380} accessibilityLabel={leyenda}
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
                <Presionable onPress={() => alVerFoto(m.foto_url)} accessibilityRole="imagebutton" accessibilityLabel="Ver foto">
                  <Image source={{ uri: m.foto_url }} style={{ width: 210, height: 250, borderRadius: R, backgroundColor: colorSistema.separador, opacity: m.enviando ? 0.6 : 1 }}
                    contentFit="cover" transition={150} />
                </Presionable>
              ) : null}
              {m.adjunto ? (m.adjunto.tipo === 'producto' ? <TarjetaProducto a={m.adjunto} mio={mio} /> : <Oferta a={m.adjunto} />) : null}
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
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.rojo, marginHorizontal: 6 }}>No se envió · toca para reintentar</Text>
        ) : m.enviando ? (
          ultimo ? <Text style={{ fontSize: 11, color: colorSistema.texto3, marginHorizontal: 6 }}>Enviando…</Text> : null
        ) : ultimo || verHora ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 6 }}>
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
}

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
