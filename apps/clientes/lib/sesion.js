// La sesión del cliente: un token en el llavero del teléfono (SecureStore).
// En la web —sólo para probar— cae a localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { olvidarSincronizacion } from './avisos';
import { llamar } from './api';
import { olvidarTodo } from './sinConexion';
import { useCarrito } from './carrito';
import { olvidarTomas } from './tomas';
import { olvidarVistos } from './catalogo';
import { useModoPrueba } from './prueba';

const CLAVE = 'puntos_salud_sesion';
// El ALCANCE de la sesión (2026-10-19): 'codigo' si se entró con el código de
// 7 letras del ticket (sólo puntos, saldo, tarjeta, nivel y ofertas), 'completo'
// con DUI y teléfono. Quien decide es el SERVIDOR (lista blanca en
// app-clientes); esto es sólo lo que la app sabe para no ofrecer lo que le
// van a negar, y se corrige solo con cada respuesta (`pedir`).
const CLAVE_ALCANCE = 'puntos_salud_alcance';
const ALCANCES = new Set(['codigo', 'completo']);

const almacenDe = (clave) => (Platform.OS === 'web'
  ? {
      leer: async () => { try { return localStorage.getItem(clave); } catch { return null; } },
      guardar: async (v) => { try { localStorage.setItem(clave, v); } catch { /* sin almacenamiento */ } },
      borrar: async () => { try { localStorage.removeItem(clave); } catch { /* idem */ } },
    }
  : {
      leer: () => SecureStore.getItemAsync(clave),
      guardar: (v) => SecureStore.setItemAsync(clave, v),
      borrar: () => SecureStore.deleteItemAsync(clave),
    });
const almacen = almacenDe(CLAVE);
const almacenAlcance = almacenDe(CLAVE_ALCANCE);

// El DUEÑO de lo que se queda en el teléfono (2026-11-04). Con la sesión
// vencida se conservan carrito, recordatorios de tomas y productos vistos —es
// la misma persona que vuelve a entrar—, pero en un teléfono compartido quien
// entraba después heredaba todo eso. Se guarda de quién es (el código de
// cliente que trae el resumen, `c:…`; un pre-registro sin código, `p:…`) y,
// al entrar, el primer resumen de la sesión nueva lo compara: si es otra
// persona, se vacía. Desde el token no se puede saber — el servidor no dice a
// quién pertenece al entrar —, por eso la comparación espera al resumen.
const almacenDueno = almacenDe('puntos_salud_dueno');
let dueno; // undefined = todavía no se leyó del llavero
const duenoDe = (r) => (r?.codigo ? `c:${r.codigo}` : r?.pendiente ? `p:${r.registrado_el ?? r.nombre ?? ''}` : null);

// Lo que vive en el teléfono y es de una persona: el carrito, los
// recordatorios de tomas (`olvidarTomas` vacía la configuración, el registro
// y los avisos programados) y los productos vistos.
async function olvidarLoDelTelefono() {
  useCarrito.getState().vaciar();
  await olvidarTomas();
  await olvidarVistos().catch(() => {});
}

async function revisarDueno(r) {
  const nuevo = duenoDe(r);
  if (!nuevo) return;
  if (dueno === undefined) dueno = (await almacenDueno.leer().catch(() => null)) || null;
  if (dueno === nuevo) return;
  // Sólo cuando los dos son del mismo tipo se puede afirmar que es OTRA
  // persona: el pre-registro que ya se vinculó pasa de `p:` a `c:` y sigue
  // siendo quien era.
  if (dueno && dueno[0] === nuevo[0]) await olvidarLoDelTelefono();
  dueno = nuevo;
  await almacenDueno.guardar(nuevo).catch(() => {});
}

// La lectura del llavero es asíncrona y las pantallas piden datos al montarse.
// Sin esperar a esa lectura, la primera llamada salía SIN token, el servidor
// contestaba «sin sesión» y la app borraba la sesión guardada: quien recargaba
// o volvía a abrir la app quedaba afuera. Por eso `pedir` espera esta promesa.
let lectura = null;

export const useSesion = create((set, get) => ({
  token: null,
  lista: false,
  alcance: null,
  // «Para ver esto, entra con tu DUI y teléfono» (2026-10-19): mientras se
  // completa la entrada, la sesión de código sigue abierta y la guardia deja
  // estar en «Entrar» con sesión.
  completando: false,

  cargar: () => {
    if (!lectura) {
      lectura = Promise.all([
        almacen.leer().catch(() => null),
        almacenAlcance.leer().catch(() => null),
      ]).then(([token, alcance]) => {
        set({ token: token || null, alcance: token && ALCANCES.has(alcance) ? alcance : null, lista: true });
      });
    }
    return lectura;
  },

  abrir: async (token, alcance = null) => {
    await almacen.guardar(token);
    const a = ALCANCES.has(alcance) ? alcance : null;
    if (a) await almacenAlcance.guardar(a).catch(() => {});
    else await almacenAlcance.borrar().catch(() => {});
    olvidarSincronizacion(); // la sesión nueva retoma los avisos del teléfono
    // Entrar de verdad termina la vista «entró con el código» del modo de prueba.
    useModoPrueba.getState().ponerDemo({ vistaCodigo: false });
    set({ token, alcance: a, completando: false, lista: true, motivoCierre: null });
  },

  /** Ir a completar la entrada con DUI y teléfono, sin cerrar la sesión de código. */
  completar: () => set({ completando: true }),
  dejarDeCompletar: () => set({ completando: false }),

  cerrar: async () => {
    await almacen.borrar().catch(() => {});
    await olvidarTodo();
    // El carrito vive en el teléfono (2026-10-12): en un teléfono compartido,
    // quien entra después heredaba lo que había agregado la cuenta anterior.
    // Si sólo venció la sesión, se supone la misma persona: el carrito se
    // queda —y el dueño también, para comprobarlo al volver a entrar
    // (`revisarDueno`, 2026-11-04)—.
    if (get().motivoCierre !== 'vencida') {
      // Los recordatorios de tomas, igual (2026-10-12): en un teléfono
      // compartido, a quien entra después no le suena la medicina del anterior.
      // Y los productos vistos: son de quien los buscó, no del teléfono.
      await olvidarLoDelTelefono();
      dueno = null;
      await almacenDueno.borrar().catch(() => {});
    }
    await almacenAlcance.borrar().catch(() => {});
    set({ token: null, alcance: null, completando: false });
  },

  /**
   * Llama a la función con la sesión. Si el servidor rechaza ESE token, la
   * sesión se cierra; si entretanto se abrió otra (o nunca hubo), no se toca.
   */
  pedir: async (accion, datos = {}) => {
    await get().cargar();
    const token = get().token;
    if (!token) return { ok: false, sinSesion: true, mensaje: 'Vuelve a entrar.' };
    const r = await llamar(accion, { ...datos, token });
    if (r?.sinSesion && get().token === token) { set({ motivoCierre: 'vencida' }); await get().cerrar(); }
    // ¿Es la misma persona dueña de lo que quedó en el teléfono? (2026-11-04)
    if (accion === 'resumen' && r?.ok && !r.sinConexion && get().token === token) await revisarDueno(r).catch(() => {});
    // El servidor dice el alcance en el resumen y al negar algo al código.
    const a = r?.motivo === 'requiere_documento' ? 'codigo' : r?.alcance;
    if (ALCANCES.has(a) && get().token === token && get().alcance !== a) {
      set({ alcance: a });
      almacenAlcance.guardar(a).catch(() => {});
    }
    return r;
  },
}));

export const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

/** ¿La sesión es de CÓDIGO (limitada)? Lo que no se sabe todavía cuenta como completa: el servidor igual lo niega. */
// Con el modo de prueba (2026-10-20) también se puede VER así sin serlo: el
// servidor sigue dando todo, pero la app se muestra como con el código.
export const useConCodigo = () => {
  const real = useSesion((s) => !!s.token && s.alcance === 'codigo');
  const demo = useModoPrueba((s) => s.cuentaDePrueba && s.vistaCodigo);
  return real || demo;
};
/** Lo que se le dice a quien entró con el código, en cualquier pantalla. */
export const MENSAJE_CODIGO = 'Para ver esto, entra con tu DUI y teléfono.';
