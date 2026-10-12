// El precio de mayoreo (2026-10-12). El catálogo es público, pero a quien le
// corresponde —cliente mayorista aprobado, o personal (Mayoreo Plus por
// política)— el servidor le devuelve UN precio más: `precio_tuyo`, con su
// nombre (`precio_tuyo_nombre`: «Mayoreo» o «Mayoreo Plus»). Para eso el
// catálogo se pide CON la sesión si la hay. Las listas nunca viajan crudas.
//
// Modo de prueba: la cuenta de prueba puede ver la app «como» mayorista. El
// precio sale del rango de muestra elegido en Cuenta (Jade/Zafiro → Mayoreo;
// Rubí/Diamante → Mayoreo Plus, igual que componentes/Mayorista.js) o de
// «Ver precios de mayoreo» si se eligió a mano. Sólo para mirar: al reservar
// el servidor cobra el precio real de la ficha.
import { useSesion } from './sesion';
import { useModoPrueba } from './prueba';

const PRECIO_DE_RANGO = { jade: 'mayoreo', zafiro: 'mayoreo', rubi: 'mayoreo_plus', diamante: 'mayoreo_plus' };

/** El precio de mayoreo que pide el modo de prueba, o null. */
export function precioDePrueba() {
  const p = useModoPrueba.getState();
  if (!p.activo) return null;
  if (p.precio === 'no') return null;
  if (p.precio === 'mayoreo' || p.precio === 'mayoreo_plus') return p.precio;
  return PRECIO_DE_RANGO[p.mayorista] ?? null;
}

/** Lo que se agrega a una consulta del catálogo: la sesión (si hay) y la prueba. */
export function datosDePrecio() {
  const token = useSesion.getState().token;
  const prueba = precioDePrueba();
  return { ...(token ? { token } : {}), ...(prueba ? { prueba_precio: prueba } : {}) };
}

/** El precio que paga esta persona: el suyo de mayoreo, el Preferente o el de viñeta. */
export const precioFinal = (x) => (x?.precio_tuyo ?? x?.precio_vip ?? x?.precio ?? 0);

/** «Tu precio Mayoreo» / «Tu precio Mayoreo Plus». */
export const rotuloPrecioTuyo = (x) => (x?.precio_tuyo != null ? `Tu precio ${x.precio_tuyo_nombre ?? 'Mayoreo'}` : null);
