// El color de la edad de un crédito, en la marca: rojo pasado del plazo (y
// pasado de dos meses), ámbar la última semana del plazo, gris dentro. La
// regla es la del núcleo (`severidadDeDias`); acá sólo se le pone color.
import { severidadDeDias } from '@nucleo/data/creditos';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

export const colorDeEdad = (dias, saldo) => {
  const s = severidadDeDias(dias, saldo);
  return s.variant === 'danger' ? MARCA.rojo : s.porVencer ? MARCA.ambar : colorSistema.texto2;
};
