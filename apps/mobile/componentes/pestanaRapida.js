// La pestaña rápida de la barra de abajo (2026-11-11, usuario: «mejor
// efectivo. para los que tienen sucursal; para bodega cuál sería; para admin;
// o que se pueda agregar desde configuración y cambiar»).
//
// Una sola pestaña, entre Menú y Cuenta, con UNO de los módulos que el cargo
// puede ver. Por defecto, según quién es (medido en `audit_logs`, 30 días):
//   · admin (los cuatro cargos de `user_admin_son_cuatro_cargos`) → Solicitudes (lo eligió el usuario)
//   · Bodega → Pedidos (generar, finalizar y armar pedidos es lo que más hacen)
//   · sala → Efectivo (movimientos, cortes y aperturas: 34 de las personas de sala)
// Cada quien la cambia en Cuenta › Pestaña rápida; se guarda en ESTE teléfono
// y por persona. Si la elegida deja de estar permitida, vuelve al defecto; si
// el cargo no ve ninguna, la pestaña no aparece.
import { create } from 'zustand';
import { leer, guardar } from '@plataforma/almacen';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';

// `permiso`: la clave del módulo en role_permissions. sf: SF Symbol; md: Material Symbol.
export const OPCIONES_RAPIDAS = [
  { id: 'efectivo', permiso: ['cortes_caja', 'caja_vales'], label: 'Efectivo', sf: 'banknote', md: 'payments' },
  { id: 'pedidos', permiso: ['pedidos'], label: 'Pedidos', sf: 'shippingbox', md: 'local_shipping' },
  { id: 'solicitudes', permiso: ['requests'], label: 'Solicitudes', sf: 'tray.full', md: 'inbox' },
  { id: 'traslados', permiso: ['traslados'], label: 'Traslados', sf: 'arrow.left.arrow.right', md: 'swap_horiz' },
  { id: 'bitacoras', permiso: ['bitacoras'], label: 'Bitácoras', sf: 'thermometer.medium', md: 'thermostat' },
  { id: 'ventas', permiso: ['ventas'], label: 'Ventas', sf: 'chart.line.uptrend.xyaxis', md: 'trending_up' },
  { id: 'clientes', permiso: ['clientes'], label: 'Clientes', sf: 'person.2', md: 'group' },
  { id: 'reservas', permiso: ['reservas'], label: 'Reservas', sf: 'bag', md: 'shopping_bag' },
  { id: 'inventario', permiso: ['inventario'], label: 'Inventario', sf: 'archivebox', md: 'inventory_2' },
  { id: 'productos', permiso: ['productos'], label: 'Productos', sf: 'cube.box', md: 'deployed_code' },
  { id: 'personal', permiso: ['staff_list'], label: 'Personal', sf: 'person.3', md: 'groups' },
  { id: 'inyecciones', permiso: ['inyecciones'], label: 'Inyecciones', sf: 'syringe', md: 'vaccines' },
];

const ADMIN = new Set([2, 3, 11, 13]);
const clave = (userId) => `pestanaRapida.${userId}`;

export const opcionesPermitidas = (hasPermission) =>
  OPCIONES_RAPIDAS.filter((o) => o.permiso.some((k) => hasPermission(k)));

function porDefecto(user, salas) {
  if (ADMIN.has(Number(user?.roleId ?? user?.role_id))) return 'solicitudes';
  const sala = (salas || []).find((b) => String(b.id) === String(salaDelUsuario(user)));
  if (/bodega/i.test(sala?.name || '')) return 'pedidos';
  return 'efectivo';
}

const usePreferida = create((set) => ({
  porUsuario: {},
  poner: (userId, id) => {
    try { guardar(clave(userId), id); } catch { /* el almacén puede fallar: queda para esta sesión */ }
    set((s) => ({ porUsuario: { ...s.porUsuario, [userId]: id } }));
  },
}));

function leerGuardada(userId) {
  try { return leer(clave(userId)); } catch { return null; }
}

// La opción vigente (o null si el cargo no ve ninguna) y cómo cambiarla.
export function usePestanaRapida(user, hasPermission, salas) {
  const enMemoria = usePreferida((s) => s.porUsuario[user?.id]);
  const poner = usePreferida((s) => s.poner);
  const permitidas = user ? opcionesPermitidas(hasPermission) : [];
  const buscar = (id) => permitidas.find((o) => o.id === id);
  const actual = buscar(enMemoria ?? leerGuardada(user?.id)) || buscar(porDefecto(user, salas)) || permitidas[0] || null;
  return { actual, permitidas, poner: (id) => poner(user?.id, id) };
}
