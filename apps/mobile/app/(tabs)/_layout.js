// La barra inferior de la app: la del sistema (UITabBar en iPhone, con el
// vidrio de iOS; la barra de navegación de Material en Android). Decisión del
// usuario del 2026-09-29: «que se vea nativa con los elementos nativos», y que
// la app ABRA en Inicio.
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useStaffStore } from '@nucleo/store/staffStore';

// Transparente: detrás de cada pestaña está la aurora de la raíz.
const TRANSPARENTE = { backgroundColor: 'transparent' };

export default function Pestanas() {
  // El globo de la campana: lo que falta leer, el mismo número que la web.
  const sinLeer = useStaffStore((s) => s.notifications.length);
  return (
    <NativeTabs>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="inicio">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="menu">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="apps" />
        <NativeTabs.Trigger.Label>Menú</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="avisos">
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
        <NativeTabs.Trigger.Label>Notificaciones</NativeTabs.Trigger.Label>
        {sinLeer ? <NativeTabs.Trigger.Badge>{sinLeer > 99 ? '99+' : String(sinLeer)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="yo">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Yo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* La búsqueda de toda la app (2026-09-30). `role="search"` es lo que en
          iOS 26 la separa del resto de la barra y la convierte en el campo de
          búsqueda al tocarla, como en Música o App Store. */}
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="buscar" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Buscar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
