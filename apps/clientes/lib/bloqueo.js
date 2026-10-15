// El bloqueo con Face ID / Touch ID / huella. La sesión dura 180 días, así que
// esto NO es para entrar: es para que quien tome el teléfono desbloqueado no
// vea el saldo ni el código del cliente. Apagado por defecto.
//
// Se bloquea al abrir la app y al volver después de 30 s fuera. Si la
// biometría falla, el sistema ofrece el código del teléfono (no hay un PIN
// propio que olvidar).
//
// Android (2026-10-14, «en iPhone al abrir el selector de apps se bloquea; en
// Android no, hay que matar la app para que pida la huella»). Dos causas:
//   1. La regla era «30 s en segundo plano»; en Android la vuelta desde
//      Recientes casi siempre es antes, así que nunca se cumplía. Y lo que en
//      iPhone se VE como bloqueo al abrir el selector es la tapa (`soloCubrir`),
//      que se pone con el estado `inactive` — un estado que Android no emite:
//      pasa directo de `active` a `background`, y ya con la foto de Recientes
//      tomada.
//   2. Por eso en Android ahora se bloquea al pasar a segundo plano (sin
//      esperar) y la tapa se pone con el evento `blur` —la ventana pierde el
//      foco: Recientes, la cortina de notificaciones—, que llega antes de que
//      el sistema tome la foto.
// Para que eso no bloquee con cada diálogo del sistema, lo que la propia app
// abre (la cámara o la galería, la hoja de compartir, el pago, un permiso, la
// propia huella) va envuelto en `sinBloquear`: esa salida es «esperada» y no
// bloquea ni tapa — salvo que dure más de 5 minutos.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_bloqueo';
const FUERA_MS = 30_000;
const ANDROID = Platform.OS === 'android';
// Una salida esperada que dura más que esto bloquea igual al volver.
const ESPERADA_MAX_MS = 5 * 60_000;
// Salidas que abrió la propia app y que todavía no terminaron, y un margen
// después de terminar (la vuelta a `active` llega un instante más tarde).
let esperadas = 0;
let graciaHasta = 0;
const enGracia = () => esperadas > 0 || Date.now() < graciaHasta;

/**
 * Corre `fn` (una promesa o una función que la devuelve) avisando que la app
 * va a perder el primer plano A PROPÓSITO: el selector de fotos, la hoja de
 * compartir, el navegador del pago, un permiso, la huella. Mientras dura —y
 * 2 s después— salir y volver no bloquea ni tapa la pantalla.
 */
export async function sinBloquear(fn) {
  esperadas += 1;
  try {
    return await (typeof fn === 'function' ? fn() : fn);
  } finally {
    esperadas = Math.max(0, esperadas - 1);
    graciaHasta = Date.now() + 2_000;
  }
}
// Cuándo terminó la última hoja de Face ID (ver `vigilarCicloDeVida`).
let ultimoDesbloqueo = 0;
const nativo = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * El nombre de lo que el teléfono tiene REGISTRADO: «Face ID», «Touch ID»,
 * «huella», «reconocimiento facial» o «biométrico»; null si no hay ninguno
 * (entonces el interruptor ni aparece).
 *
 * Corregido el 2026-10-14: un Android con huella decía «reconocimiento facial»
 * porque muchos Android reportan el sensor de cara Y el de huella, y se
 * preguntaba primero por la cara. Ahora: si el teléfono reporta un solo tipo,
 * ése; si reporta varios (o ninguno conocido), el genérico «biométrico» — en
 * Android no hay forma de saber cuál registró la persona, y nombrar el que no
 * es confunde más que no nombrar ninguno.
 */
export async function nombreBiometria() {
  if (!nativo) return null;
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const T = LocalAuthentication.AuthenticationType;
    const tipos = [...new Set(await LocalAuthentication.supportedAuthenticationTypesAsync())];
    if (tipos.length === 1 && tipos[0] === T.FACIAL_RECOGNITION) return Platform.OS === 'ios' ? 'Face ID' : 'reconocimiento facial';
    if (tipos.length === 1 && tipos[0] === T.FINGERPRINT) return Platform.OS === 'ios' ? 'Touch ID' : 'huella';
    return 'biométrico';
  } catch {
    return null;
  }
}

/** Para escribir «con …»: «con Face ID», «con tu huella», «con biometría». */
export function conBiometria(nombre) {
  if (nombre === 'huella') return 'con tu huella';
  if (nombre === 'biométrico' || !nombre) return 'con biometría';
  return `con ${nombre}`;
}

/** Para el interruptor y la pantalla de bloqueo: «Face ID», «Huella», «Bloqueo biométrico»… */
export function rotuloBiometria(nombre) {
  if (nombre === 'huella') return 'tu huella';
  if (nombre === 'biométrico' || !nombre) return 'biometría';
  return nombre;
}

export async function verificar(motivo = 'Desbloquea Puntos Salud') {
  try {
    // La hoja de la huella o de la cara saca a la app del primer plano un
    // instante (en Android, `blur` y a veces `background`): no es «irse».
    const r = await sinBloquear(() => LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: 'Cancelar' }));
    // La vuelta de la hoja de Face ID no cuenta como «volver a la app».
    ultimoDesbloqueo = Date.now();
    return r.success;
  } catch {
    return false;
  }
}

export const useBloqueo = create((set, get) => ({
  activo: false,       // la persona lo encendió
  bloqueada: false,    // ahora mismo se ve la pantalla de bloqueo
  // La TAPA (ver `useCubierta`) vive en el store y no en el componente
  // (2026-10-14, «la burbuja del chat sale encima del bloqueo»): lo que flota
  // sobre las pantallas —la burbuja— tiene que saber que está puesta para
  // esconderse, sin preguntar a cada rato.
  cubierta: false,
  listo: false,
  cargar: async () => {
    if (!nativo) { set({ listo: true }); return; }
    const v = await SecureStore.getItemAsync(CLAVE).catch(() => null);
    set({ activo: v === '1', bloqueada: v === '1', listo: true });
  },
  /** Encender exige pasar la biometría una vez: así se sabe que funciona. */
  encender: async () => {
    const ok = await verificar('Confirma para activar el bloqueo');
    ultimoDesbloqueo = Date.now();
    if (!ok) return false;
    // Si el llavero no guarda, no se enciende (2026-10-12): antes la promesa
    // fallaba sin que nadie la atrapara.
    const guardado = await SecureStore.setItemAsync(CLAVE, '1').then(() => true).catch(() => false);
    if (!guardado) return false;
    set({ activo: true });
    return true;
  },
  apagar: async () => {
    await SecureStore.deleteItemAsync(CLAVE).catch(() => {});
    set({ activo: false, bloqueada: false });
  },
  // Una sola verificación a la vez: la pantalla de bloqueo la pide al
  // aparecer y el botón también; dos hojas de Face ID seguidas era lo que se
  // veía como «me la pide otra vez».
  verificando: false,
  desbloquear: async () => {
    if (get().verificando) return;
    set({ verificando: true });
    const ok = await verificar();
    // El propio Face ID saca la app de «activa» un instante. Esa vuelta no es
    // «la persona se fue»: se marca para que el vigilante no la cuente.
    ultimoDesbloqueo = Date.now();
    // Al desbloquear se quita también la tapa (2026-10-15). En Android la
    // pantalla de bloqueo es un <Modal> (componentes/PantallaBloqueo): al
    // aparecer le quitó el foco a la actividad (`blur` → tapa puesta) y el
    // `focus` que la quitaría no llega mientras el Modal sigue arriba — sin
    // esto, al desbloquear quedaba la tapa sin botón.
    set(ok ? { bloqueada: false, cubierta: false, verificando: false } : { verificando: false });
  },
  bloquearSiHaceFalta: () => { if (get().activo) set({ bloqueada: true }); },
}));

/**
 * Escucha el ciclo de la app: al volver tras 30 s EN SEGUNDO PLANO, se bloquea.
 *
 * Corregido el 2026-10-06 (probado en TestFlight: «pide Face ID aunque ya lo
 * desbloqueé varias veces»). La marca de salida nunca se borraba: después de
 * la primera vez que la app pasaba 30 s fuera, CUALQUIER vuelta a «activa» la
 * bloqueaba — bajar el centro de control, una notificación, y sobre todo la
 * hoja del propio Face ID, que la desactiva un instante. O sea: desbloquear
 * volvía a bloquear. Ahora la marca se consume al volver, sólo cuenta el
 * segundo plano de verdad, y la vuelta del Face ID se ignora.
 */
export function vigilarCicloDeVida() {
  let salio = 0;
  let esperada = false;
  const sub = AppState.addEventListener('change', (estado) => {
    if (estado === 'background') {
      salio = Date.now();
      // Se decide al SALIR: la promesa del selector o de compartir puede
      // terminar antes o después de la vuelta, y lo que importa es quién abrió.
      esperada = enGracia() || Date.now() - ultimoDesbloqueo < 2_000;
      // Android: se bloquea YA, así la vuelta desde Recientes encuentra la
      // pantalla de bloqueo y no el saldo (ver el encabezado).
      if (ANDROID && !esperada) useBloqueo.getState().bloquearSiHaceFalta();
      return;
    }
    if (estado !== 'active') return;
    const fuera = salio ? Date.now() - salio : 0;
    const fueEsperada = esperada;
    salio = 0;
    esperada = false;
    if (!fuera) return;
    if (fueEsperada && fuera < ESPERADA_MAX_MS) return;
    if (!fueEsperada && Date.now() - ultimoDesbloqueo < 2_000) return;
    if (ANDROID || fuera > FUERA_MS) useBloqueo.getState().bloquearSiHaceFalta();
  });
  return () => sub.remove();
}

/**
 * La TAPA (no el bloqueo): con el bloqueo encendido, mientras la app no está
 * en primer plano se pinta encima la pantalla de bloqueo sin botón, para que
 * la foto del selector de apps no muestre el saldo ni el QR. En iPhone basta
 * `inactive`; en Android hace falta `blur`, que llega ANTES de la foto de
 * Recientes (2026-10-14). Lo que la app abrió a propósito no se tapa.
 */
export function useCubierta(activo) {
  const cubierta = useBloqueo((s) => s.cubierta);
  useEffect(() => {
    const setCubierta = (v) => { if (useBloqueo.getState().cubierta !== v) useBloqueo.setState({ cubierta: v }); };
    if (!activo) { setCubierta(false); return undefined; }
    const subs = [AppState.addEventListener('change', (e) => setCubierta(e !== 'active' && !enGracia()))];
    if (ANDROID) {
      subs.push(AppState.addEventListener('blur', () => { if (!enGracia()) setCubierta(true); }));
      subs.push(AppState.addEventListener('focus', () => setCubierta(false)));
    }
    return () => { subs.forEach((x) => x.remove()); setCubierta(false); };
  }, [activo]);
  return cubierta;
}

/**
 * ¿Está la app tapada por el bloqueo? (2026-10-14) Bloqueada, con la tapa
 * puesta, o con el bloqueo todavía sin leer del llavero —en ese instante no se
 * sabe si hay que bloquear, y lo que flota no debe asomar antes que la
 * pantalla de bloqueo—. Lo usa la burbuja del chat.
 */
export function useTapadaPorBloqueo() {
  return useBloqueo((s) => s.bloqueada || s.cubierta || !s.listo);
}
