// Avisos: la CAMPANA del portal, nativa (pedido del usuario del 2026-09-30:
// «no veo las notificaciones en la app»). Hasta ese día esta pestaña abría
// «Mis avisos» —los comunicados— y la campana no estaba en ningún lado.
//
// Es la misma bandeja del portal y con las mismas reglas, porque sale del mismo
// store: `fetchNotifications` trae SÓLO lo no leído (la campana es lo que falta
// atender; lo leído sigue en el historial) y `useNotificationsChannel`, montado
// en la raíz, la mantiene al día en vivo. Tocar un aviso lo marca leído y abre
// su pantalla, igual que en la web.
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { Button, Host, Icon, List, ListItem } from '@expo/ui';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cuandoLlego, tituloSinEmoji } from '@nucleo/utils/notificacionTexto';
import Seccion from '../../../componentes/Seccion';
import { useTema } from '../../../tema/tema';
import { iconoDe } from '../../../tema/iconos';
import { abrirRuta } from '../../../pantallas';

export default function Avisos() {
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  const avisos = useStaffStore((s) => s.notifications);
  const recargar = useStaffStore((s) => s.fetchNotifications);
  const marcarLeido = useStaffStore((s) => s.markNotificationRead);
  const marcarTodos = useStaffStore((s) => s.markAllNotificationsRead);

  const abrir = (n) => {
    marcarLeido(n.id);
    if (n.link) abrirRuta(n.link);
  };

  return (
    <>
      <Stack.Screen options={{
        headerRight: avisos.length ? () => (
          <Host matchContents>
            <Button variant="text" label="Leer todos" onPress={() => marcarTodos()} />
          </Host>
        ) : undefined,
      }} />
      <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
        <List onRefresh={async () => { await recargar(); }}>
          <Seccion titulo={avisos.length ? `${avisos.length} sin leer` : undefined}>
            {avisos.length ? avisos.map((n) => (
              <ListItem key={n.id} onPress={() => abrir(n)}
                supporting={[n.body, cuandoLlego(n.created_at)].filter(Boolean).join('\n')}
                leading={<Icon name={iconoDe('Bell')} size={20} color={tema.color.marca} />}>
                {tituloSinEmoji(n.title)}
              </ListItem>
            )) : (
              <ListItem supporting="Lo que llegue aparece acá y en la barra de abajo.">
                Todo al día
              </ListItem>
            )}
          </Seccion>
          <Seccion>
            <ListItem onPress={() => abrirRuta('/notificaciones')}
              leading={<Icon name={iconoDe('Activity')} size={20} color={tema.color.marca} />}>
              Historial de avisos
            </ListItem>
            <ListItem onPress={() => abrirRuta('/mis-avisos')}
              leading={<Icon name={iconoDe('Megaphone')} size={20} color={tema.color.marca} />}>
              Comunicados
            </ListItem>
          </Seccion>
        </List>
      </Host>
    </>
  );
}
