// Reglas y privacidad (2026-10-14, pedido del usuario: «que salgan las
// políticas y reglas ahí y no se pueda continuar hasta marcar como leído»).
//
// El primer inicio (app/guia.js) tiene una página con el Reglamento de Puntos
// Salud y el Aviso de privacidad, y no se pasa de ahí sin aceptar los dos. La
// aceptación se guarda en el SERVIDOR (`aceptar_documentos` →
// `app_cliente_aceptaciones`, con la versión de cada documento) y sólo después,
// como atajo, en el llavero del teléfono.
//
// Si un documento cambia de versión (DOCUMENTOS_VIGENTES en app-clientes), la
// app vuelve a pedir la aceptación: abre la guía en modo «sólo reglas».
//
// La revisión es barata: al abrir con sesión se lee `textos` (una lectura que
// ya existe y queda guardada sin conexión) y se compara con lo del llavero. Al
// servidor se le pregunta `documentos_estado` sólo si el llavero no sirve:
// otra sesión (otra cuenta en el mismo teléfono, o se volvió a entrar) o una
// versión nueva. Si no se puede saber —sin conexión, un servidor viejo— no se
// molesta a nadie.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { llamar } from './api';
import { plataforma, useSesion } from './sesion';
import { versionInstalada } from './novedades';

const CLAVE = 'puntos_salud_documentos_aceptados';
const WEB = Platform.OS === 'web';

/** `pendiente`: hay que pedir la aceptación (la raíz abre /guia?solo=reglas). */
export const useAceptacion = create((set) => ({
  pendiente: false,
  vigentes: null, // { reglamento, aviso } según el servidor
  marcarPendiente: (vigentes) => set({ pendiente: true, vigentes }),
  listo: (vigentes) => set((e) => ({ pendiente: false, vigentes: vigentes ?? e.vigentes })),
}));

// La sesión a la que pertenece lo guardado: el final del token. Así lo que
// aceptó una cuenta no vale para otra que entre después en el mismo teléfono.
const huella = (token) => (token ? String(token).slice(-16) : null);

const normal = (d) => (d?.reglamento && d?.aviso ? { reglamento: String(d.reglamento), aviso: String(d.aviso) } : null);

/** Las versiones vigentes según el servidor, o null si no se pudo saber. */
export async function documentosVigentes() {
  const r = await llamar('textos');
  return r?.ok ? normal(r.documentos) : null;
}

async function leerLocal() {
  if (WEB) return null;
  try { return JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null'); } catch { return null; }
}

async function guardarLocal(vigentes) {
  if (WEB) return;
  const token = useSesion.getState().token;
  await SecureStore.setItemAsync(CLAVE, JSON.stringify({ ...vigentes, sesion: huella(token) })).catch(() => {});
}

export const alDia = (aceptados, vigentes) => !!aceptados && !!vigentes
  && aceptados.reglamento === vigentes.reglamento && aceptados.aviso === vigentes.aviso;

/** ¿Lo aceptado en este teléfono vale para esta sesión y estas versiones? */
export async function aceptadoEnTelefono(vigentes) {
  const local = await leerLocal();
  return alDia(local, vigentes) && local.sesion === huella(useSesion.getState().token);
}

/** Lo último aceptado por ESTA sesión en este teléfono (sin mirar versiones), o null. */
export async function ultimaAceptacion() {
  const local = await leerLocal();
  return local && local.sesion === huella(useSesion.getState().token) ? normal(local) : null;
}

/**
 * Al abrir con sesión (o al entrar). Deja `pendiente` en true si hay que pedir
 * la aceptación. Nunca lanza.
 */
export async function revisarAceptacion() {
  if (WEB) return false;
  try {
    const vigentes = await documentosVigentes();
    if (!vigentes) return false; // sin forma de saberlo: no se molesta
    if (await aceptadoEnTelefono(vigentes)) { useAceptacion.getState().listo(vigentes); return false; }
    const r = await useSesion.getState().pedir('documentos_estado');
    if (!r?.ok) return false;
    const actuales = normal(r.documentos) ?? vigentes;
    if (r.aceptado) { await guardarLocal(actuales); useAceptacion.getState().listo(actuales); return false; }
    useAceptacion.getState().marcarPendiente(actuales);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarda la aceptación en el servidor y, SÓLO si quedó guardada, en el
 * teléfono. Devuelve `{ ok, mensaje?, documentos? }`; con `motivo: 'version'`
 * los documentos cambiaron mientras se leían y trae los vigentes.
 */
export async function aceptarDocumentos(vigentes) {
  const r = await useSesion.getState().pedir('aceptar_documentos', {
    reglamento_version: vigentes.reglamento,
    aviso_version: vigentes.aviso,
    plataforma,
    version_app: versionInstalada().texto,
  });
  if (!r?.ok) {
    return { ok: false, motivo: r?.motivo ?? null, documentos: normal(r?.documentos),
      mensaje: r?.mensaje ?? 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.' };
  }
  const actuales = normal(r.documentos) ?? vigentes;
  await guardarLocal(actuales);
  useAceptacion.getState().listo(actuales);
  return { ok: true, documentos: actuales };
}
