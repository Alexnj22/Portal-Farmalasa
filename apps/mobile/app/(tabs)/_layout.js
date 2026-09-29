// La barra inferior de la app: la del sistema (UITabBar en iPhone, con el
// vidrio de iOS; la barra de navegación de Material en Android). Decisión del
// usuario del 2026-09-29: «que se vea nativa con los elementos nativos», y que
// la app ABRA en Inicio.
import { NativeTabs } from 'expo-router/unstable-native-tabs';

export default function Pestanas() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="inicio">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="menu">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="apps" />
        <NativeTabs.Trigger.Label>Menú</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="avisos">
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} md="notifications" />
        <NativeTabs.Trigger.Label>Avisos</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="yo">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Yo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
