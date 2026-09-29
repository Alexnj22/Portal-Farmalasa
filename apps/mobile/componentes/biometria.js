// Entrar con Face ID / Touch ID / huella (pedido del usuario del 2026-09-29).
//
// Qué se guarda: usuario y contraseña en el LLAVERO del teléfono, con acceso
// atado a la biometría (`requireAuthentication`) y sólo en ESTE aparato, y
// sólo si el teléfono tiene código. Leerlas exige la cara o la huella: el
// sistema lo pide, la app nunca ve la biometría.
//
// Por qué la contraseña y no la sesión: el portal cierra la sesión sola por
// inactividad (a los de sala a los 5 minutos) y ese cierre la invalida. Con la
// sesión guardada, Face ID serviría sólo hasta el primer cierre; con las
// credenciales, entra por el MISMO `loginWithUsername` que la pantalla, con sus
// mismos controles (cuenta dada de baja, contraseña cambiada, candado). Si la
// contraseña cambió, el intento falla, se olvida lo guardado y se pide de nuevo.
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const CREDENCIALES = 'biometria.credenciales';
const ACTIVA = 'biometria.activa';
const NO_PREGUNTAR = 'biometria.no-preguntar';

/** El nombre que el sistema le da: «Face ID», «Touch ID» o «huella». */
export async function nombreBiometria() {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return null;
    const tipos = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (tipos.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
    if (tipos.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Touch ID';
    return 'biometría';
  } catch {
    return null;
  }
}

export async function biometriaActiva() {
  try { return (await SecureStore.getItemAsync(ACTIVA)) === '1'; } catch { return false; }
}

export async function yaSePregunto() {
  try { return (await SecureStore.getItemAsync(NO_PREGUNTAR)) === '1'; } catch { return false; }
}

export async function noVolverAPreguntar() {
  try { await SecureStore.setItemAsync(NO_PREGUNTAR, '1'); } catch { /* sin llavero: se vuelve a preguntar */ }
}

/** Guarda las credenciales detrás de la biometría. Devuelve si quedó activa. */
export async function activarBiometria(usuario, clave) {
  try {
    await SecureStore.setItemAsync(CREDENCIALES, JSON.stringify({ usuario, clave }), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
      authenticationPrompt: 'Confirma para guardar tu acceso',
    });
    await SecureStore.setItemAsync(ACTIVA, '1');
    return true;
  } catch {
    return false;
  }
}

/** Pide la cara o la huella y devuelve `{ usuario, clave }`, o null si no se pudo. */
export async function leerConBiometria() {
  try {
    const crudo = await SecureStore.getItemAsync(CREDENCIALES, {
      requireAuthentication: true,
      authenticationPrompt: 'Entrar a Farmalasa',
    });
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;   // canceló, falló, o la biometría del teléfono cambió
  }
}

export async function olvidarBiometria() {
  await Promise.all([CREDENCIALES, ACTIVA].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}
