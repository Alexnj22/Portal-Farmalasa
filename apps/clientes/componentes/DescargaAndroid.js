// La invitación a la app de Play en la WEB desde un teléfono Android
// (2026-11-25, pedido del usuario: «si revisan la app web y detecta que es
// android, lo mande a descargar la app»). Medido ese día en
// `app_cliente_sesiones`: ~15 sesiones `web` con modelos Android desde el
// 14-nov y ningún cliente real todavía en la app de Android.
//
// No es una redirección: una hoja abajo con «Descargar en Google Play» y
// «Seguir en la web». Quien la cierra no la vuelve a ver en 3 días (memoria
// del navegador; si no se puede leer, sale otra vez — es una invitación, no un
// dato). iPhone queda fuera hasta que App Store apruebe la app.
import { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useTema } from '../tema/tema';

const PLAY = 'https://play.google.com/store/apps/details?id=com.wnapp.id1750888957164';
const CLAVE = 'descarga-android:cerrada';
const PAUSA_MS = 3 * 24 * 60 * 60 * 1000;

function esAndroidEnNavegador() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua);
}

function cerradaHacePoco() {
  try {
    const t = Number(localStorage.getItem(CLAVE));
    return Number.isFinite(t) && Date.now() - t < PAUSA_MS;
  } catch { return false; }
}

function recordarCierre() {
  try { localStorage.setItem(CLAVE, String(Date.now())); } catch { /* sin memoria: sale otra vez */ }
}

export default function DescargaAndroid() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!esAndroidEnNavegador() || cerradaHacePoco()) return undefined;
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
