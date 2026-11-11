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
// ── La barra con secciones fijas (2026-11-11, segunda vuelta) ──────────────
// En iOS la barra de marca es TRANSPARENTE (BARRA_NATIVA): la pantalla empieza
// detrás de ella y la lista se mete por debajo. Con un buscador además, la
// altura de la barra cambia (el campo aparece, se encoge al buscar) y ninguna
// medición desde JavaScript la sigue bien: primero el selector quedó debajo de
// la barra y se tragaba los toques; después, pegado al buscador
// (captura del usuario: «define cómo quedará cuando hay pestañas y hay
// buscador»).
//
// La forma definitiva: con secciones fijas la barra NO es transparente (sigue
// sin fondo, así que la aurora se ve igual): la pantalla empieza DEBAJO de la
// barra, buscador incluido, y el que la coloca es el sistema. El orden queda:
//
//   [ foto · logo · botones ]   ← la barra
//   [ buscador ]                ← en la barra, siempre visible (hideWhenScrolling: false)
//   [ secciones ]               ← FijoArriba, 8 pt debajo
//   [ la lista ]                ← lo único que se desplaza
//
// Esto lo pone FijoArriba solo (va después del `Stack.Screen` de la pantalla,
// así que sus opciones se aplican encima; y se reaplican en cada render porque
// la pantalla las vuelve a poner con las suyas). La medición queda como red,
// para la barra que siga siendo transparente.
//
// Por qué no `stickyHeaderIndices`: el encabezado pegajoso de React Native se
// pega al borde del ScrollView, que en iOS queda DETRÁS de la barra
// transparente, y el selector se escondía bajo el título.
//
// `conBarra={false}`: en una hoja o modal sin barra.
import { useCallback, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';

export default function FijoArriba({ children, conBarra = true }) {
  const alto = useHeaderHeight();
  const caja = useRef(null);
  const [tope, setTope] = useState(0);
  const medir = useCallback(() => {
    if (!conBarra) return;
    caja.current?.measureInWindow?.((_x, y) => {
      if (typeof y !== 'number') return;
      const falta = Math.max(0, Math.round(alto - y));
      setTope((t) => (Math.abs(t - falta) > 1 ? falta : t));
    });
  }, [alto, conBarra]);
  return (
    <>
      {conBarra && Platform.OS === 'ios'
        ? <Stack.Screen options={{ headerTransparent: false, headerStyle: { backgroundColor: 'transparent' }, headerShadowVisible: false }} />
        : null}
      <View ref={caja} onLayout={medir} collapsable={false}>
        <View style={{ paddingTop: (conBarra ? tope : 0) + 8, paddingBottom: 8 }}>
          {children}
        </View>
      </View>
    </>
  );
}
