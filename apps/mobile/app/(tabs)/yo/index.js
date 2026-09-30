// Yo: lo personal —perfil, documentos, solicitudes— y salir. Es lo que en el
// portal vive en el menú del empleado y en la esquina del usuario.
import { useEffect, useState } from 'react';
import { Alert, useColorScheme } from 'react-native';
import { Host, Icon, ListItem, Switch } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import Seccion from '../../../componentes/Seccion';
import Lista from '../../../componentes/Lista';
import { useTema } from '../../../tema/tema';
import { ICONO_SALIR, iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';
import { biometriaActiva, nombreBiometria, olvidarBiometria } from '../../../componentes/biometria';
import { soltarAvisos } from '../../../componentes/avisos';

const PERSONALES = ['emp_profile', 'emp_documents', 'requests_personales'];

export default function Yo() {
  const { user, hasPermission, logout } = useAuth();
  const salas = useStaffStore((s) => s.branches);
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';
  const [biometria, setBiometria] = useState({ nombre: null, activa: false });
  useEffect(() => {
    (async () => setBiometria({ nombre: await nombreBiometria(), activa: await biometriaActiva() }))();
  }, []);
  if (!user) return null;

  // Activar pide la contraseña, así que se hace al entrar: desde acá sólo se
  // quita. Encenderlo acá lleva a salir y entrar con la contraseña.
  const cambiarBiometria = (quiere) => {
    if (!quiere) {
      olvidarBiometria();
      setBiometria((b) => ({ ...b, activa: false }));
      return;
    }
    Alert.alert(`Activar ${biometria.nombre}`,
      `Para guardarlo hay que entrar una vez con la contraseña. Sal y, al entrar, elige «Usar ${biometria.nombre}».`,
      [{ text: 'Entendido' }]);
  };

  const idSala = salaDelUsuario(user);
  const sala = (salas || []).find((b) => String(b.id) === String(idSala))?.name;
  const cargo = typeof user.role === 'string' && isNaN(Number(user.role)) ? user.role : '';
  const modulos = PERSONALES.filter((k) => hasPermission(k)).map((k) => ({ key: k, ...MODULE_MAP[k] }));

  const salir = () => Alert.alert('¿Salir de la app?', 'Vas a tener que volver a entrar con tu usuario.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Salir', style: 'destructive', onPress: async () => { await soltarAvisos(); logout?.(); } },
  ]);

  return (
    <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
      <Lista>
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
        {biometria.nombre ? (
          <Seccion>
            <ListItem trailing={<Switch value={biometria.activa} onValueChange={cambiarBiometria} />}>
              {`Entrar con ${biometria.nombre}`}
            </ListItem>
          </Seccion>
        ) : null}
        <Seccion>
          <ListItem onPress={salir} leading={<Icon name={ICONO_SALIR} size={20} color={tema.color.peligro} />}>
            Salir
          </ListItem>
        </Seccion>
      </Lista>
    </Host>
  );
}
