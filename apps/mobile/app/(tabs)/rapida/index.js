// La pestaña rápida muestra la MISMA pantalla que se abre desde el Menú (no una
// copia): el módulo que eligió la persona, o el de su grupo por defecto.
// Ver componentes/pestanaRapida.js.
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { usePestanaRapida } from '../../../componentes/pestanaRapida';
import Efectivo from '../../efectivo';
import Pedidos from '../../pedidos';
import Solicitudes from '../../solicitudes';
import Traslados from '../../traslados';
import Bitacoras from '../../bitacoras';
import Ventas from '../../ventas';
import Clientes from '../../clientes';
import Reservas from '../../reservas-sala';
import Inventario from '../../inventario';
import Productos from '../../productos';
import Personal from '../../personal';
import Inyecciones from '../../inyecciones';

const PANTALLA = {
  efectivo: Efectivo, pedidos: Pedidos, solicitudes: Solicitudes, traslados: Traslados,
  bitacoras: Bitacoras, ventas: Ventas, clientes: Clientes, reservas: Reservas,
  inventario: Inventario, productos: Productos, personal: Personal, inyecciones: Inyecciones,
};

export default function Rapida() {
  const { user, hasPermission } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const { actual } = usePestanaRapida(user, hasPermission, salas);
  const Pantalla = actual ? PANTALLA[actual.id] : null;
  return Pantalla ? <Pantalla key={actual.id} /> : null;
}
