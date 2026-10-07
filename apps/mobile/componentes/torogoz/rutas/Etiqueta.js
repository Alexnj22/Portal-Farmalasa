// La píldora de estado de Torogoz, con la VARIANTE del núcleo (success,
// warning, danger, info, neutral) — el `Badge` del portal. El gris de
// «neutral» va escrito: el del sistema no se puede volver translúcido.
import { Pildora } from '../../avisos/Piezas';
import { colorDeVariante } from '../../colorDeVariante';

export const colorDeEstado = (variante) => (variante === 'neutral' || !variante ? '#8D8D99' : colorDeVariante(variante));

export default function Etiqueta({ variante, texto }) {
  return <Pildora texto={texto} color={colorDeEstado(variante)} />;
}
