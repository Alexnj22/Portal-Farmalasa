// La invitación a la app en la WEB (2026-11-25). Dos formas:
//
// • Teléfono Android → una hoja abajo (HojaAndroid, lo de abajo).
// • Computadora → una tarjeta fija al costado (TarjetaCostado): «Ya disponible
//   en Android», un QR para abrir Play con el teléfono y «Próximamente en App
//   Store» (pedido del usuario el mismo día). Se cierra con la ×, 7 días.
// • iPhone → nada todavía: la app de iOS no está aprobada.
//
// Hoja de Android (2026-11-25, pedido del usuario: «si revisan la app web y detecta que es
// android, lo mande a descargar la app»). Medido ese día en
// `app_cliente_sesiones`: ~15 sesiones `web` con modelos Android desde el
// 14-nov y ningún cliente real todavía en la app de Android.
//
// No es una redirección: una hoja abajo con «Descargar en Google Play» y
// «Seguir en la web». Quien la cierra no la vuelve a ver en 3 días (memoria
// del navegador; si no se puede leer, sale otra vez — es una invitación, no un
// dato). iPhone queda fuera hasta que App Store apruebe la app.
import { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useTema } from '../tema/tema';
import CodigoQR from './CodigoQR';

const PLAY = 'https://play.google.com/store/apps/details?id=com.wnapp.id1750888957164';
const CLAVE = 'descarga-android:cerrada';
const PAUSA_MS = 3 * 24 * 60 * 60 * 1000;

const CLAVE_COSTADO = 'descarga-costado:cerrada';
const PAUSA_COSTADO_MS = 7 * 24 * 60 * 60 * 1000;
// Desde este ancho la columna de la app deja libre el costado (MargenWeb).
const ANCHO_COSTADO = 1000;

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
const esAndroidEnNavegador = () => Platform.OS === 'web' && /Android/i.test(ua());
// Computadora = navegador que no es de teléfono ni tableta.
const esComputadora = () => Platform.OS === 'web' && !/Android|iPhone|iPad|iPod|Mobile/i.test(ua())
  && !(typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && /Macintosh/.test(ua()));

function cerradaHacePoco(clave = CLAVE, pausa = PAUSA_MS) {
  try {
    const t = Number(localStorage.getItem(clave));
    return Number.isFinite(t) && Date.now() - t < pausa;
  } catch { return false; }
}

function recordarCierre(clave = CLAVE) {
  try { localStorage.setItem(clave, String(Date.now())); } catch { /* sin memoria: sale otra vez */ }
}

export default function DescargaApp() {
  if (esAndroidEnNavegador()) return <HojaAndroid />;
  if (esComputadora()) return <TarjetaCostado />;
  return null;
}

function TarjetaCostado() {
  const t = useTema();
  const { width } = useWindowDimensions();
  const [abierta, setAbierta] = useState(() => !cerradaHacePoco(CLAVE_COSTADO, PAUSA_COSTADO_MS));
  if (!abierta || width < ANCHO_COSTADO) return null;
  const c = t.color;
  const cerrar = () => { recordarCierre(CLAVE_COSTADO); setAbierta(false); };
  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(150)}
      accessibilityRole="complementary" accessibilityLabel="Descarga la app Puntos Salud"
      style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1500, width: 260, backgroundColor: c.tarjeta,
        borderRadius: 24, borderWidth: 1, borderColor: c.borde, padding: 20, alignItems: 'center', gap: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}>
      <Pressable onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar"
        style={({ hovered }) => ({ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16,
          alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? c.borde : 'transparent' })}>
        <Text style={{ color: c.texto2, fontSize: 18, lineHeight: 20 }}>×</Text>
      </Pressable>
      <Image source={require('../assets/logo-puntos-salud.png')} accessibilityLabel="Puntos Salud"
        style={{ width: 123, height: 60 }} resizeMode="contain" />
      <Text style={{ color: c.texto, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>
        Ya disponible en Android
      </Text>
      <Text style={{ color: c.texto2, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>
        Escanea con tu teléfono para descargar la app.
      </Text>
      <View style={{ padding: 10, backgroundColor: '#FFFFFF', borderRadius: 14 }}>
        <CodigoQR value={PLAY} size={132} />
      </View>
      <Pressable onPress={() => Linking.openURL(PLAY).catch(() => {})} accessibilityRole="link"
        style={({ hovered, pressed }) => ({ alignSelf: 'stretch', minHeight: 44, borderRadius: 999, backgroundColor: c.magenta,
          alignItems: 'center', justifyContent: 'center', opacity: hovered ? 0.9 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>Ver en Google Play</Text>
      </Pressable>
      <View style={{ alignSelf: 'stretch', minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: c.borde,
        alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.texto2, fontSize: 14, fontWeight: '600' }}>Próximamente en App Store</Text>
      </View>
    </Animated.View>
  );
}

function HojaAndroid() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (cerradaHacePoco()) return undefined;
    // Un respiro para que la página pinte primero.
    const reloj = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(reloj);
  }, []);

  if (!visible) return null;

  const cerrar = () => { recordarCierre(); setVisible(false); };
  const descargar = () => { recordarCierre(); setVisible(false); Linking.openURL(PLAY).catch(() => {}); };
  const c = t.color;

  // `fixed`: el documento web se desplaza, y con `absolute` la hoja quedaba bajo el borde de la pantalla.
  return (
    <View style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2000, justifyContent: 'flex-end' }}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable accessibilityLabel="Seguir en la web" onPress={cerrar} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View entering={SlideInDown.duration(280)} exiting={SlideOutDown.duration(200)}
        accessibilityRole="dialog" accessibilityLabel="Descarga la app Puntos Salud"
        style={{ alignSelf: 'center', width: '100%', maxWidth: 520, backgroundColor: c.tarjeta,
          borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12,
          paddingBottom: Math.max(ins.bottom, 16) + 12, alignItems: 'center', gap: 14 }}>
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.borde }} />
        <Image source={require('../assets/logo-puntos-salud.png')} accessibilityLabel="Puntos Salud"
          style={{ width: 164, height: 80, marginTop: 4 }} resizeMode="contain" />
        <Text style={{ color: c.texto, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
          Descarga la app
        </Text>
        <Text style={{ color: c.texto2, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>
          Tu tarjeta, tus puntos y tus ofertas, más rápido. Te avisamos de tus reservas y de cada toma.
        </Text>
        <Pressable onPress={descargar} accessibilityRole="link"
          style={({ pressed }) => ({ alignSelf: 'stretch', minHeight: 52, borderRadius: 999, backgroundColor: c.magenta,
            alignItems: 'center', justifyContent: 'center', marginTop: 6, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>Descargar en Google Play</Text>
        </Pressable>
        <Pressable onPress={cerrar} accessibilityRole="button"
          style={({ pressed }) => ({ alignSelf: 'stretch', minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: c.magentaTexto, fontSize: 16, fontWeight: '600' }}>Seguir en la web</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
