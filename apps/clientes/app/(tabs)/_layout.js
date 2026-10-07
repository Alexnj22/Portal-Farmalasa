// La barra inferior del sistema (UITabBar en iPhone, Material en Android),
// igual que la app del personal.
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTema } from '../../tema/tema';
import { useCarrito } from '../../lib/carrito';

const TRANSPARENTE = { backgroundColor: 'transparent' };

export default function Pestanas() {
  const t = useTema();
  const enCarrito = useCarrito((s) => s.items.length);
  return (
    <NativeTabs tintColor={t.color.magenta}>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="puntos">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="ofertas">
        <NativeTabs.Trigger.Icon sf={{ default: 'tag', selected: 'tag.fill' }} md="sell" />
        <NativeTabs.Trigger.Label>Ofertas</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="catalogo">
        <NativeTabs.Trigger.Icon sf={{ default: 'pills', selected: 'pills.fill' }} md="medication" />
        <NativeTabs.Trigger.Label>Catálogo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* El carrito, con cuántos productos lleva. Inyecciones pasó al Inicio. */}
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="carrito">
        <NativeTabs.Trigger.Icon sf={{ default: 'cart', selected: 'cart.fill' }} md="shopping_cart" />
        <NativeTabs.Trigger.Label>Carrito</NativeTabs.Trigger.Label>
        {enCarrito ? <NativeTabs.Trigger.Badge>{String(enCarrito)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="cuenta">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Cuenta</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
