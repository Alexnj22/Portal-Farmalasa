// Inicio: quién soy y los módulos que puedo abrir. La lista sale del MISMO
// registro que el menú del portal (`MODULE_MAP`) filtrado con el MISMO
// `hasPermission`: la app no decide qué ve cada cargo, lo decide el portal.
import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { MODULE_MAP } from '@nucleo/constants/moduleMap';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Boton from '../componentes/Boton';
import { useTema } from '../tema/tema';
import { PANTALLAS_DE_LA_APP } from '../pantallas';

export default function Inicio() {
  const { user, hasPermission, permsLoading, logout } = useAuth();
  const tema = useTema();

  // Un módulo por destino: dos permisos pueden abrir la misma pantalla (Mi caja
  // y Cortes son una sola), igual que el `dedupe` por `path` del menú web.
  const modulos = useMemo(() => {
    const vistos = new Set();
    return Object.entries(MODULE_MAP)
      .filter(([clave]) => hasPermission(clave))
      .filter(([, m]) => (vistos.has(m.path) ? false : vistos.add(m.path)))
      .map(([clave, m]) => ({ clave, ...m, lista: !!PANTALLAS_DE_LA_APP[m.path] }));
  }, [hasPermission]);

  if (!user) return null;

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={
        <View style={{ gap: 4, marginBottom: 8 }}>
          <Text style={{ color: tema.color.texto, fontSize: tema.texto.titulo, fontWeight: '800' }}>{shortEmployeeName(user)}</Text>
          <Text style={{ color: tema.color.texto2, fontSize: tema.texto.cuerpo + 1 }}>
            {permsLoading ? 'Cargando tus permisos…' : `${modulos.length} módulos`}
          </Text>
        </View>
      }
      data={modulos}
      keyExtractor={(m) => m.clave}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(item.lista ? item.path : { pathname: '/pendiente', params: { nombre: item.label } })}
          style={({ pressed }) => ({
            minHeight: tema.tam.toque + 8,
            backgroundColor: tema.color.tarjeta,
            borderRadius: tema.radio.tarjeta,
            borderWidth: 1,
            borderColor: tema.color.borde,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Text style={{ color: tema.color.texto, fontSize: tema.texto.cuerpo + 3, fontWeight: '600' }}>{item.label}</Text>
          {!item.lista ? <Text style={{ color: tema.color.texto3, fontSize: tema.texto.caption + 2 }}>pronto</Text> : null}
        </Pressable>
      )}
      ListFooterComponent={<View style={{ marginTop: 16 }}><Boton onPress={logout}>Salir</Boton></View>}
    />
  );
}
