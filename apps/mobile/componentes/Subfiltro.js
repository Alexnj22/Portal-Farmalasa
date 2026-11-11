// El SUBFILTRO canónico (2026-11-11, usuario: «el de puntos / dólares es un
// sub filtro, ese sí queda; usa un selector de pill y no el nativo»).
//
// Dos niveles, dos formas, para que se distingan a simple vista:
//  - La SECCIÓN de la pantalla (Por cobrar · Pendientes · Bitácora) es el
//    control segmentado del sistema (`Segmentos`) y va FIJA arriba
//    (`FijoArriba`).
//  - El SUBFILTRO dentro de una sección (Todas · Con cobro · Sin cobro,
//    Puntos · Dólares, 7 · 30 · 90 días) son PÍLDORAS que se desplazan de lado
//    y se van con el contenido: no van fijas.
// Una elección dentro de un formulario («Efectivo · Tarjeta») no es ninguna de
// las dos y sigue siendo `Segmentos`.
//
// Misma firma que `Segmentos` ({ opciones, activa, onCambiar }); por dentro son
// las píldoras de `inicio/Pestanas` (vidrio en iOS, fichas de Material en
// Android). Con una sola opción no se dibuja.
import Pestanas from './inicio/Pestanas';

export default function Subfiltro({ opciones, activa, onCambiar }) {
  return <Pestanas opciones={opciones} activa={activa} onCambiar={onCambiar} />;
}
