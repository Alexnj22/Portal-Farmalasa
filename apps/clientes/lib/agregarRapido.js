// El «+» de la Tienda (2026-11-05, rediseño «Vitrina»): agregar al carrito sin
// entrar a la ficha. La tarjeta del catálogo no trae las presentaciones (sólo
// el precio de la mayor), así que se pide la ficha: si el producto tiene UNA
// sola presentación, va directo al carrito con los mismos datos que pone la
// ficha; si tiene varias, se abre la ficha para elegir — adivinar la caja o la
// unidad sería reservarle al cliente algo que no pidió.
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { llamar } from './api';
import { useCarrito } from './carrito';
import { navegar } from './navegar';
import { nombreProducto } from './catalogo';
import { datosDePrecio, mayoreoSoloEnCaja } from './precioTuyo';
import { seguirSiYaReservado } from './reservaDuplicada';

let ocupado = false;

/** Agrega el producto `p` (de una tarjeta del catálogo) o abre su ficha. */
export async function agregarRapido(p) {
  if (ocupado || !p?.id) return;
  ocupado = true;
  Haptics.selectionAsync().catch(() => {});
  try {
    const r = await llamar('catalogo_producto', { id: Number(p.id), ...datosDePrecio() });
    const prod = r?.ok ? r.producto : null;
    const pres = prod ? mayoreoSoloEnCaja(prod.presentaciones) : [];
    if (!prod || pres.length !== 1) { navegar(`/producto/${p.id}`); return; }
    const x = pres[0];
    const seguir = await seguirSiYaReservado(prod.id, { alVer: (res) => navegar(`/reservas?resaltar=${res.id}`) });
    if (!seguir) return;
    const ok = useCarrito.getState().agregar({ id: prod.id, nombre: prod.nombre, foto: prod.foto, tipo: x.tipo, factor: x.factor ?? 1,
      precio: x.precio, precio_vip: x.precio_vip, precio_tuyo: x.precio_tuyo ?? null, precio_tuyo_nombre: x.precio_tuyo_nombre ?? null,
      factor_mayor: x.factor_mayor ?? null, receta: !!prod.bajo_receta }, 1);
    if (!ok) { Alert.alert('Carrito lleno', 'El carrito admite hasta 10 productos distintos.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('Agregado al carrito', `1 × ${nombreProducto(prod.nombre)} · ${nombreProducto(x.tipo)}`, [
      { text: 'Seguir comprando', style: 'cancel' },
      { text: 'Ir al carrito', onPress: () => navegar('/carrito') },
    ]);
  } finally {
    ocupado = false;
  }
}
