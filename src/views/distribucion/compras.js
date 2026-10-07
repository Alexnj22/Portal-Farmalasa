import { PackageCheck, FilePen, Ban } from 'lucide-react';
import { VISTAS_COMPRAS as VISTAS } from '@nucleo/utils/distribucionCompras';

// Las cuentas de una compra viven en el núcleo para que la app nativa use las
// mismas; acá sólo se les ponen los íconos de la pantalla.
export * from '@nucleo/utils/distribucionCompras';

const ICONOS = { recibida: PackageCheck, borrador: FilePen, anulada: Ban };
export const VISTAS_COMPRAS = VISTAS.map(v => ({ ...v, icon: ICONOS[v.key] }));
