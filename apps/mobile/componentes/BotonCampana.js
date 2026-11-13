// La campana arriba a la derecha, en las pantallas que tapan la barra de
// pestañas (el portal abierto desde el Menú, las pantallas nativas). Pedido del
// usuario del 2026-09-30: «el header solo tiene el botón atrás… ni las
// notificaciones». Lleva a la pestaña Avisos y muestra cuántas faltan leer.
import { Platform, Text, View } from 'react-native';
import { Presionable as Pressable } from './Tocable';
import { router } from 'expo-router';
import { Host, Icon } from '@expo/ui';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useTema } from '../tema/tema';
import { iconoDe } from '../tema/iconos';
import { usePorDecidir } from './porDecidir';
import IconoFijo from './IconoFijo';

const ANDROID = Platform.OS === 'android';

export default function BotonCampana() {
  const tema = useTema();
  // Lo que falta leer más lo que falta DECIDIR (2026-11-11): era el globo de la
  // pestaña Notificaciones, que se quitó; un aviso leído sobre algo todavía
  // pendiente sigue pidiendo atención.
  const sinLeer = useStaffStore((s) => s.notifications.filter((n) => !n.read_at && !n.deleted_at).length) + usePorDecidir((s) => s.items.length);
  return (
    // Con globo, el globo ENTRA en la caja: sobresalía 8 pt a la derecha fuera
    // de ella, así que la barra centraba sólo la campana y el conjunto se veía
    // corrido a la derecha (usuario, 2026-11-12). Con el relleno, lo que se
    // centra es campana + globo.
    // En Android la barra RECORTA lo que sale de la caja de cada botón: el globo
    // a -4 quedaba mocho arriba y a la derecha (usuario, 2026-11-12). Ahí la
    // caja lleva el aire arriba también y el globo va dentro.
    <Pressable onPress={() => router.navigate('/avisos')} hitSlop={10}
      style={ANDROID ? { paddingTop: 6, paddingRight: 8, paddingBottom: 6 } : { paddingRight: sinLeer ? 8 : 0 }}
      accessibilityRole="button" accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}>
      <IconoFijo name={iconoDe('Bell')} size={22} color={tema.color.texto} />
      {sinLeer ? (
        <View style={{ position: 'absolute', top: ANDROID ? 1 : -4, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: tema.color.peligro, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{sinLeer > 99 ? '99+' : sinLeer}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
