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
// opaca (Android, y las pantallas sin BARRA_NATIVA) la deja empezar debajo.
// Se MIDE: dónde quedó esto en la ventana contra dónde termina la barra
// (`useHeaderHeight`, que la pila nativa actualiza con lo que mide el sistema,
// buscador y título grande incluidos).
//
// ⚠️ NO usar `SafeAreaView` para esto (se probó el 2026-11-11 y salió mal): el
// de react-native-safe-area-context calcula el área segura contra el
// `SafeAreaProvider` de la raíz, que sólo conoce la barra de estado, no la
// barra de navegación. El selector quedaba montado DEBAJO de la barra
// transparente y la barra se tragaba los toques («quedan montadas de forma
// rara y no funcionan bien»).
//
// Como el ScrollView empieza debajo de esto, su
// `contentInsetAdjustmentBehavior="automatic"` ya no suma el margen de
// arriba: sólo el de la barra de pestañas de abajo.
//
// Por qué no `stickyHeaderIndices`: el encabezado pegajoso de React Native se
// pega al borde del ScrollView, que en iOS queda DETRÁS de la barra
// transparente, y el selector se escondía bajo el título.
//
// `conBarra={false}`: en una hoja o modal sin barra.
import { useCallback, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';

export default function FijoArriba({ children, conBarra = true }) {
  const alto = useHeaderHeight();
  const caja = useRef(null);
  // Primera suposición, antes de medir: en iOS casi todas las barras son transparentes.
  const [tope, setTope] = useState(conBarra && Platform.OS === 'ios' ? alto : 0);
  const medir = useCallback(() => {
    if (!conBarra) return;
    caja.current?.measureInWindow?.((_x, y) => {
      if (typeof y !== 'number') return;
      const falta = Math.max(0, Math.round(alto - y));
      setTope((t) => (Math.abs(t - falta) > 1 ? falta : t));
    });
  }, [alto, conBarra]);
  return (
    <View ref={caja} onLayout={medir} collapsable={false}>
      <View style={{ paddingTop: (conBarra ? tope : 0) + 8, paddingBottom: 8 }}>
        {children}
      </View>
    </View>
  );
}
