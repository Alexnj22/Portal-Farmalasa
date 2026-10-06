// El bloqueo con Face ID / Touch ID / huella. La sesión dura 180 días, así que
// esto NO es para entrar: es para que quien tome el teléfono desbloqueado no
// vea el saldo ni el código del cliente. Apagado por defecto.
//
// Se bloquea al abrir la app y al volver después de 30 s fuera. Si la
// biometría falla, el sistema ofrece el código del teléfono (no hay un PIN
// propio que olvidar).
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const CLAVE = 'puntos_salud_bloqueo';
const FUERA_MS = 30_000;
// Cuándo terminó la última hoja de Face ID (ver `vigilarCicloDeVida`).
let ultimoDesbloqueo = 0;
const nativo = Platform.OS === 'ios' || Platform.OS === 'android';

/** «Face ID», «Touch ID», «huella»… o null si el teléfono no tiene. */
export async function nombreBiometria() {
  if (!nativo) return null;
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const tipos = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return Platform.OS === 'ios' ? 'Face ID' : 'reconocimiento facial';
    if (tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return Platform.OS === 'ios' ? 'Touch ID' : 'huella';
    return 'biometría';
  } catch {
    return null;
  }
}

export async function verificar(motivo = 'Desbloquea Puntos Salud') {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: 'Cancelar' });
    return r.success;
  } catch {
    return false;
  }
}

export const useBloqueo = create((set, get) => ({
  activo: false,       // la persona lo encendió
  bloqueada: false,    // ahora mismo se ve la pantalla de bloqueo
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
    await SecureStore.setItemAsync(CLAVE, '1');
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
    set(ok ? { bloqueada: false, verificando: false } : { verificando: false });
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
  const sub = AppState.addEventListener('change', (estado) => {
    if (estado === 'background') { salio = Date.now(); return; }
    if (estado !== 'active') return;
    const fuera = salio ? Date.now() - salio : 0;
    salio = 0;
    if (Date.now() - ultimoDesbloqueo < 2_000) return;
    if (fuera > FUERA_MS) useBloqueo.getState().bloquearSiHaceFalta();
  });
  return () => sub.remove();
}
