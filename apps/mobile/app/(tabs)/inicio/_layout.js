import PilaDePestana from '../../../componentes/PilaDePestana';

// Con la barra del sistema y título grande: el saludo es el título, y al
// desplazar se encoge y el sistema difumina el borde (iOS 26), como Mail.
export default function Layout() {
  return <PilaDePestana titulo="Inicio" grande />;
}
