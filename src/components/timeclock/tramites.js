import {
    ArrowLeftRight, BarChart2, Package, PackageMinus, Pill, Receipt, ShoppingBag, Tag, Thermometer,
} from 'lucide-react';
import { BRANCH_A_ERP } from '@nucleo/constants/erp';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';

// La lista de trámites del kiosco, aparte de sus modales: el inicio la pinta
// sin cargar ningún formulario (eso va en `TramitesDelKiosco`, diferido).
/** Los trámites, en el orden en que se ofrecen. `baldosa`: abre el modal de su baldosa. */
export const TRAMITES = [
    { clave: 'facturacion', label: 'Modificar facturación', icon: Receipt, permiso: 'dash_annulment_req', baldosa: true,
        description: 'Anular, cambiar cliente, vendedor o forma de pago.',
        aplica: (sala) => SALAS_VENTA.includes(Number(sala)) },
    { clave: 'inventario', label: 'Ajuste de inventario', icon: PackageMinus, permiso: 'dash_inv_movement', baldosa: true,
        description: 'Cargar o descargar producto.', aplica: (sala) => BRANCH_A_ERP[sala] != null },
    { clave: 'existencias', label: 'Consulta de inventario', icon: Package, permiso: 'dash_inv_search', baldosa: true,
        description: 'En qué sucursal hay un producto.' },
    { clave: 'traslados', label: 'Traslados', icon: ArrowLeftRight, permiso: 'dash_traslados', baldosa: true,
        description: 'Pedir, mandar y recibir producto.' },
    { clave: 'minmax', label: 'Ajuste de Mín/Máx', icon: BarChart2, permiso: 'dash_minmax_req', baldosa: true,
        description: 'Pedir que cambien el Mín o el Máx.', aplica: (sala) => BRANCH_A_ERP[sala] != null },
    { clave: 'precios', label: 'Consulta de precios', icon: Tag, permiso: 'dash_consulta_precios',
        description: 'Precio de un producto por nivel.' },
    { clave: 'reservas', label: 'Reservas de la app', icon: ShoppingBag, permiso: 'dash_reservas',
        description: 'Pedidos de la app para esta sucursal.' },
    { clave: 'recetas', label: 'Recetas pendientes', icon: Pill, permiso: 'dash_recetas_pendientes',
        description: 'Recetas que faltan por completar.' },
    { clave: 'bitacoras', label: 'Bitácoras', icon: Thermometer, permiso: 'dash_bitacoras',
        description: 'Temperatura y humedad del día.' },
];

/** Los trámites que puede usar quien está en el kiosco, en esta sucursal. */
export const tramitesDe = (hasPermission, sala) =>
    TRAMITES.filter((t) => hasPermission(t.permiso) && (!t.aplica || t.aplica(sala)));

