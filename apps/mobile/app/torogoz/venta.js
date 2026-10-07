// Torogoz · Nueva venta, NATIVA (`/torogoz/venta`). Como en el portal:
// `?cliente=<id>` abre con ese cliente elegido y `?desde=<pedido>` vuelve a
// vender los productos de otra venta. La pantalla vive en
// `componentes/torogoz/venta/PantallaVenta.js`.
import { useLocalSearchParams } from 'expo-router';
import PantallaVenta from '../../componentes/torogoz/venta/PantallaVenta';

export default function NuevaVenta() {
  const { cliente, desde } = useLocalSearchParams();
  return <PantallaVenta cliente={cliente ?? null} desde={desde ? Number(desde) : null} />;
}
