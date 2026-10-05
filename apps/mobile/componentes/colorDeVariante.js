// El color de la app para la VARIANTE con que el núcleo nombra una severidad
// (`success`, `warning`, `danger`, `info`, `neutral`) — la misma palabra que el
// portal le pasa a `Badge`.
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';

export const COLOR_DE_VARIANTE = {
  success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, info: MARCA.azulClaro, neutral: colorSistema.texto2,
};

export const colorDeVariante = (v) => COLOR_DE_VARIANTE[v] ?? colorSistema.texto2;
