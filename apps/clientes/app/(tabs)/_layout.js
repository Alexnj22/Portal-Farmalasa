// La barra inferior del sistema (UITabBar en iPhone, Material en Android),
// igual que la app del personal.
import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colorSistema } from '../../componentes/sistema';
import { suave, useTema } from '../../tema/tema';
import { useCarrito } from '../../lib/carrito';
export { default as ErrorBoundary } from '../../componentes/ErrorDePantalla';

const TRANSPARENTE = { backgroundColor: 'transparent' };
const ANDROID = Platform.OS === 'android';

// Android (2026-10-13): la barra de navegación de Material 3 — superficie
// propia, la píldora tonal detrás del ícono elegido (el «indicador»), la onda
// al tocar y los rótulos siempre visibles. El contenido de cada pestaña es
// OPACO (la superficie del fondo): transparente, el sistema componía la
// pestaña con lo de atrás en cada cambio.
function propsAndroid(t) {
  if (!ANDROID) return {};
  return {
    backgroundColor: colorSistema.barra,
    indicatorColor: suave(t.color.magenta, t.oscuro ? 0.38 : 0.16),
    rippleColor: suave(t.color.magenta, 0.16),
    iconColor: { default: colorSistema.texto2, selected: t.oscuro ? '#FFFFFF' : t.color.magentaTexto },
    // Label Medium de Material 3: 12 sp, medio.
    labelStyle: {
      default: { color: colorSistema.texto2, fontSize: 12, fontWeight: '500' },
      selected: { color: colorSistema.texto, fontSize: 12 },
    },
    badgeBackgroundColor: colorSistema.rojo,
    badgeTextColor: '#FFFFFF',
    backBehavior: 'initialRoute',
  };
}

export default function Pestanas() {
  const t = useTema();
  const enCarrito = useCarrito((s) => s.items.length);
  const contenido = ANDROID ? { backgroundColor: colorSistema.fondo } : TRANSPARENTE;
  return (
    <NativeTabs tintColor={t.color.magenta} labelVisibilityMode="labeled" {...propsAndroid(t)}>
      <NativeTabs.Trigger contentStyle={contenido} name="puntos">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* Ofertas dejó de ser pestaña (2026-11-03): se abre desde la Tienda.
          Su lugar es para Bienestar: la frase del día y la zona anti estrés. */}
      <NativeTabs.Trigger contentStyle={contenido} name="catalogo">
        {/* «Tienda Salud» con el ícono de tienda (2026-11-05, «y si a la tienda
            le llamamos Tienda Salud… y en el menú usamos el ícono?»). */}
        <NativeTabs.Trigger.Icon sf={{ default: 'storefront', selected: 'storefront.fill' }} md="storefront" />
        {/* En Android la barra de Material da ~72 dp por pestaña y «Tienda
            Salud» se cortaba (2026-11-11): ahí va «Tienda» a secas. */}
        <NativeTabs.Trigger.Label>{ANDROID ? 'Tienda' : 'Tienda Salud'}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={contenido} name="bienestar">
        <NativeTabs.Trigger.Icon sf={{ default: 'leaf', selected: 'leaf.fill' }} md="spa" />
        <NativeTabs.Trigger.Label>Bienestar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* El carrito, con cuántos productos lleva. Inyecciones pasó al Inicio. */}
      <NativeTabs.Trigger contentStyle={contenido} name="carrito">
        <NativeTabs.Trigger.Icon sf={{ default: 'cart', selected: 'cart.fill' }} md="shopping_cart" />
        <NativeTabs.Trigger.Label>Carrito</NativeTabs.Trigger.Label>
        {enCarrito ? <NativeTabs.Trigger.Badge>{String(enCarrito)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={contenido} name="cuenta">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Cuenta</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
