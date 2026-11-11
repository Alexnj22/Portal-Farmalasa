// Cada pestaña lleva su propia pila, que es lo que le da la barra de título del
// sistema (con el título grande de iOS donde corresponde).
//
// La barra es la de iOS de verdad: transparente arriba y con el vidrio del
// sistema cuando el contenido pasa por debajo, como Ajustes o Mensajes. Con un
// fondo de color fijo (lo que había) se veía blanca al desplazar, y el título
// grande salía oscuro sobre oscuro en modo oscuro (usuario, 2026-09-30).
import { Image, Platform, View } from 'react-native';
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
// logo va en TRES capas, cada una con su color explícito: el blanco de abajo,
// el verde y el morado. Las tres miden lo mismo (932×171, con margen) y se
// apilan.
//
// EL LOGO ES EL ORIGINAL (usuario, 2026-11-11: «el logo siempre debe ser el
// original») con un borde blanco detrás, que el usuario eligió después de
// varias vueltas: borde fino y redondeado; cada renglón relleno de blanco de
// punta a punta, con aire a los lados (sin huecos entre letra y letra); el
// blanco de «FARMACIAS» unido al renglón de abajo con su mismo ancho; y el
// ícono sobre un círculo blanco. Las letras y sus colores no se tocan, en
// claro ni en oscuro. Las capas verde y morada son las de apps/clientes/assets
// con margen; la blanca se generó de ellas (dilatación redonda de 6 px sobre
// los renglones macizos y el círculo del ícono).
const ANCHO_LOGO = 204;
const CAPA_LOGO = { position: 'absolute', left: 0, top: 0, width: ANCHO_LOGO, height: Math.round(ANCHO_LOGO * 171 / 932) };
function LogoEncabezado() {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Farmacias La Popular y La Salud" style={{ width: CAPA_LOGO.width, height: CAPA_LOGO.height }}>
      <Image source={require('../assets/logo-farmacias-blanco.png')} resizeMode="contain" style={[CAPA_LOGO, { tintColor: '#FFFFFF' }]} />
      <Image source={require('../assets/logo-farmacias-verde.png')} resizeMode="contain" style={[CAPA_LOGO, { tintColor: '#8EC30F' }]} />
      <Image source={require('../assets/logo-farmacias-morado.png')} resizeMode="contain" style={[CAPA_LOGO, { tintColor: '#981D97' }]} />
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
