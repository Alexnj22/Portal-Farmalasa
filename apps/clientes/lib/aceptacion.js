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
//
// También en el NAVEGADOR (2026-11-14): antes la web nunca pedía aceptar, ni
// la primera vez ni con una versión nueva. El llavero allá es localStorage
// (entrada.web.js) y el servidor sigue siendo el que manda.
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { llamar } from './api';
import { plataforma, useSesion } from './sesion';
import { versionInstalada } from './novedades';

const CLAVE = 'puntos_salud_documentos_aceptados';

/** `pendiente`: hay que pedir la aceptación (la raíz abre /guia?solo=reglas). */
export const useAceptacion = create((set) => ({
  pendiente: false,
  vigentes: null, // { reglamento, aviso } según el servidor
  marcarPendiente: (vigentes) => set({ pendiente: true, vigentes }),
  listo: (vigentes) => set((e) => ({ pendiente: false, vigentes: vigentes ?? e.vigentes })),
}));

// Al cerrar sesión, lo pendiente se olvida (2026-11-04): quedaba en true, y
// quien entraba después —con sus documentos ya aceptados— caía igual en la
// guía «sólo reglas» por lo que le faltaba a la cuenta anterior. La próxima
// sesión lo vuelve a revisar con `revisarAceptacion`.
useSesion.subscribe((s, antes) => {
  if (antes.token && !s.token) useAceptacion.setState({ pendiente: false, vigentes: null });
});

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
  try { return JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null'); } catch { return null; }
}

async function guardarLocal(vigentes) {
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

// Lo que el servidor sabe de ESTA cuenta (2026-11-16, pedido del usuario: «no
// tiene sentido que acepte todo, me muestre que subí de nivel y demás cuando
// ya lo sé y ya lo acepté»). La guía, el «Tu nivel» y la bienvenida de mayoreo
// se recuerdan por equipo; entrar en otro navegador o teléfono los repetía
// todos, y la guía pedía otra vez el reglamento ya aceptado. Una consulta por
// sesión, compartida: la piden la raíz, la guía y SubisteDeNivel.
let estadoCache = { huella: null, promesa: null };

/**
 * `{ aceptado, conocida, documentos }` de `documentos_estado`, o null si no se
 * pudo saber (sin conexión, servidor viejo). `conocida`: la cuenta ya aceptó
 * alguna versión antes, en cualquier equipo. Nunca lanza.
 */
export function estadoDeCuenta() {
  const h = huella(useSesion.getState().token);
  if (!h) return Promise.resolve(null);
  if (estadoCache.huella !== h || !estadoCache.promesa) {
    const promesa = useSesion.getState().pedir('documentos_estado')
      .then((r) => (r?.ok ? { aceptado: !!r.aceptado, conocida: r.conocida === true, documentos: normal(r.documentos) } : null))
      .catch(() => null)
      .then((e) => { if (!e && estadoCache.promesa === promesa) estadoCache = { huella: null, promesa: null }; return e; });
    estadoCache = { huella: h, promesa };
  }
  return estadoCache.promesa;
}

/** ¿Esta cuenta ya pasó por la bienvenida en algún equipo? false si no se sabe. */
export async function cuentaConocida() {
  return (await estadoDeCuenta())?.conocida === true;
}

/**
 * Al abrir con sesión (o al entrar). Deja `pendiente` en true si hay que pedir
 * la aceptación. Nunca lanza.
 */
export async function revisarAceptacion() {
  try {
    const vigentes = await documentosVigentes();
    if (!vigentes) return false; // sin forma de saberlo: no se molesta
    if (await aceptadoEnTelefono(vigentes)) { useAceptacion.getState().listo(vigentes); return false; }
    const r = await estadoDeCuenta();
    if (!r) return false;
    const actuales = r.documentos ?? vigentes;
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
  estadoCache = { huella: null, promesa: null };
  await guardarLocal(actuales);
  useAceptacion.getState().listo(actuales);
  return { ok: true, documentos: actuales };
}
