// La barra inferior del sistema (UITabBar en iPhone, Material en Android),
// igual que la app del personal.
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTema } from '../../tema/tema';

const TRANSPARENTE = { backgroundColor: 'transparent' };

export default function Pestanas() {
  const t = useTema();
  return (
    <NativeTabs tintColor={t.color.magenta}>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="puntos">
        <NativeTabs.Trigger.Icon sf={{ default: 'star.circle', selected: 'star.circle.fill' }} md="stars" />
        <NativeTabs.Trigger.Label>Puntos</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="ofertas">
        <NativeTabs.Trigger.Icon sf={{ default: 'tag', selected: 'tag.fill' }} md="sell" />
        <NativeTabs.Trigger.Label>Ofertas</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="catalogo">
        <NativeTabs.Trigger.Icon sf={{ default: 'pills', selected: 'pills.fill' }} md="medication" />
        <NativeTabs.Trigger.Label>Catálogo</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="inyecciones">
        <NativeTabs.Trigger.Icon sf={{ default: 'syringe', selected: 'syringe.fill' }} md="vaccines" />
        <NativeTabs.Trigger.Label>Inyecciones</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="cuenta">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Cuenta</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
