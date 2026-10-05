// Los avisos al teléfono del cliente. Se piden SÓLO cuando la persona lo activa
// en «Cuenta» —nunca al abrir la app—: el permiso del sistema se pregunta una
// vez, y gastarlo antes de que sepa para qué es lo pierde.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

/** Devuelve el token de avisos, o `{ error }` con una frase que se puede mostrar. */
export async function pedirTokenDeAvisos() {
  if (Platform.OS === 'web' || !Device.isDevice) return { error: 'Los avisos sólo funcionan en un teléfono.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ofertas', {
      name: 'Ofertas y puntos', importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return { error: 'Activa las notificaciones en los ajustes del teléfono.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { error: 'Los avisos todavía no están disponibles.' };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data };
  } catch {
    return { error: 'No se pudieron activar los avisos. Intenta más tarde.' };
  }
}
