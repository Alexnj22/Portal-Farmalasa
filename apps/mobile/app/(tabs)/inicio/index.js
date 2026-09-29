// Inicio: el tablero del portal, el mismo que se ve en la web. Es la primera
// pantalla al abrir la app (pedido del usuario del 2026-09-29) y se reemplaza
// por una nativa cuando le toque.
import PortalIncrustado from '../../../componentes/PortalIncrustado';

export default function Inicio() {
  return <PortalIncrustado ruta="/inicio" enPestana />;
}
