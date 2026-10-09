// La barra inferior de la app: la del sistema (UITabBar en iPhone, con el
// vidrio de iOS; la barra de navegación de Material en Android). Decisión del
// usuario del 2026-09-29: «que se vea nativa con los elementos nativos», y que
// la app ABRA en Inicio.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { usePorDecidir } from '../../componentes/porDecidir';

const CADA = 2 * 60 * 1000;

// «Por decidir» se mantiene al día sola: al entrar, cada dos minutos, al volver
// a la app y cuando llega un aviso. Así el globo de la pestaña dice la verdad
// aunque nadie abra la pestaña.
function useMantenerPorDecidir() {
  const auth = useAuth();
  const cargar = usePorDecidir((s) => s.cargar);
  useEffect(() => {
    if (!auth.user) return undefined;
    const leer = () => cargar(auth);
    leer();
    const reloj = setInterval(leer, CADA);
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') leer(); });
    const aviso = Notifications.addNotificationReceivedListener(() => leer());
    return () => { clearInterval(reloj); app.remove(); aviso.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id, cargar]);
}

// Transparente: detrás de cada pestaña está la aurora de la raíz.
const TRANSPARENTE = { backgroundColor: 'transparent' };

export default function Pestanas() {
  // El globo de la campana: lo que falta leer, el mismo número que la web.
  const sinLeer = useStaffStore((s) => s.notifications.length);
  // El globo cuenta lo que falta DECIDIR más lo que falta leer: un aviso leído
  // sobre algo todavía pendiente sigue pidiendo atención.
  const porDecidir = usePorDecidir((s) => s.items.length);
  useMantenerPorDecidir();
  const globo = sinLeer + porDecidir;
  return (
    <NativeTabs labelVisibilityMode="labeled">
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
        {/* En Android no cabe con los cinco rótulos a la vista: «Notificacion…». */}
        <NativeTabs.Trigger.Label>{Platform.OS === 'android' ? 'Avisos' : 'Notificaciones'}</NativeTabs.Trigger.Label>
        {globo ? <NativeTabs.Trigger.Badge>{globo > 99 ? '99+' : String(globo)}</NativeTabs.Trigger.Badge> : null}
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
