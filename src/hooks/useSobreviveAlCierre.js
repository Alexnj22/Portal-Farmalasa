import { useState } from 'react';

/**
 * El valor que un diálogo tiene que SEGUIR dibujando mientras SALE.
 *
 * ── El defecto que existe para evitar ──────────────────────────────────────
 * Casi todos los diálogos del portal sacan dos cosas del mismo estado: **si
 * están abiertos** y **qué muestran**.
 *
 *     <LiquidModal open={!!detalle}>
 *       <h3>{detalle?.empleado}</h3>
 *       <p>{detalle?.conexiones.length} conexiones abiertas</p>
 *
 * Al cerrar, ese estado pasa a `null` en el mismo tick, pero `ModalShell` sigue
 * montado ~240ms más haciendo su salida. O sea que el panel no se cierra: **se
 * vacía a la vista y después desaparece**. Reportado dos veces con las mismas
 * palabras —«se ve raro al cerrar»—: en la hoja de Filtros (v2.526.2) y en el
 * detalle de Conexiones, donde el encabezado alcanzaba a decir literalmente
 * «undefined conexiones abiertas» con el avatar vacío.
 *
 * ── Qué hace ───────────────────────────────────────────────────────────────
 * Devuelve el valor mientras haya, y el ÚLTIMO que hubo cuando pasa a nulo. El
 * `open` del diálogo sigue colgando del estado real —lo que cierra es el nulo—;
 * lo único que cambia es qué se dibuja mientras tanto.
 *
 *     const detalle  = abierta ? personas.find(...) : null;
 *     const visible  = useSobreviveAlCierre(detalle);
 *     <LiquidModal open={!!detalle}> … {visible?.empleado} …
 *
 * `BarraFlotante` resolvió lo mismo a mano recordando la clave del último panel
 * abierto. Sirve igual, pero obliga a que el valor tenga una clave y a repetir
 * el andamiaje en cada llamador; acá alcanza con envolver lo que ya se calcula.
 *
 * ── PASARLE UNA CLAVE, no un objeto que se reconstruye ─────────────────────
 * El ajuste va con `setState` durante el render —el patrón que React documenta
 * para «recordar algo del render anterior»; se re-ejecuta el componente antes
 * de pintar, así que no hay parpadeo ni render de más—. Pero **compara por
 * identidad**: si le pasás un objeto que el refresco de datos reconstruye cada
 * pocos segundos, cada refresco cuenta como un valor nuevo.
 *
 * Con un valor que se guarda una vez (lo que puso un clic) da igual. Con uno
 * DERIVADO de datos que se recargan, pasarle la clave y buscar después:
 *
 *     const ultimaAbierta  = useSobreviveAlCierre(abierta);      // un id
 *     const detalleVisible = personas.find(p => p.id === ultimaAbierta);
 *
 * Es lo mismo que hace `BarraFlotante` recordando la clave del último panel.
 */
export default function useSobreviveAlCierre(valor) {
    const [ultimo, setUltimo] = useState(valor);
    if (valor != null && !Object.is(valor, ultimo)) setUltimo(valor);
    return valor != null ? valor : ultimo;
}
