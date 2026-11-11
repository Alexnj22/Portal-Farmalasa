// La campana arriba a la derecha, en las pantallas que tapan la barra de
// pestañas (el portal abierto desde el Menú, las pantallas nativas). Pedido del
// usuario del 2026-09-30: «el header solo tiene el botón atrás… ni las
// notificaciones». Lleva a la pestaña Avisos y muestra cuántas faltan leer.
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Host, Icon } from '@expo/ui';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useTema } from '../tema/tema';
import { iconoDe } from '../tema/iconos';
import { usePorDecidir } from './porDecidir';

export default function BotonCampana() {
  const tema = useTema();
  // Lo que falta leer más lo que falta DECIDIR (2026-11-11): era el globo de la
  // pestaña Notificaciones, que se quitó; un aviso leído sobre algo todavía
  // pendiente sigue pidiendo atención.
  const sinLeer = useStaffStore((s) => s.notifications.filter((n) => !n.read_at && !n.deleted_at).length) + usePorDecidir((s) => s.items.length);
  return (
    <Pressable onPress={() => router.navigate('/avisos')} hitSlop={10}
      accessibilityRole="button" accessibilityLabel={sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}>
      <Host matchContents>
        <Icon name={iconoDe('Bell')} size={22} color={tema.color.texto} />
      </Host>
      {sinLeer ? (
        <View style={{ position: 'absolute', top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: tema.color.peligro, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{sinLeer > 99 ? '99+' : sinLeer}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
