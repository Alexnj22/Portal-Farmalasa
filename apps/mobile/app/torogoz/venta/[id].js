// Torogoz · Finalizar o corregir una preventa, NATIVO (`/torogoz/venta/<pedido>`),
// incluida la que reemplaza a un documento sellado. Misma pantalla que la venta
// nueva: `key` la rehace entera al pasar de un pedido a otro.
import { useLocalSearchParams } from 'expo-router';
import PantallaVenta from '../../../componentes/torogoz/venta/PantallaVenta';

export default function FinalizarVenta() {
  const { id } = useLocalSearchParams();
  return <PantallaVenta key={String(id)} pedidoId={Number(id)} />;
}
