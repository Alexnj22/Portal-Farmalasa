// Los filtros de una pantalla, a la manera del sistema (decisión del usuario
// del 2026-09-30, «muy bien, sí, hazlo»): la FilterBar del portal NO viaja a la
// app. En su lugar:
//
//   · el ESTADO va en el control segmentado (`Segmentos`), fuera de acá;
//   · lo SECUNDARIO —sala, tipo, semana— va en un botón de filtro en la barra
//     de arriba que abre el menú nativo con palomitas, como Mail o Archivos.
//     Cuando hay algo aplicado, el ícono se rellena;
//   · y lo aplicado se ve debajo, en fichas con ✕ (`FiltrosActivos`), sólo
//     mientras haya algo: un filtro que no se ve es un filtro que se olvida.
//
// Un grupo es { id, titulo, opciones: [{ id, label }], activa, porDefecto,
// onCambiar }. `porDefecto` es el valor «sin filtro» (típicamente 'todas').
//
// La campana va en la misma barra, como botón del sistema con su globo: la
// barra de la derecha es UNA, y declarar la del filtro reemplaza la campana
// que pone la raíz.
import { Platform, Pressable, ScrollView, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import Vidrio from './Vidrio';
import { colorSistema } from './Formulario';

const esIOS = Platform.OS === 'ios';
const activo = (g) => g.activa !== g.porDefecto;

export function MenuDeFiltros({ grupos }) {
  const sinLeer = useStaffStore((s) => s.notifications.length);
  const visibles = grupos.filter((g) => g.opciones.length > 1);
  const hayActivo = visibles.some(activo);
  return (
    <Stack.Toolbar placement="right">
      {visibles.length ? (
        <Stack.Toolbar.Menu accessibilityLabel="Filtros"
          icon={esIOS ? (hayActivo ? 'line.3.horizontal.decrease.circle.fill' : 'line.3.horizontal.decrease.circle') : undefined}>
          {esIOS ? null : <Stack.Toolbar.Label>Filtros</Stack.Toolbar.Label>}
          {visibles.map((g) => (
            <Stack.Toolbar.Menu key={g.id} inline title={g.titulo}>
              {g.opciones.map((o) => (
                <Stack.Toolbar.MenuAction key={o.id} isOn={g.activa === o.id}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); g.onCambiar(o.id); }}>
                  {o.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ))}
        </Stack.Toolbar.Menu>
      ) : null}
      <Stack.Toolbar.Button icon={esIOS ? 'bell' : undefined} accessibilityLabel="Notificaciones"
        onPress={() => router.navigate('/avisos')}>
        {esIOS ? null : <Stack.Toolbar.Label>Avisos</Stack.Toolbar.Label>}
        {sinLeer ? <Stack.Toolbar.Badge>{sinLeer > 99 ? '99+' : String(sinLeer)}</Stack.Toolbar.Badge> : null}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

export function FiltrosActivos({ grupos }) {
  const puestos = grupos.filter(activo);
  if (!puestos.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {puestos.map((g) => (
        <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`Quitar filtro ${g.titulo}`}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); g.onCambiar(g.porDefecto); }}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}>
          <Vidrio radio={16} interactivo tinte="rgba(0,82,204,0.30)">
            <Text style={{ paddingHorizontal: 12, paddingVertical: 6, fontSize: 14, fontWeight: '600', color: colorSistema.texto }}>
              {g.opciones.find((o) => o.id === g.activa)?.label ?? g.activa}  ✕
            </Text>
          </Vidrio>
        </Pressable>
      ))}
    </ScrollView>
  );
}
