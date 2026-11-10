// La frase del día como IMAGEN para compartir (2026-11-10: «que se comparta
// como imagen, con el logo de farmacias la popular y la salud, y muy bonito»).
//
// Una tarjeta 4:5 —la medida que WhatsApp, Instagram y Facebook muestran
// entera— que se pinta escondida fuera de la pantalla y se fotografía con
// `react-native-view-shot` a 1080 × 1350. Mismo camino que el código de una
// reserva (CodigoReserva.js): en iPhone la hoja del sistema recibe el archivo,
// en Android `expo-sharing`. Si la foto falla, se comparte el texto.
import { forwardRef } from 'react';
import { Image, Platform, Share, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { sinBloquear } from '../lib/bloqueo';

let captureRef = null;
let Sharing = null;
try { ({ captureRef } = require('react-native-view-shot')); } catch { captureRef = null; }
try { Sharing = require('expo-sharing'); } catch { Sharing = null; }

const ANCHO = 360;
const ALTO = 450;

/** La tarjeta. Medidas fijas: no depende del tamaño de letra del teléfono. */
export const TarjetaFrase = forwardRef(function TarjetaFrase({ frase, categoria, fecha, colores }, ref) {
  // La letra baja con frases largas, para que nunca se corte.
  const n = frase.length;
  const tam = n > 150 ? 22 : n > 110 ? 25 : n > 70 ? 29 : 33;
  return (
    <View ref={ref} collapsable={false} style={{ width: ANCHO, height: ALTO, backgroundColor: '#FFFFFF' }}>
      <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ flex: 1, margin: 14, marginBottom: 0, borderRadius: 30, padding: 26, overflow: 'hidden', justifyContent: 'space-between' }}>
        {/* Adornos: la comilla gigante y dos brillos. */}
        <Text allowFontScaling={false} style={{ position: 'absolute', right: 6, top: -66, fontSize: 280, fontWeight: '900', color: 'rgba(255,255,255,0.14)' }}>“</Text>
        <View style={{ position: 'absolute', left: -90, bottom: -110, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.09)' }} />
        <View style={{ position: 'absolute', right: -40, bottom: 60, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.07)' }} />

        <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#FFFFFF' }}>
            FRASE DEL DÍA · {categoria.toUpperCase()}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 14 }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' }} />
          <Text allowFontScaling={false}
            style={{ flex: 1, fontSize: tam, lineHeight: Math.round(tam * 1.25), fontWeight: '800', letterSpacing: -0.4, color: '#FFFFFF' }}>
            {frase}
          </Text>
        </View>

        <Text allowFontScaling={false} style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)' }}>
          {fecha}
        </Text>
      </LinearGradient>

      {/* El pie blanco con la marca. */}
      <View style={{ height: 78, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Image source={require('../assets/logo-farmacias.png')} resizeMode="contain" style={{ width: 250, height: 34 }} />
        <Text allowFontScaling={false} style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: '#8A8394' }}>
          Puntos Salud · tu bienestar, todos los días
        </Text>
      </View>
    </View>
  );
});

/** Fotografía la tarjeta y abre la hoja de compartir. Nunca lanza. */
export async function compartirFraseComoImagen(ref, frase) {
  const message = `«${frase}»\n\nFrase del día · Farmacias La Popular y La Salud`;
  try {
    // Un cuadro para que la tarjeta escondida termine de pintarse.
    await new Promise((ok) => setTimeout(ok, 120));
    let uri = null;
    if (captureRef && ref.current && Platform.OS !== 'web') {
      uri = await captureRef(ref.current, { format: 'png', quality: 1, result: 'tmpfile', width: 1080, height: 1350 }).catch(() => null);
    }
    await sinBloquear(async () => {
      if (uri && Platform.OS === 'android' && Sharing && (await Sharing.isAvailableAsync().catch(() => false))) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Compartir la frase del día' });
      } else if (uri && Platform.OS === 'ios') {
        await Share.share({ url: uri });
      } else {
        await Share.share({ message });
      }
    });
  } catch {
    // Cerrar la hoja de compartir no es un error.
  }
}
