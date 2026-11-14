// Las pestañas en el NAVEGADOR (app.farmasalud.lat, 2026-11-14).
//
// `NativeTabs` en web no es la barra del teléfono: la pinta ARRIBA, como una
// fila de pestañas de texto sin íconos, encima del encabezado, y con cinco
// pestañas «Cuenta» se salía de la pantalla («no se ve como la app, mira la
// barra de menú»). Acá va la barra de abajo del iPhone: flotante, de vidrio,
// ícono sobre rótulo, la elegida en el magenta de la marca con la píldora
// detrás, y el número del carrito.
//
// Las MISMAS cinco pestañas, en el mismo orden y con los mismos rótulos e
// íconos que `_layout.js` (los `md=` de allá son los nombres de acá): al
// cambiar una allá, cambiarla acá.
import { Pressable, Text, View } from 'react-native';
import { Tabs, ThemeProvider, useTheme } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colorSistema } from '../../componentes/sistema';
import { suave, useTema } from '../../tema/tema';
import { useCarrito } from '../../lib/carrito';
export { default as ErrorBoundary } from '../../componentes/ErrorDePantalla';

const PESTANAS = [
  { name: 'puntos', rotulo: 'Inicio', icono: 'home' },
  { name: 'catalogo', rotulo: 'Tienda Salud', icono: 'storefront' },
  { name: 'bienestar', rotulo: 'Bienestar', icono: 'spa' },
  { name: 'carrito', rotulo: 'Carrito', icono: 'shopping_cart' },
  { name: 'cuenta', rotulo: 'Cuenta', icono: 'account_circle' },
];

function IconoPestana({ nombre, elegida, color }) {
  return (
    <Text
      aria-hidden
      style={{
        fontFamily: 'Material Symbols Rounded', fontSize: 26, lineHeight: 28, height: 28, color, userSelect: 'none',
        fontVariationSettings: `'FILL' ${elegida ? 1 : 0}, 'wght' ${elegida ? 600 : 400}`,
      }}>
      {nombre}
    </Text>
  );
}

function Barra({ state, navigation }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const enCarrito = useCarrito((s) => s.items.length);
  const inactivo = colorSistema.texto2;
  return (
    // Flota ENCIMA del contenido (como el vidrio del iPhone): lo de la
    // pestaña pasa por detrás y se ve borroso a través de la barra. Cada
    // pestaña deja el margen de abajo con `ALTO_BARRA_WEB` (componentes/ui.js).
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(ins.bottom, 10), alignItems: 'center' }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row', width: '100%', maxWidth: 520, padding: 4, borderRadius: 999,
          backgroundColor: t.oscuro ? 'rgba(40,38,46,0.72)' : 'rgba(255,255,255,0.78)',
          borderWidth: 1, borderColor: t.oscuro ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
          backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          boxShadow: t.oscuro ? '0 8px 30px rgba(0,0,0,0.45)' : '0 8px 30px rgba(0,0,0,0.12)',
        }}>
        {state.routes.map((ruta, i) => {
          const p = PESTANAS.find((x) => x.name === ruta.name);
          if (!p) return null;
          const elegida = state.index === i;
          const color = elegida ? t.color.magenta : inactivo;
          const alTocar = () => {
            const ev = navigation.emit({ type: 'tabPress', target: ruta.key, canPreventDefault: true });
            if (!elegida && !ev.defaultPrevented) navigation.navigate(ruta.name, ruta.params);
          };
          return (
            <Pressable
              key={ruta.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: elegida }}
              accessibilityLabel={p.name === 'carrito' && enCarrito ? `${p.rotulo}, ${enCarrito}` : p.rotulo}
              onPress={alTocar}
              style={({ pressed }) => ({
                flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 999,
                backgroundColor: elegida ? suave(t.color.magenta, t.oscuro ? 0.22 : 0.12) : 'transparent',
                transform: [{ scale: pressed ? 0.94 : 1 }], cursor: 'pointer',
              })}>
              <View>
                <IconoPestana nombre={p.icono} elegida={elegida} color={color} />
                {p.name === 'carrito' && enCarrito ? (
                  <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: colorSistema.rojo, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>{String(enCarrito)}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 10.5, fontWeight: elegida ? '700' : '500', color }}>{p.rotulo}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Pestanas() {
  // El contenedor de las pestañas toma el fondo del tema (opaco): tapaba la
  // aurora de la raíz alrededor de la barra y dejaba una franja negra abajo.
  const tema = useTheme();
  return (
    <ThemeProvider value={{ ...tema, colors: { ...tema.colors, background: 'transparent' } }}>
    <Tabs
      backBehavior="initialRoute"
      tabBar={(props) => <Barra {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
      {PESTANAS.map((p) => <Tabs.Screen key={p.name} name={p.name} options={{ title: p.rotulo }} />)}
    </Tabs>
    </ThemeProvider>
  );
}
