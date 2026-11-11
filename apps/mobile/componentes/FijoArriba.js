// LA FORMA CANÓNICA de las secciones de una pantalla (2026-11-11, usuario:
// «deja las pestañas siempre al top, fijas» y «debe estar en todo, debe ser
// canónico»): cuando un `Segmentos` cambia lo que muestra la pantalla
// (General · Comercial…, Pendientes · Aprobadas…), va FUERA de la lista, en
// `<FijoArriba>`, justo debajo de la barra, y lo de abajo se desplaza solo.
//
//   <>
//     <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Solicitudes' }} />
//     <FijoArriba><Segmentos … /></FijoArriba>
//     <ScrollView contentInsetAdjustmentBehavior="automatic">…</ScrollView>
//   </>
//
// Un `Segmentos` que es una elección DENTRO de un formulario o de una hoja
// («Efectivo · Tarjeta») no es una sección: se queda donde está.
//
// Un SUBFILTRO dentro de una sección (Todas · Con cobro · Sin cobro,
// Puntos · Dólares) tampoco va fijo, ni es el control del sistema: va con
// `Subfiltro` (píldoras) y se desplaza con el contenido. Ver
// `componentes/Subfiltro.js`.
//
// Una pantalla con secciones fijas NO lleva `headerLargeTitle`: el título
// grande de iOS sólo se encoge si la lista es lo primero de la pantalla; con
// esto encima se quedaría grande para siempre, comiéndose la pantalla.
//
// ── La barra con secciones fijas ────────────────────────────────────────────
// La pantalla usa `BARRA_FIJA` (componentes/PilaDePestana.js) en vez de
// `BARRA_NATIVA`: la misma barra sin fondo, pero la pantalla empieza DEBAJO de
// ella y del buscador, y el que la coloca es el sistema. El orden queda:
//
//   [ foto · logo · botones ]   ← la barra
//   [ buscador ]                ← en la barra
//   [ secciones ]               ← FijoArriba, 8 pt debajo
//   [ la lista ]                ← lo único que se desplaza
//
// Historia (2026-11-11): medir la barra desde JavaScript dejó el selector
// debajo de la barra (se tragaba los toques) y después pegado al buscador.
// Poner la barra opaca desde ACÁ (después del primer dibujo) la hacía cambiar
// dos veces al entrar y las secciones saltaban de abajo hacia arriba. Por eso
// va en las opciones de la pantalla, desde el principio.
//
// Por qué no `stickyHeaderIndices`: el encabezado pegajoso de React Native se
// pega al borde del ScrollView, que en iOS queda DETRÁS de la barra
// transparente, y el selector se escondía bajo el título.
//
// `conBarra` queda por compatibilidad (una hoja sin barra): ya no cambia nada.
import { View } from 'react-native';

// eslint-disable-next-line no-unused-vars
export default function FijoArriba({ children, conBarra = true }) {
  return <View style={{ paddingTop: 8, paddingBottom: 8 }}>{children}</View>;
}
