// El código de una reserva o de un pedido del carrito, en QR (2026-10-07): en
// la sucursal lo escanean (o teclean) para encontrarlo, prepararlo y
// facturarlo. Fondo blanco siempre: el lector necesita contraste.
//
// Compartir (2026-10-09): si quien reservó no puede ir, le pasa el código a
// otra persona. En la sucursal la reserva se encuentra SÓLO por el código
// (WidgetReservas del portal: «Escanea o escribe el código»), así que quien lo
// presente la retira. Se comparte el QR como imagen (PNG en la caché del
// teléfono); si la imagen no se puede armar —o en Android, donde `Share` no
// lleva archivos— se comparte el texto con el código, la sucursal y el producto.
import { useRef, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as FS from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

export const TEXTO_COMPARTIR = 'Si no puedes ir tú, comparte este código con alguien de confianza: quien lo presente en la sucursal puede retirar la reserva.';

// El QR en base64 (sin el prefijo data:), o null si no sale en 4 s.
function qrEnBase64(ref) {
  return new Promise((ok) => {
    if (!ref?.toDataURL) { ok(null); return; }
    const corte = setTimeout(() => ok(null), 4000);
    try {
      ref.toDataURL((datos) => { clearTimeout(corte); ok(datos ? String(datos).replace(/^data:image\/png;base64,/, '') : null); });
    } catch {
      clearTimeout(corte); ok(null);
    }
  });
}

export function mensajeParaCompartir({ codigo, producto, sala, pedido = false }) {
  return [
    `${pedido ? 'Pedido' : 'Reserva'} ${codigo}`,
    producto ? `Producto: ${producto}` : null,
    sala ? `Se retira en: ${sala}` : null,
    'Presenta este código en la sucursal para retirarla.',
  ].filter(Boolean).join('\n');
}

export default function CodigoReserva({ codigo, tam = 150, ayuda = 'Muéstralo en la sucursal: lo escanean y te lo entregan listo.', compartir = null }) {
  const t = useTema();
  const qr = useRef(null);
  const [compartiendo, setCompartiendo] = useState(false);
  if (!codigo) return null;
  const alCompartir = async () => {
    if (compartiendo) return;
    setCompartiendo(true);
    Haptics.selectionAsync().catch(() => {});
    const message = mensajeParaCompartir({ codigo, ...compartir });
    try {
      let url = null;
      if (Platform.OS === 'ios' && FS.cacheDirectory) {
        const b64 = await qrEnBase64(qr.current);
        if (b64) {
          const ruta = `${FS.cacheDirectory}reserva-${String(codigo).replace(/[^A-Za-z0-9-]/g, '')}.png`;
          url = await FS.writeAsStringAsync(ruta, b64, { encoding: FS.EncodingType.Base64 }).then(() => ruta).catch(() => null);
        }
      }
      await Share.share(url ? { url, message } : { message, title: `Reserva ${codigo}` });
    } catch {
      // Cerrar la hoja de compartir no es un error; si falló, no hay nada más que ofrecer.
    } finally {
      setCompartiendo(false);
    }
  };
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 20 }}>
        <QRCode value={codigo} size={tam} color="#1A0822" backgroundColor="#FFFFFF" getRef={(c) => { qr.current = c; }} />
      </View>
      <Text selectable style={{ fontSize: 24, fontWeight: '900', letterSpacing: 4, color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{codigo}</Text>
      {ayuda ? <Text style={{ fontSize: 13, textAlign: 'center', color: colorSistema.texto2, maxWidth: 280 }}>{ayuda}</Text> : null}
      {compartir ? (
        <>
          <Pressable onPress={alCompartir} disabled={compartiendo} accessibilityRole="button" accessibilityLabel={`Compartir el código ${codigo}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 999,
              backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', opacity: compartiendo ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <Icono sf="square.and.arrow.up" respaldo="↗" tam={15} color={t.color.magentaTexto} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>Compartir</Text>
          </Pressable>
          <Text style={{ fontSize: 12, lineHeight: 17, textAlign: 'center', color: colorSistema.texto3, maxWidth: 290 }}>{TEXTO_COMPARTIR}</Text>
        </>
      ) : null}
    </View>
  );
}
