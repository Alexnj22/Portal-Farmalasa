// Inicio: los módulos que el cargo puede abrir, como lista NATIVA del sistema
// (SwiftUI en iPhone, Jetpack Compose en Android — decisión del usuario del
// 2026-09-29). La lista sale del MISMO registro que el menú del portal
// (`MODULE_MAP`) con el MISMO `hasPermission`: la app no decide qué ve cada
// cargo, lo decide el portal.
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { router, Stack } from 'expo-router';
import { Host, Icon, List, ListItem } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useTema } from '../tema/tema';
import { ICONO_SALIR, iconoDe } from '../tema/iconos';
import { PANTALLAS_DE_LA_APP } from '../pantallas';

export default function Inicio() {
  const { user, hasPermission, logout, refreshPermissions } = useAuth();
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';

  // Un módulo por destino: dos permisos pueden abrir la misma pantalla (Mi caja
  // y Cortes son una sola), igual que el `dedupe` por `path` del menú web.
  const modulos = useMemo(() => {
    const vistos = new Set();
    return Object.entries(MODULE_MAP)
      .filter(([clave]) => hasPermission(clave))
      .filter(([, m]) => (vistos.has(m.path) ? false : vistos.add(m.path)))
      .map(([clave, m]) => ({ clave, ...m, nativa: !!PANTALLAS_DE_LA_APP[m.path] }));
  }, [hasPermission]);

  if (!user) return null;

  const abrir = (m) => router.push(m.nativa ? m.path : { pathname: '/portal', params: { ruta: m.path, nombre: m.label } });

  return (
    <>
      <Stack.Screen options={{ title: shortEmployeeName(user) }} />
      <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
        <List onRefresh={async () => { await refreshPermissions?.(user); }}>
          {modulos.map((m) => (
            <ListItem key={m.clave} onPress={() => abrir(m)}
              leading={<Icon name={iconoDe(m.icono)} size={20} color={tema.color.marca} />}>
              {m.label}
            </ListItem>
          ))}
          <ListItem onPress={logout}
            leading={<Icon name={ICONO_SALIR} size={20} color={tema.color.peligro} />}>
            Salir
          </ListItem>
        </List>
      </Host>
    </>
  );
}
