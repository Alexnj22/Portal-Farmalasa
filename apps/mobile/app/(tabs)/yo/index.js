// Yo: lo personal —perfil, documentos, solicitudes— y salir. Es lo que en el
// portal vive en el menú del empleado y en la esquina del usuario.
import { Alert, useColorScheme } from 'react-native';
import { Host, Icon, List, ListItem } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Seccion from '../../../componentes/Seccion';
import { useTema } from '../../../tema/tema';
import { ICONO_SALIR, iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';

const PERSONALES = ['emp_profile', 'emp_documents', 'requests_personales'];

export default function Yo() {
  const { user, hasPermission, logout } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  if (!user) return null;

  const idSala = salaDelUsuario(user);
  const sala = (salas || []).find((b) => String(b.id) === String(idSala))?.name;
  const cargo = typeof user.role === 'string' && isNaN(Number(user.role)) ? user.role : '';
  const modulos = PERSONALES.filter((k) => hasPermission(k)).map((k) => ({ key: k, ...MODULE_MAP[k] }));

  const salir = () => Alert.alert('¿Salir de la app?', 'Vas a tener que volver a entrar con tu usuario.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Salir', style: 'destructive', onPress: () => logout?.() },
  ]);

  return (
    <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
      <List>
        <Seccion>
          <ListItem supporting={[cargo, sala].filter(Boolean).join(' · ') || undefined}
            leading={<Icon name={iconoDe('User')} size={28} color={tema.color.marca} />}>
            {shortEmployeeName(user)}
          </ListItem>
        </Seccion>
        {modulos.length > 0 && (
          <Seccion>
            {modulos.map((m) => (
              <ListItem key={m.key} onPress={() => abrirModulo(m)}
                leading={<Icon name={iconoDe(m.icono)} size={20} color={tema.color.marca} />}>
                {m.label}
              </ListItem>
            ))}
          </Seccion>
        )}
        <Seccion>
          <ListItem onPress={salir} leading={<Icon name={ICONO_SALIR} size={20} color={tema.color.peligro} />}>
            Salir
          </ListItem>
        </Seccion>
      </List>
    </Host>
  );
}
