// Menú: los módulos que el cargo puede abrir, agrupados IGUAL que el menú del
// portal. Los grupos, su orden y quién ve qué salen del núcleo
// (`MENU_GROUPS` + `gruposVisibles`, los mismos que usa la web), así que la
// app no decide nada por su cuenta.
//
// Se ve como Ajustes de iOS sobre un fondo de pantalla (usuario, 2026-09-30:
// «sale el gradiente, pero los elementos son sólidos, no tienen efecto
// vidrio»): cada grupo es una tarjeta de VIDRIO sobre la aurora, con su título
// arriba, y cada módulo un renglón con su ícono en un cuadro de color. La
// lista del sistema (SwiftUI) no deja poner vidrio detrás de sus filas, por eso
// se arma a mano con el mismo vidrio del resto de la app.
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { MENU_GROUPS, gruposVisibles } from '@nucleo/constants/menuGroups';
import Vidrio from '../../../componentes/Vidrio';
import { colorSistema } from '../../../componentes/Formulario';
import { iconoDe } from '../../../tema/iconos';
import { abrirModulo } from '../../../pantallas';

// Lo que ya vive en otra pestaña (Inicio, Avisos, Yo) no se repite acá.
const EN_LA_BARRA = new Set(['overview', 'emp_announcements', 'emp_profile', 'emp_documents', 'requests_personales']);

// Un color por grupo, como los íconos de Ajustes: ayuda a encontrar la zona
// del menú sin leer. Son los de la marca y los de gráficas del portal.
const COLORES = ['#0052CC', '#12B76A', '#F79009', '#6929C4', '#E0457B', '#0BA5EC', '#F04438', '#8EC30F', '#981D97'];

// El petróleo de la marca de la distribuidora (COLORES_DISTRIBUIDORA.petroleo).
const COLOR_TOROGOZ = '#0f6e7d';

function Renglon({ m, color, primero }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); abrirModulo(m); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 12,
        backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Host matchContents><Icon name={iconoDe(m.icono)} size={17} color="#FFFFFF" /></Host>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 50,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17 }} numberOfLines={1}>{m.label}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
      </View>
    </Pressable>
  );
}

export default function Menu() {
  const { user, hasPermission, refreshPermissions } = useAuth();
  const [recargando, setRecargando] = useState(false);

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

  // Torogoz no está en los grupos de las farmacias (otro NIT; en el portal
  // tiene su propia entrada en `/torogoz`), así que va en su propia tarjeta.
  const torogoz = hasPermission('distribucion') ? { key: 'distribucion', ...MODULE_MAP.distribucion } : null;

  if (!user) return null;

  return (
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32, gap: 22 }}
      refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await refreshPermissions?.(user); setRecargando(false); }} />}>
      {bloques.map((b, i) => (
        <View key={b.key} style={{ gap: 7, marginHorizontal: 16 }}>
          {b.titulo ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>{b.titulo}</Text>
          ) : null}
          <Vidrio radio={22}>
            <View style={{ paddingVertical: 2 }}>
              {b.modulos.map((m, j) => <Renglon key={m.key} m={m} primero={!j} color={COLORES[i % COLORES.length]} />)}
            </View>
          </Vidrio>
        </View>
      ))}
      {torogoz ? (
        <View style={{ gap: 7, marginHorizontal: 16 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Distribuidora</Text>
          <Vidrio radio={22}>
            <View style={{ paddingVertical: 2 }}>
              <Renglon m={torogoz} primero color={COLOR_TOROGOZ} />
            </View>
          </Vidrio>
        </View>
      ) : null}
    </ScrollView>
  );
}
