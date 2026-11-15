// En el navegador (2026-11-14): lo que va a los lados del encabezado —la foto,
// la campana— y la burbuja del chat se alinean con la COLUMNA del contenido
// (560 px de ancho con 16 de relleno, componentes/ui.js), no con la orilla de
// la ventana. En una computadora la ventana mide 1400 px y quedaban a medio
// metro de la tarjeta; en un teléfono el margen sigue siendo 16.
import { Platform, useWindowDimensions, View } from 'react-native';

const COLUMNA = 560;
const RELLENO = 16;

export function useMargenLateral() {
  const { width } = useWindowDimensions();
  return Math.max(RELLENO, (width - COLUMNA) / 2 + RELLENO);
}

// El margen de 16 de los lados del encabezado en la web (en el teléfono lo da
// el sistema). Lo que falta para llegar a la columna en la computadora lo pone
// lib/documentoWeb (`alinearEncabezados`), en TODOS los encabezados.
export function AlLado({ lado, children }) {
  const m = RELLENO;
  return <View style={lado === 'izq' ? { marginLeft: m } : { marginRight: m }}>{children}</View>;
}

// Los avisos de abajo («agregado», «quitaste…», «aviso borrado») y las
// barras fijas de abajo, en el navegador (2026-11-14, «corrige todos los
// toast de la app web»): del ancho de la columna y centrados, y en una
// pestaña ENCIMA del menú (84 de alto más el borde de abajo) en vez de
// detrás. En la app no cambia nada: devuelve null.
export const ALTO_MENU_WEB = 84;
export function posAvisoWeb(ins, { conPestanas = true, aire = 12 } = {}) {
  if (Platform.OS !== 'web') return null;
  const abajo = conPestanas ? ALTO_MENU_WEB + Math.max(ins?.bottom ?? 0, 10) + aire : (ins?.bottom ?? 0) + 16;
  return { left: RELLENO, right: RELLENO, bottom: abajo, maxWidth: COLUMNA - 2 * RELLENO, marginHorizontal: 'auto' };
}

// El margen de la computadora en los encabezados de react-navigation, como
// opciones de la pila (2026-11-14, «el header al cambiar de vista se pone a
// los bordes y ya luego al ancho correcto»): antes lo agregaba
// lib/documentoWeb DESPUÉS de dibujar, y se veía el salto. Así el encabezado
// nace alineado con la columna. En el teléfono y en la app: nada.
export function useBarraWeb() {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return null;
  const extra = Math.max(0, Math.round((width - COLUMNA) / 2));
  return { headerLeftContainerStyle: { paddingLeft: extra }, headerRightContainerStyle: { paddingRight: extra } };
}
