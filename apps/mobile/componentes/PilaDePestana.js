// Cada pestaña lleva su propia pila, que es lo que le da la barra de título del
// sistema (con el título grande de iOS donde corresponde).
//
// La barra es la de iOS de verdad: transparente arriba y con el vidrio del
// sistema cuando el contenido pasa por debajo, como Ajustes o Mensajes. Con un
// fondo de color fijo (lo que había) se veía blanca al desplazar, y el título
// grande salía oscuro sobre oscuro en modo oscuro (usuario, 2026-09-30).
import { Image, Platform, useColorScheme, View } from 'react-native';
import { Stack } from 'expo-router';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useAuth } from '@nucleo/context/AuthContext';
import ConAurora from './ConAurora';
import BotonCampana from './BotonCampana';
import { FotoDeCuenta } from './inicio/Encabezado';

// En iOS 26 el sistema ya pone su «borde suave» al desplazar (scroll edge
// effect): sumarle un desenfoque propio los encima y se ve doble. El
// desenfoque queda sólo para iOS anteriores.
const IOS26 = Platform.OS === 'ios' && isLiquidGlassAvailable();
export const BARRA_NATIVA = Platform.OS === 'ios'
  ? { headerTransparent: true, ...(IOS26 ? {} : { headerBlurEffect: 'systemChromeMaterial' }), headerShadowVisible: false, headerLargeTitleShadowVisible: false, headerLargeStyle: { backgroundColor: 'transparent' } }
  : {};

// `sinBarra`: la pestaña muestra el portal, que ya trae su propio título.
// El encabezado de marca (2026-11-11, a pedido del usuario: «como la app de
// clientes»): el logo de Farmacias La Popular y La Salud al centro, la foto a
// la izquierda (lleva a Cuenta) y la campana a la derecha, en TODAS las
// pestañas. El logo reemplaza al título grande; el nombre de cada pestaña ya
// lo dice la barra de abajo.
//
// iOS pinta con el tinte del sistema una imagen dentro de la barra, así que el
// logo va en dos capas (las mismas de apps/clientes/assets), cada una con su
// color explícito.
//
// Historia (2026-11-11, todo el mismo día): original → borde blanco en varias
// formas → «se ve horrible, déjalo mejor blanco completo y quitemos la versión
// con borde». En OSCURO el logo va TODO en blanco (las dos capas). En CLARO el
// blanco no se vería sobre la barra casi blanca, así que va el original en sus
// colores. Sin borde en ningún modo.
const ANCHO_LOGO = 200;
const CAPA_LOGO = { position: 'absolute', left: 0, top: 0, width: ANCHO_LOGO, height: Math.round(ANCHO_LOGO * 119 / 880) };
function LogoEncabezado() {
  const oscuro = useColorScheme() === 'dark';
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Farmacias La Popular y La Salud" style={{ width: CAPA_LOGO.width, height: CAPA_LOGO.height }}>
      <Image source={require('../assets/logo-farmacias-verde.png')} resizeMode="contain" style={[CAPA_LOGO, { tintColor: oscuro ? '#FFFFFF' : '#8EC30F' }]} />
      <Image source={require('../assets/logo-farmacias-morado.png')} resizeMode="contain" style={[CAPA_LOGO, { tintColor: oscuro ? '#FFFFFF' : '#981D97' }]} />
    </View>
  );
}

// iOS envuelve lo que va en la barra en una burbuja de vidrio: con la foto
// adentro había doble fondo y la foto quedaba chica (mismo arreglo que la app
// de clientes, app/(tabs)/puntos/index.js).
function fotoEnEncabezado(user) {
  const foto = <FotoDeCuenta user={user} tamano={34} />;
  return Platform.OS === 'ios'
    ? { unstable_headerLeftItems: () => [{ type: 'custom', element: foto, hidesSharedBackground: true }] }
    : { headerLeft: () => foto };
}

export default function PilaDePestana({ titulo, sinBarra = false }) {
  const { user } = useAuth();
  const marca = {
    headerTitle: () => <LogoEncabezado />,
    headerTitleAlign: 'center',
    headerRight: () => <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><BotonCampana /></View>,
    ...fotoEnEncabezado(user),
  };
  return (
    <ConAurora>
    <Stack screenOptions={{ contentStyle: { backgroundColor: 'transparent' }, ...BARRA_NATIVA }}>
      <Stack.Screen name="index" options={{ title: titulo, headerShown: !sinBarra, ...marca }} />
    </Stack>
    </ConAurora>
  );
}
