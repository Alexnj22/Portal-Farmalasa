// Menú: los módulos que el cargo puede abrir, agrupados IGUAL que el menú del
// portal. Los grupos, su orden y quién ve qué salen del núcleo
// (`MENU_GROUPS` + `gruposVisibles`, los mismos que usa la web), así que la
// app no decide nada por su cuenta. Lista del sistema: SwiftUI en iPhone,
// Compose en Android.
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { Host, Icon, ListItem } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { MENU_GROUPS, gruposVisibles } from '@nucleo/constants/menuGroups';
import Seccion from '../../../componentes/Seccion';
import Lista from '../../../componentes/Lista';
import { useTema } from '../../../tema/tema';
import { iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';

// Lo que ya vive en otra pestaña (Inicio, Avisos, Yo) no se repite acá.
const EN_LA_BARRA = new Set(['overview', 'emp_announcements', 'emp_profile', 'emp_documents', 'requests_personales']);

export default function Menu() {
  const { user, hasPermission, refreshPermissions } = useAuth();
  const tema = useTema();
  const oscuro = useColorScheme() === 'dark';

  const grupos = useMemo(() => gruposVisibles(MENU_GROUPS, MODULE_MAP, (k) => !EN_LA_BARRA.has(k) && hasPermission(k)),
    [hasPermission]);

  // Un grupo de un solo módulo no lleva título (el web lo pinta plano, sin
  // acordeón); los que vienen seguidos se juntan en una sola tarjeta para que
  // la lista no sea una fila de tarjetas de un renglón.
  const bloques = useMemo(() => grupos.reduce((acc, g) => {
    const suelto = g.visibleModules.length === 1;
    const ultimo = acc[acc.length - 1];
    if (suelto && ultimo && !ultimo.titulo) ultimo.modulos.push(...g.visibleModules);
    else acc.push({ key: g.key, titulo: suelto ? undefined : g.label, modulos: [...g.visibleModules] });
    return acc;
  }, []), [grupos]);

  if (!user) return null;

  return (
    <Host style={{ flex: 1 }} colorScheme={oscuro ? 'dark' : 'light'}>
      <Lista onRefresh={async () => { await refreshPermissions?.(user); }}>
        {bloques.map((b) => (
          <Seccion key={b.key} titulo={b.titulo}>
            {b.modulos.map((m) => (
              <ListItem key={m.key} onPress={() => abrirModulo(m)}
                leading={<Icon name={iconoDe(m.icono)} size={20} color={tema.color.marca} />}>
                {m.label}
              </ListItem>
            ))}
          </Seccion>
        ))}
      </Lista>
    </Host>
  );
}
