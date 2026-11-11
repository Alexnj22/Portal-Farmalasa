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
// ── Cuánto bajar ────────────────────────────────────────────────────────────
// Depende de la barra: la transparente (BARRA_NATIVA, las pestañas y casi
// todas las pantallas de iOS) deja la pantalla empezar DETRÁS de ella; la
// opaca (Android, y las pantallas sin BARRA_NATIVA) la deja empezar debajo. Y
// encima la barra crece con el buscador (`headerSearchBarOptions`).
// `useHeaderHeight` no siempre cuenta el buscador, así que no se calcula: lo
// dice el SISTEMA con el área segura de ESTA vista (`SafeAreaView` nativo de
// react-native-safe-area-context, borde de arriba), que es exactamente lo que
// la barra le tapa — barra, buscador y título, transparente u opaca.
//
// Como el ScrollView empieza debajo de esto, su
// `contentInsetAdjustmentBehavior="automatic"` ya no suma el margen de
// arriba: sólo el de la barra de pestañas de abajo.
//
// Por qué no `stickyHeaderIndices`: el encabezado pegajoso de React Native se
// pega al borde del ScrollView, que en iOS queda DETRÁS de la barra
// transparente, y el selector se escondía bajo el título.
//
// `conBarra={false}`: en una hoja o modal sin barra, sin área segura.
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function FijoArriba({ children, conBarra = true }) {
  const cuerpo = <View style={{ paddingTop: 8, paddingBottom: 8 }}>{children}</View>;
  if (!conBarra) return cuerpo;
  return <SafeAreaView edges={['top']} mode="padding">{cuerpo}</SafeAreaView>;
}
