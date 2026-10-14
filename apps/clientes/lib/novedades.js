// El primer inicio y «Qué hay de nuevo» (2026-10-14).
//
//   · PRIMER INICIO (app/guia.js): cinco páginas que cuentan cómo funciona la
//     app. Sale UNA vez, después de la primera entrada o registro con éxito en
//     este teléfono — nunca a quien sólo mira sin cuenta. La marca vive en el
//     llavero (`puntos_salud_onboarding_v1`); si se cambia la guía a fondo y se
//     quiere volver a mostrar, se sube la versión de la clave.
//   · NOVEDADES (componentes/NovedadesHoja): una hoja chica con hasta tres
//     cosas nuevas, una vez por versión, DESPUÉS de una actualización. En una
//     instalación nueva no sale: para eso está el primer inicio.
//
// La versión instalada sale de `expo-application` (versión + compilación del
// binario). No está en el package.json de la app: llega con expo-notifications,
// que la necesita y la enlaza. Por eso va con `require` dentro de un try: si
// algún día falta, se cae a lo que dice expo-constants y nada revienta.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { create } from 'zustand';

let Aplicacion = null;
try { Aplicacion = require('expo-application'); } catch { Aplicacion = null; }

const CLAVE_GUIA = 'puntos_salud_onboarding_v1';
const CLAVE_VERSION = 'puntos_salud_version_vista';
const CLAVE_NOVEDAD = 'puntos_salud_novedad_vista';
const WEB = Platform.OS === 'web';

/**
 * Las novedades, la más nueva ARRIBA. `id` es lo que se recuerda como «ya
 * vista»; `desde` (opcional) es la compilación a partir de la cual se muestra,
 * POR PLATAFORMA — el número de compilación de iOS y el de Android no son el
 * mismo (los dos los sube EAS solo). Sin `desde`, vale para cualquier
 * compilación que la traiga. Hasta tres cosas: una hoja chica, no un folleto.
 * `sf` es el SF Symbol (iPhone y web; la hoja de Android va sin íconos).
 */
export const NOVEDADES = [
  {
    id: '2026-10-14',
    desde: { ios: null, android: null },
    titulo: 'Qué hay de nuevo',
    cosas: [
      { sf: 'bubble.left.and.bubble.right.fill', titulo: 'Chat con la farmacia',
        detalle: 'Pregúntanos por un medicamento, su precio o si lo tenemos. Te responde nuestro equipo.' },
      { sf: 'camera.fill', titulo: 'Tu receta con una foto',
        detalle: 'Si lo que apartas lleva receta, súbela desde la app y retíralo sin fila.' },
      { sf: 'creditcard.fill', titulo: 'Tarjeta Platino renovada',
        detalle: 'Un material nuevo para la tarjeta más alta, y el widget de tu pantalla de inicio ahora muestra tu nivel.' },
    ],
  },
];

/** La versión instalada, para comparar: «1.0.0 (31)». */
export function versionInstalada() {
  const app = Aplicacion?.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0';
  const build = Aplicacion?.nativeBuildVersion
    ?? (Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode)
    ?? '0';
  return { app: String(app), build: String(build), texto: `${app} (${build})` };
}

/** Las novedades que tocan en esta compilación (la más nueva que ya aplique). */
export function novedadesActuales() {
  const build = Number(versionInstalada().build) || 0;
  return NOVEDADES.find((n) => {
    const desde = n.desde?.[Platform.OS];
    return desde == null || build >= desde;
  }) ?? null;
}

const leer = (k) => (WEB ? Promise.resolve(null) : SecureStore.getItemAsync(k).catch(() => null));
const guardar = (k, v) => (WEB ? Promise.resolve() : SecureStore.setItemAsync(k, v).catch(() => {}));

/**
 * Qué se ve ahora encima de la app. `guia` / `novedades`: lo que ya toca
 * mostrar, y lo muestra la raíz en cuanto se ven las pestañas (no encima del
 * login ni del bloqueo). `forzada`: abierta a mano (Cuenta o el modo de
 * prueba), sin mirar las marcas.
 */
export const usePresentacion = create((set) => ({
  guiaPendiente: false,
  novedades: null,       // el objeto de NOVEDADES que se está mostrando
  novedadesPendientes: null,
  pedirGuia: () => set({ guiaPendiente: true }),
  guiaAbierta: () => set({ guiaPendiente: false }),
  abrirNovedades: (n = novedadesActuales()) => set({ novedades: n, novedadesPendientes: null }),
  dejarNovedadesPendientes: (n) => set({ novedadesPendientes: n }),
  cerrarNovedades: () => set({ novedades: null }),
}));

/** ¿Ya vio la guía en este teléfono? */
export async function guiaVista() {
  if (WEB) return true;
  return (await leer(CLAVE_GUIA)) === '1';
}

/** La guía se dio por vista (se marca al abrirla: si cierra la app a mitad, no vuelve). */
export async function marcarGuiaVista() {
  await guardar(CLAVE_GUIA, '1');
  // Quien acaba de ver la guía tampoco necesita las novedades de esta versión.
  const n = novedadesActuales();
  await guardar(CLAVE_VERSION, versionInstalada().texto);
  if (n) await guardar(CLAVE_NOVEDAD, n.id);
}

/**
 * Al abrir la app, una vez. `conSesion`: había sesión guardada al arrancar.
 *
 * Una instalación nueva no tiene la versión guardada NI sesión: se guarda y no
 * se muestra nada. Sin versión guardada pero CON sesión es alguien que ya
 * usaba la app antes de que existiera esto, o sea una actualización: sí. Y a
 * ésa persona no se le muestra después el primer inicio (ya conoce la app).
 */
export async function revisarAlAbrir(conSesion) {
  if (WEB) return;
  const actual = versionInstalada().texto;
  const guardada = await leer(CLAVE_VERSION);
  if (guardada === actual) return;
  await guardar(CLAVE_VERSION, actual);
  if (!conSesion) return;
  if (!(await guiaVista())) await guardar(CLAVE_GUIA, '1');
  const n = novedadesActuales();
  if (!n || (await leer(CLAVE_NOVEDAD)) === n.id) return;
  await guardar(CLAVE_NOVEDAD, n.id);
  usePresentacion.getState().dejarNovedadesPendientes(n);
}
