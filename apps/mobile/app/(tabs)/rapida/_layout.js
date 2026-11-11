import PilaDePestana from '../../../componentes/PilaDePestana';

// La pestaña rápida: título y botones los pone la pantalla elegida, sin la
// foto ni el logo (ver `conMarca` en PilaDePestana y componentes/pestanaRapida.js).
export default function Layout() {
  return <PilaDePestana fija titulo="" conMarca={false} />;
}
