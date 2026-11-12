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
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { MENU_GROUPS, gruposVisibles } from '@nucleo/constants/menuGroups';
import { puntosAl } from '@nucleo/utils/ordenPorUso';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import Vidrio from '../../../componentes/Vidrio';
import { colorSistema } from '../../../componentes/Formulario';
import { iconoDe } from '../../../tema/iconos';
import { FUERA_DE_LA_APP, abrirModulo } from '../../../pantallas';
import FranjaDelPortal from '../../../componentes/FranjaDelPortal';
import EstadoDeDatos from '../../../componentes/EstadoDeDatos';
import { anotar, leerUso } from '../../../componentes/inicio/uso';
import { MARCA, PETROLEO } from '../../../componentes/inicio/marca';

// Lo que ya vive en otra pestaña (Inicio, Avisos, Yo) no se repite acá.
// «Mis avisos» vuelve al Menú (2026-11-11): vivía dentro de la pestaña
// Notificaciones, que se quitó, y quedó sin entrada.
const EN_LA_BARRA = new Set(['overview', 'emp_profile', 'emp_documents', 'requests_personales']);

// Un color por grupo, como los íconos de Ajustes: ayuda a encontrar la zona
// del menú sin leer. Son los de la marca y los de gráficas del portal.
const COLORES = [MARCA.azul, MARCA.verde, MARCA.ambar, MARCA.violeta, MARCA.rosa, '#0BA5EC', MARCA.rojo, '#8EC30F', '#981D97'];

// El petróleo de la marca de la distribuidora (COLORES_DISTRIBUIDORA.petroleo).
const COLOR_TOROGOZ = PETROLEO;

// «Lo que más abres» arriba: con decenas de módulos, lo de todos los días no
// puede quedar a tres pantallazos. Sale del mismo registro de uso del Inicio.
const CLAVE_DE_USO = (key) => `menu.${key}`;
const MAX_FRECUENTES = 5;
const USO_MINIMO = 0.75;

function Renglon({ m, color, primero, grupo, onAbrir }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onAbrir?.(m); abrirModulo(m); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 12,
        backgroundColor: pressed ? 'rgba(127,127,127,0.18)' : 'transparent' })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Host matchContents><Icon name={iconoDe(m.icono)} size={17} color="#FFFFFF" /></Host>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 50,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
        <View style={{ flex: 1, paddingVertical: grupo ? 6 : 0 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17 }} numberOfLines={1}>{m.label}</Text>
          {grupo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{grupo}</Text> : null}
        </View>
        <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
      </View>
    </Pressable>
  );
}

export default function Menu() {
  const { user, hasPermission, refreshPermissions } = useAuth();
  const [recargando, setRecargando] = useState(false);
  const [texto, setTexto] = useState('');
  // Se fija al abrir, como el Inicio: la lista no se reacomoda bajo el dedo.
  const [uso] = useState(() => leerUso(user?.id));
  const alAbrir = (m) => anotar(user?.id, CLAVE_DE_USO(m.key));

  const grupos = useMemo(() => gruposVisibles(MENU_GROUPS, MODULE_MAP, (k) => !EN_LA_BARRA.has(k) && !FUERA_DE_LA_APP.has(k) && hasPermission(k)),
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

  const todos = useMemo(() => {
    const lista = [];
    bloques.forEach((b, i) => b.modulos.forEach((m) => { lista.push({ m, grupo: b.titulo, color: COLORES[i % COLORES.length] }); }));
    if (torogoz) lista.push({ m: torogoz, grupo: 'Distribuidora', color: COLOR_TOROGOZ });
    return lista;
  }, [bloques, torogoz?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const frecuentes = useMemo(() => todos
    .map((x) => ({ ...x, p: puntosAl(uso[CLAVE_DE_USO(x.m.key)]) }))
    .filter((x) => x.p >= USO_MINIMO).sort((a, b) => b.p - a.p).slice(0, MAX_FRECUENTES), [todos, uso]);

  const q = texto.trim();
  const resultados = q ? todos.filter((x) => tokenMatch(q, `${x.m.label} ${x.grupo ?? ''}`)) : null;

  if (!user) return null;

  const busqueda = (
    <Stack.Screen options={{ headerSearchBarOptions: {
      placeholder: 'Buscar módulo', hideWhenScrolling: false, autoCapitalize: 'none',
      onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
    } }} />
  );

  if (resultados) {
    return (
      <>
        {busqueda}
        <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32, paddingHorizontal: 16 }}>
          {resultados.length ? (
            <Vidrio radio={20}>
              <View style={{ paddingVertical: 2 }}>
                {resultados.map((x, j) => <Renglon key={x.m.key} m={x.m} primero={!j} color={x.color} grupo={x.grupo} onAbrir={alAbrir} />)}
              </View>
            </Vidrio>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 6 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>Nada con ese nombre</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Prueba con otra palabra, o revisa si tu cargo tiene ese módulo.</Text>
            </View>
          )}
        </ScrollView>
      </>
    );
  }

  return (
    <>
    {busqueda}
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32, gap: 22 }}
      refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await refreshPermissions?.(user); setRecargando(false); }} />}>
      <FranjaDelPortal />
      {frecuentes.length >= 2 ? (
        <View style={{ gap: 7, marginHorizontal: 16 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Lo que más abres</Text>
          <Vidrio radio={20}>
            <View style={{ paddingVertical: 2 }}>
              {frecuentes.map((x, j) => <Renglon key={x.m.key} m={x.m} primero={!j} color={x.color} onAbrir={alAbrir} />)}
            </View>
          </Vidrio>
        </View>
      ) : null}
      {bloques.map((b, i) => (
        <View key={b.key} style={{ gap: 7, marginHorizontal: 16 }}>
          {b.titulo ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>{b.titulo}</Text>
          ) : null}
          <Vidrio radio={20}>
            <View style={{ paddingVertical: 2 }}>
              {b.modulos.map((m, j) => <Renglon key={m.key} m={m} primero={!j} color={COLORES[i % COLORES.length]} onAbrir={alAbrir} />)}
            </View>
          </Vidrio>
        </View>
      ))}
      {torogoz ? (
        <View style={{ gap: 7, marginHorizontal: 16 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Distribuidora</Text>
          <Vidrio radio={20}>
            <View style={{ paddingVertical: 2 }}>
              <Renglon m={torogoz} primero color={COLOR_TOROGOZ} onAbrir={alAbrir} />
            </View>
          </Vidrio>
        </View>
      ) : null}
      {/* El estado de los datos, como el recuadro del menú de Ajustes del portal. */}
      <EstadoDeDatos />
    </ScrollView>
    </>
  );
}
