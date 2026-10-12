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

// El mayoreo es SÓLO por la presentación cerrada (2026-10-12, condiciones de
// mayoreo; usuario: «si selecciono unidades, se pone el precio preferencial»):
// la de mayor `factor`, la caja. Unidades sueltas o blíster van a precio
// Preferente. El servidor ya no le pone `precio_tuyo` a las menores; esto es
// la red para lo que quedó guardado en el carrito con `factor_mayor`.
const mayoreoVale = (x) => x?.precio_tuyo != null && !(x.factor_mayor != null && (Number(x.factor) || 1) < Number(x.factor_mayor));

/** El factor de la caja: la presentación de mayor factor. */
export const factorDeCaja = (presentaciones) => Math.max(1, ...(presentaciones ?? []).map((x) => Number(x?.factor) || 1));

/** Las presentaciones con el mayoreo sólo en la caja (las demás, sin `precio_tuyo`). */
export const mayoreoSoloEnCaja = (presentaciones) => {
  const caja = factorDeCaja(presentaciones);
  return (presentaciones ?? []).map((x) => ((Number(x?.factor) || 1) === caja ? { ...x, factor_mayor: caja }
    : { ...x, factor_mayor: caja, precio_tuyo: null, precio_tuyo_nombre: null, precio_tuyo_sin_puntos: false }));
};

/** El precio que paga esta persona: el suyo de mayoreo (sólo la caja), el Preferente o el de viñeta. */
export const precioFinal = (x) => ((mayoreoVale(x) ? x.precio_tuyo : null) ?? x?.precio_vip ?? x?.precio ?? 0);

/** «Mayoreo» / «Mayoreo Plus»: sólo el nombre del precio (2026-10-12, pedido del usuario: sin «Tu precio»). */
export const rotuloPrecioTuyo = (x) => (mayoreoVale(x) ? (x.precio_tuyo_nombre ?? 'Mayoreo') : null);
