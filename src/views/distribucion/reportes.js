import { TrendingUp, BookOpen, BookText, Users, Store, FileX2, Handshake, Percent } from 'lucide-react';
import { VISTAS_REPORTES as VISTAS, LIBROS_VENTAS as LIBROS } from '@nucleo/utils/distribucionReportes';

// Las cuentas de los reportes viven en el núcleo para que la app nativa use las
// mismas; acá sólo se les ponen los íconos de la pantalla.
export * from '@nucleo/utils/distribucionReportes';

const ICONOS = { utilidad: TrendingUp, ventas: BookText, compras: BookOpen, retenciones: Percent, relacionadas: Handshake };
export const VISTAS_REPORTES = VISTAS.map(v => ({ ...v, icon: ICONOS[v.key] }));

const ICONOS_LIBRO = { contribuyente: Users, consumidor: Store, anulados: FileX2 };
export const LIBROS_VENTAS = LIBROS.map(l => ({ ...l, icon: ICONOS_LIBRO[l.key] }));
