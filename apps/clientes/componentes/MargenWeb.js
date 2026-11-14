// En el navegador (2026-11-14): lo que va a los lados del encabezado —la foto,
// la campana— y la burbuja del chat se alinean con la COLUMNA del contenido
// (560 px de ancho con 16 de relleno, componentes/ui.js), no con la orilla de
// la ventana. En una computadora la ventana mide 1400 px y quedaban a medio
// metro de la tarjeta; en un teléfono el margen sigue siendo 16.
import { useWindowDimensions, View } from 'react-native';

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
