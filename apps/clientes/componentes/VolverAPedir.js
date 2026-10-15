// «Volver a pedir» con un toque (2026-10-15): desde Mis compras (una compra
// entera) o Mis tratamientos (un medicamento). Llena el carrito con esos
// productos —en la presentación y la cantidad en que se compraron— y abre el
// carrito.
//
// Lo que se puede agregar lo decide el servidor (`volver_a_pedir`) con el
// catálogo de HOY: lo que ya no se vende en la app, la presentación que
// cambió o lo que no hay en ninguna sucursal vuelve con su motivo y se le
// dice a la persona, uno por uno, en vez de quedar afuera callado. Las reglas
// del carrito se respetan porque se agrega por lib/carrito: tope de 5 por
// producto y de 10 productos, y el precio de mayoreo sólo en la caja (el
// servidor lo calcula igual que la ficha y lo vuelve a calcular al reservar).
// Lo bajo receta entra marcado y la foto se pide al reservar, como siempre.
import { useState } from 'react';
import { ActivityIndicator, Alert, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import { useSesion } from '../lib/sesion';
import { MAX_UNIDADES, useCarrito } from '../lib/carrito';
import { nombreProducto } from '../lib/catalogo';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';

const llave = (x) => `${x.id}|${x.factor}`;
const enCarrito = (x) => useCarrito.getState().items.find((y) => llave(y) === llave(x))?.cantidad ?? 0;

export function useVolverAPedir() {
  const pedir = useSesion((s) => s.pedir);
  const [ocupado, setOcupado] = useState(false);

  /** `datos`: { factura: id } o { productos: [id] }. */
  const volver = async (datos) => {
    if (ocupado) return;
    setOcupado(true);
    let r = null;
    try { r = await pedir('volver_a_pedir', datos); } finally { setOcupado(false); }
    if (!r?.ok) { Alert.alert('No se pudo agregar', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }

    const fuera = [...(r.fuera ?? [])];
    const agregados = [], recortados = [];
    for (const it of r.items ?? []) {
      const { cantidad, pedida, ...producto } = it;
      const antes = enCarrito(producto);
      if (!useCarrito.getState().agregar(producto, cantidad)) {
        fuera.push({ id: it.id, nombre: it.nombre, motivo: 'Tu carrito ya tiene 10 productos distintos.' });
        continue;
      }
      agregados.push(producto);
      // Lo que no entró por el tope de 5 por producto (o porque ya estaba).
      if (enCarrito(producto) - antes < (pedida ?? cantidad)) recortados.push(producto);
    }

    const nombre = (x) => nombreProducto(x.nombre || 'Producto');
    if (!agregados.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      const solo = fuera.length === 1 && fuera[0].id ? fuera[0] : null;
      Alert.alert(fuera.length === 1 ? 'No se pudo agregar' : 'No se pudo agregar ninguno',
        fuera.map((x) => (fuera.length === 1 ? x.motivo : `• ${nombre(x)}: ${x.motivo}`)).join('\n') || 'No hay productos para volver a pedir.',
        solo ? [{ text: 'Cerrar', style: 'cancel' }, { text: 'Ver el producto', onPress: () => navegar(`/producto/${solo.id}`) }] : [{ text: 'Entendido' }]);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Todo entró como estaba: directo al carrito.
    if (!fuera.length && !recortados.length) { navegar('/carrito'); return; }
    const partes = [];
    if (fuera.length) partes.push(`No se agregaron:\n${fuera.map((x) => `• ${nombre(x)}: ${x.motivo}`).join('\n')}`);
    if (recortados.length) partes.push(`Se puede pedir hasta ${MAX_UNIDADES} de cada producto: ${recortados.map(nombre).join(', ')} ${recortados.length === 1 ? 'quedó' : 'quedaron'} con ${MAX_UNIDADES}.`);
    Alert.alert(agregados.length === 1 ? 'Agregamos 1 producto' : `Agregamos ${agregados.length} productos`, partes.join('\n\n'), [
      { text: 'Seguir aquí', style: 'cancel' },
      { text: 'Ir al carrito', onPress: () => navegar('/carrito') },
    ]);
  };

  return { volver, ocupado };
}

/** El botón: ícono de repetir + «Volver a pedir». `principal` lo pinta lleno. */
export default function BotonVolverAPedir({ alTocar, ocupado, principal = false, etiqueta = 'Volver a pedir', estilo }) {
  const t = useTema();
  const color = principal ? '#FFFFFF' : t.color.magentaTexto;
  return (
    <Presionable onPress={() => { if (ocupado) return; Haptics.selectionAsync().catch(() => {}); alTocar(); }} disabled={ocupado}
      accessibilityRole="button" accessibilityLabel={etiqueta} accessibilityState={{ busy: !!ocupado }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, borderRadius: 12, paddingHorizontal: 14,
        backgroundColor: principal ? t.color.magenta : suave(t.color.magenta, pressed ? (t.oscuro ? 0.4 : 0.24) : (t.oscuro ? 0.24 : 0.12)),
        transform: [{ scale: pressed ? 0.97 : 1 }], ...estilo })}>
      {ocupado ? <ActivityIndicator size="small" color={color} /> : <Icono sf="arrow.clockwise" respaldo="↻" tam={15} color={color} />}
      <Text style={{ fontSize: 14, fontWeight: '700', color }}>{etiqueta}</Text>
    </Presionable>
  );
}
