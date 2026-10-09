// «Ya tienes una reserva de este producto» (2026-10-09). Antes de agregar al
// carrito o de reservar, se mira si el cliente ya tiene ese producto apartado
// (pendiente o listo) y se le pregunta qué quiere hacer: ver la reserva,
// cancelarla o seguir de todos modos. Así no termina con dos apartados del
// mismo producto sin darse cuenta.
//
// La lista sale del RESUMEN (`reservas_productos`), que ya está cacheado en
// `useCuenta`: no cuesta una llamada más. Se compara por `producto_id`, nunca
// por nombre. Si el resumen no la trae (sin red, o un servidor más viejo), no
// se avisa: el aviso ayuda, no frena.
import { Alert, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCuenta } from './cuenta';
import { useSesion } from './sesion';
import { navegar } from './navegar';
import { nombreProducto } from './catalogo';

/** Las reservas abiertas del resumen, agrupadas: un pedido del carrito cuenta como UNA. */
export function resumenDeReservas(resumen) {
  const filas = Array.isArray(resumen?.reservas_productos) ? resumen.reservas_productos : null;
  if (!filas) {
    return { total: resumen?.reservas_abiertas ?? 0, listas: resumen?.reservas_listas ?? 0, productos: [] };
  }
  const grupos = new Map();
  for (const f of filas) {
    const g = grupos.get(f.codigo) ?? { codigo: f.codigo, lista: false };
    if (f.estado === 'lista') g.lista = true;
    grupos.set(f.codigo, g);
  }
  const todos = [...grupos.values()];
  return { total: todos.length, listas: todos.filter((g) => g.lista).length, productos: filas };
}

/** Las reservas abiertas de un producto (vacío si no hay o no se sabe). */
export function reservasDelProducto(resumen, productoId) {
  const filas = Array.isArray(resumen?.reservas_productos) ? resumen.reservas_productos : [];
  return filas.filter((f) => f.producto_id != null && Number(f.producto_id) === Number(productoId));
}

/**
 * Pregunta antes de seguir si el producto ya está reservado.
 * Resuelve `true` si hay que seguir (agregar o reservar) y `false` si no.
 * `alVer(reserva)` decide cómo ir a Mis reservas (desde una hoja hay que
 * cerrarla primero); por defecto navega directo.
 */
export async function seguirSiYaReservado(productoId, { alVer } = {}) {
  // Sin sesión (el catálogo se mira sin entrar) no hay reservas que mirar.
  if (!useSesion.getState().token) return true;
  const resumen = await useCuenta.getState().cargar().catch(() => null);
  const suyas = reservasDelProducto(resumen?.ok ? resumen : useCuenta.getState().resumen, productoId);
  if (!suyas.length) return true;

  const r = suyas.find((x) => x.estado === 'lista') ?? suyas[0];
  const nombre = nombreProducto(r.producto_nombre ?? 'este producto');
  const estado = r.estado === 'lista' ? 'ya está lista para retirar' : 'la sucursal la está preparando';
  const mensaje = suyas.length > 1
    ? `Tienes ${suyas.length} reservas abiertas de ${nombre}. La ${r.codigo} ${estado}.`
    : `Tu reserva ${r.codigo} de ${nombre} ${estado}. ¿Es correcta o quieres cambiarla?`;
  const ver = () => (alVer ? alVer(r) : navegar(`/reservas?resaltar=${r.id}`));

  return new Promise((resolver) => {
    const botones = [
      { text: 'Ver reserva', onPress: () => { resolver(false); ver(); } },
    ];
    // Pagada en línea no se cancela desde la app (habría que devolver el dinero).
    if (!r.pagada) {
      botones.push({ text: 'Cancelar esa reserva', style: 'destructive', onPress: () => cancelar(r, nombre, resolver) });
    }
    botones.push({ text: 'Continuar de todos modos', onPress: () => resolver(true) });
    // Android admite tres botones: ahí se cierra tocando fuera.
    if (Platform.OS === 'ios') botones.push({ text: 'Volver', style: 'cancel', onPress: () => resolver(false) });
    Alert.alert('Ya tienes una reserva de este producto', mensaje, botones, { cancelable: true, onDismiss: () => resolver(false) });
  });
}

function cancelar(r, nombre, resolver) {
  Alert.alert('Cancelar reserva', `¿Cancelar la reserva ${r.codigo} de ${nombre}?`, [
    { text: 'No', style: 'cancel', onPress: () => resolver(false) },
    {
      text: 'Cancelar reserva', style: 'destructive', onPress: async () => {
        const res = await useSesion.getState().pedir('cancelar_reserva', { id: r.id });
        if (!res?.ok) {
          Alert.alert('No se pudo cancelar', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.');
          resolver(false);
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        await useCuenta.getState().cargar({ forzar: true }).catch(() => null);
        // Cancelada la anterior, sigue con lo que se estaba haciendo.
        resolver(true);
      },
    },
  ], { cancelable: true, onDismiss: () => resolver(false) });
}
