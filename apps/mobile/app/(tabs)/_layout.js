// La barra inferior de la app: la del sistema (UITabBar en iPhone, con el
// vidrio de iOS; la barra de navegación de Material en Android). Decisión del
// usuario del 2026-09-29: «que se vea nativa con los elementos nativos», y que
// la app ABRA en Inicio.
import { useEffect } from 'react';
import { router } from 'expo-router';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePaleta } from '../../tema/material';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { usePestanaRapida } from '../../componentes/pestanaRapida';
import { avisosSinLeer } from '../leer-avisos';
import { usePorDecidir } from '../../componentes/porDecidir';

const CADA = 2 * 60 * 1000;

// «Por decidir» se mantiene al día sola: al entrar, cada dos minutos, al volver
// a la app y cuando llega un aviso. Así el globo de la campana dice la verdad
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

// Los avisos sin leer se muestran al entrar, una vez por sesión (por persona:
// si sale y entra otra, a ella también). Espera a que el arranque haya traído
// los comunicados; si no hay ninguno sin leer, no hace nada.
let yaMostradosA = null;
function useAvisosAlEntrar() {
  const { user } = useAuth();
  const comunicados = useStaffStore((s) => s.announcements);
  const roles = useStaffStore((s) => s.roles);
  useEffect(() => {
    if (!user?.id || yaMostradosA === user.id || !comunicados?.length || !roles?.length) return;
    if (!avisosSinLeer(comunicados, user, roles).length) { yaMostradosA = user.id; return; }
    yaMostradosA = user.id;
    const t = setTimeout(() => router.push('/leer-avisos'), 400);
    return () => clearTimeout(t);
  }, [user, comunicados, roles]);
}

// Transparente: detrás de cada pestaña está la aurora de la raíz.
const TRANSPARENTE = { backgroundColor: 'transparent' };

export default function Pestanas() {
  // El globo vive ahora en la campana de la barra (BotonCampana): esto sólo
  // mantiene «Por decidir» al día.
  useMantenerPorDecidir();
  useAvisosAlEntrar();
  const { user, hasPermission } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const { actual: rapida } = usePestanaRapida(user, hasPermission, salas);
  // Android: la barra de navegación de Material con la paleta del sistema
  // (tema/material.js), la misma de las piezas de Compose.
  const p = usePaleta();
  const colores = Platform.OS === 'android' && p ? {
    backgroundColor: p.surfaceContainer, indicatorColor: p.secondaryContainer, rippleColor: p.primary,
    iconColor: { default: p.onSurfaceVariant, selected: p.onSecondaryContainer },
    labelStyle: { default: { color: p.onSurfaceVariant }, selected: { color: p.onSurface } },
  } : {};
  return (
    <NativeTabs labelVisibilityMode="labeled" {...colores}>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="inicio">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="menu">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="apps" />
        <NativeTabs.Trigger.Label>Menú</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* La pestaña rápida (2026-11-11): un módulo que cada quien elige en
          Cuenta › Pestaña rápida. Ver componentes/pestanaRapida.js. */}
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="rapida" hidden={!rapida}>
        <NativeTabs.Trigger.Icon sf={rapida?.sf || 'star'} md={rapida?.md || 'star'} />
        <NativeTabs.Trigger.Label>{rapida?.label || ' '}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger contentStyle={TRANSPARENTE} name="yo">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Cuenta</NativeTabs.Trigger.Label>
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
