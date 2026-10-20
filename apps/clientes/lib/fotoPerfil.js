// La foto de perfil, sin espera (2026-10-14, «la foto en Cuenta tarda en
// cargar»). El servidor la entrega FIRMADA y la firma cambia en cada pedido:
// para la caché de imágenes cada URL era una foto nueva, así que se bajaba
// entera cada vez que se abría Cuenta, y además recién DESPUÉS de esperar la
// respuesta de `perfil`.
//
// Ahora:
//   · la clave de caché es la RUTA del archivo en el almacenamiento (la URL
//     sin la firma). Cada foto subida es un archivo nuevo, así que la clave
//     cambia con la foto y no con la firma: la misma foto sale del disco;
//   · la última foto conocida se guarda en el teléfono (con el código del
//     cliente, para no mostrarle a otro la foto de quien usó antes el
//     teléfono) y se pinta al instante; `perfil` sólo la confirma;
//   · al llegar el resumen al arrancar, se pide `perfil` una vez y se precarga
//     la imagen, así al entrar a Cuenta ya está en memoria.
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import { create } from 'zustand';
import { useCuenta } from './cuenta';
import { useSesion } from './sesion';
import { subirFoto } from './fotos';

const CLAVE = 'puntos_salud_foto_perfil';

/** La URL firmada sin la firma: identifica al ARCHIVO, no al pedido. */
export function claveDeFoto(url) {
  if (!url) return null;
  return String(url).split('?')[0];
}

export const useFotoPerfil = create((set) => ({
  codigo: null,
  url: null,
  clave: null,
  quitada: false,
  poner: (codigo, f) => {
    const nuevo = { codigo, url: f.url ?? null, clave: claveDeFoto(f.url), quitada: !!f.quitada };
    set(nuevo);
    SecureStore.setItemAsync(CLAVE, JSON.stringify({ codigo, url: nuevo.url, clave: nuevo.clave })).catch(() => {});
    if (nuevo.url) precargar(nuevo.url, nuevo.clave);
  },
  olvidar: () => {
    set({ codigo: null, url: null, clave: null, quitada: false });
    SecureStore.deleteItemAsync(CLAVE).catch(() => {});
  },
}));

function precargar(uri, cacheKey) {
  // `loadAsync` respeta la `cacheKey` (el `prefetch` sólo conoce la URL y la
  // guardaría bajo la firma de hoy). Si falla, la vista la baja igual.
  try { Image.loadAsync({ uri, cacheKey }).catch(() => {}); } catch { /* sin precarga */ }
}

/** Lo que había guardado en el teléfono, si es de este cliente. */
async function leerGuardada(codigo) {
  try {
    const v = JSON.parse((await SecureStore.getItemAsync(CLAVE)) ?? 'null');
    if (v && v.codigo === codigo && v.url) {
      useFotoPerfil.setState({ codigo, url: v.url, clave: v.clave ?? claveDeFoto(v.url), quitada: false });
    }
  } catch { /* nada guardado */ }
}

// Para qué es la foto, en una línea (2026-10-20, «que explique de forma
// corta y concisa para qué se usa»): lo dicen igual el Inicio y Cuenta.
export const PARA_QUE_FOTO = 'Personaliza tu app. Sólo la ve el equipo de la farmacia cuando chateas con nosotros.';

/** Sube la foto elegida y la deja puesta. Devuelve la respuesta del servidor. */
export async function subirFotoPerfil(codigo, uri) {
  const pedir = useSesion.getState().pedir;
  const s = await subirFoto(pedir, 'perfil_subir_url', {}, uri);
  const r = s.ok ? await pedir('perfil_confirmar', { ruta: s.ruta }) : s;
  if (r?.ok) useFotoPerfil.getState().poner(codigo, { url: r.foto_url ?? uri, quitada: false });
  return r;
}

/** Pide `perfil` y deja la foto al día. Devuelve la respuesta del servidor. */
export async function refrescarFotoPerfil(codigo) {
  const r = await useSesion.getState().pedir('perfil');
  if (r?.ok) useFotoPerfil.getState().poner(codigo, { url: r.foto_url ?? null, quitada: !!r.quitada });
  return r;
}

// Al llegar el resumen (una vez por sesión y por cliente): lo guardado se pinta
// ya y se confirma con el servidor. Al cerrar sesión se olvida.
let pedidaPara = null;
let habia = false;
useCuenta.subscribe((e) => {
  const r = e.resumen;
  if (!r) {
    if (habia) { habia = false; pedidaPara = null; useFotoPerfil.getState().olvidar(); }
    return;
  }
  habia = true;
  if (r.pendiente || !r.codigo || pedidaPara === r.codigo) return;
  pedidaPara = r.codigo;
  leerGuardada(r.codigo).then(() => refrescarFotoPerfil(r.codigo)).catch(() => {});
});
