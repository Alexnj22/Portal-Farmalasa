import PilaDePestana from '../../../componentes/PilaDePestana';

// La aurora del Inicio va QUIETA (2026-10-14): detrás de la lista larga que
// se desplaza, animada costaba cuadros (ver componentes/PilaDePestana).
export default function Pila() {
  // Sin barra (2026-10-20, «se pierde mucho espacio arriba»): el saludo hace de título.
  return <PilaDePestana titulo="Inicio" auroraQuieta sinBarra />;
}
