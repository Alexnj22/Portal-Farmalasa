// El color de la app para la VARIANTE con que el núcleo nombra una severidad
// (`success`, `warning`, `danger`, `info`, `neutral`) — la misma palabra que el
// portal le pasa a `Badge`.
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

export const COLOR_DE_VARIANTE = {
  success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, info: MARCA.azulClaro, neutral: colorSistema.texto2,
  // La paleta categórica del portal (--chart-N): no es severidad, sólo distingue.
  // Sin estas, «Por revisar», «Programado» o «Publicado» salían grises.
  'chart-1': MARCA.azulClaro, 'chart-3': MARCA.violeta, 'chart-4': '#E879F9', 'chart-6': '#F472B6', 'chart-9': '#2DD4BF',
};

export const colorDeVariante = (v) => COLOR_DE_VARIANTE[v] ?? colorSistema.texto2;
