// El código de una reserva o de un pedido del carrito, en QR (2026-10-07): en
// la sucursal lo escanean (o teclean) para encontrarlo, prepararlo y
// facturarlo. Fondo blanco siempre: el lector necesita contraste.
//
// Compartir (2026-10-09): si quien reservó no puede ir, le pasa el código a
// otra persona. En la sucursal la reserva se encuentra SÓLO por el código
// (WidgetReservas del portal: «Escanea o escribe el código»), así que quien lo
// presente la retira.
//
// Compartir como IMAGEN (2026-10-14, pedido del usuario: «hoy sólo comparte
// texto»). Se arma una tarjeta con la marca, el QR, el código, la sucursal, los
// productos, el total, hasta cuándo se puede retirar y las reglas del retiro
// (`TarjetaParaCompartir`, abajo), se fotografía con react-native-view-shot y
// se comparte el PNG:
//   · iPhone: la hoja del sistema con la imagen Y el mensaje.
//   · Android: `Share` de React Native no lleva archivos, así que la imagen va
//     por expo-sharing — que no admite texto aparte. Por eso la tarjeta dice
//     sola todo lo que dice el mensaje.
// Si la imagen no se puede armar, se comparte el texto, como antes.
// Necesita una compilación nativa nueva (view-shot y expo-sharing son nativos);
// en una compilación vieja `require` falla y queda el texto.
import { useRef, useState } from 'react';
import { Image, Platform, Share, Text, View } from 'react-native';
import Presionable from './Presionable';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';
import { dolares } from '../lib/formato';
import { sinBloquear } from '../lib/bloqueo';

let captureRef = null;
let Sharing = null;
try { ({ captureRef } = require('react-native-view-shot')); } catch { captureRef = null; }
try { Sharing = require('expo-sharing'); } catch { Sharing = null; }

export const TEXTO_COMPARTIR = '¿No lo vas a retirar tú? Comparte este código con la persona que lo recogerá: quien lo presente en la sucursal puede retirarlo.';

const MAGENTA = '#981D97';
const VERDE = '#4E7A0B';
const TINTA = '#1A0822';
const GRIS = '#5B5563';

// «12 oct, 6:30 p. m.» en la hora del teléfono.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function cuando(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  return `${d.getDate()} de ${MESES[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Las reglas del retiro, las mismas en la tarjeta y en el mensaje. */
function reglas({ vence, receta }) {
  return [
    'Presenta este código o el QR en la sucursal.',
    'Te pueden pedir tu documento de identidad.',
    vence ? `Retíralo antes del ${cuando(vence)}; después se libera.` : 'Te avisamos cuando esté listo; tiene un plazo para retirarse.',
    receta ? 'Lleva la receta médica original: sin ella no se entregan los productos bajo receta.' : null,
  ].filter(Boolean);
}

export function mensajeParaCompartir({ codigo, producto, productos, sala, total, vence, receta, pedido = false }) {
  const lista = productos?.length ? productos.map((p) => `• ${p.cantidad ?? 1} × ${p.nombre}`).join('\n') : producto ? `Producto: ${producto}` : null;
  return [
    `¿No lo vas a retirar tú? Comparte este código con la persona que lo recogerá${sala ? ` en ${sala}` : ''}. Quien lo presente en la sucursal puede retirarlo.`,
    '',
    `${pedido ? 'Pedido' : 'Reserva'} ${codigo} · Farmacia Salud`,
    sala ? `Se retira en: ${sala}` : null,
    lista,
    total != null ? `Total: ${dolares(total)}` : null,
    '',
    ...reglas({ vence, receta }),
  ].filter((x) => x != null).join('\n');
}

export default function CodigoReserva({ codigo, tam = 150, ayuda = 'Muéstralo en la sucursal: lo escanean y te lo entregan listo.', compartir = null }) {
  const t = useTema();
  const tarjeta = useRef(null);
  const [compartiendo, setCompartiendo] = useState(false);
  if (!codigo) return null;
  const datos = { codigo, ...compartir };

  const alCompartir = async () => {
    if (compartiendo) return;
    setCompartiendo(true);
    Haptics.selectionAsync().catch(() => {});
    const message = mensajeParaCompartir(datos);
    try {
      // Un cuadro para que la tarjeta escondida termine de pintarse (el QR es SVG).
      await new Promise((ok) => setTimeout(ok, 120));
      let uri = null;
      if (captureRef && tarjeta.current && Platform.OS !== 'web') {
        uri = await captureRef(tarjeta.current, { format: 'png', quality: 1, result: 'tmpfile' }).catch(() => null);
      }
      await sinBloquear(async () => {
        if (uri && Platform.OS === 'android' && Sharing && (await Sharing.isAvailableAsync().catch(() => false))) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Compartir el ${datos.pedido ? 'pedido' : 'código'} ${codigo}` });
        } else if (uri && Platform.OS === 'ios') {
          await Share.share({ url: uri, message });
        } else {
          await Share.share({ message, title: `${datos.pedido ? 'Pedido' : 'Reserva'} ${codigo}` });
        }
      });
    } catch {
      // Cerrar la hoja de compartir no es un error; si falló, no hay nada más que ofrecer.
    } finally {
      setCompartiendo(false);
    }
  };
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 20 }}>
        <QRCode value={codigo} size={tam} color={TINTA} backgroundColor="#FFFFFF" />
      </View>
      <Text selectable style={{ fontSize: 24, fontWeight: '900', letterSpacing: 4, color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{codigo}</Text>
      {ayuda ? <Text style={{ fontSize: 13, textAlign: 'center', color: colorSistema.texto2, maxWidth: 280 }}>{ayuda}</Text> : null}
      {compartir ? (
        <>
          <Presionable onPress={alCompartir} disabled={compartiendo} accessibilityRole="button" accessibilityLabel={`Compartir el código ${codigo} con quien lo va a retirar`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 999,
              backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)', opacity: compartiendo ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <Icono sf="square.and.arrow.up" respaldo="↗" tam={15} color={t.color.magentaTexto} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>{compartiendo ? 'Preparando…' : 'Compartir con quien lo retira'}</Text>
          </Presionable>
          <Text style={{ fontSize: 12, lineHeight: 17, textAlign: 'center', color: colorSistema.texto3, maxWidth: 290 }}>{TEXTO_COMPARTIR}</Text>
          {/* La tarjeta que se fotografía: fuera de la pantalla, sólo mientras se comparte. */}
          {compartiendo ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: -10000, top: 0 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <TarjetaParaCompartir ref={tarjeta} datos={datos} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// La imagen que se comparte: blanca, de 360 de ancho (×3 en un teléfono
// moderno = 1080 px), con todo lo que necesita quien va a retirar sin haber
// visto la app.
function TarjetaParaCompartir({ ref, datos }) {
  const { codigo, sala, productos, producto, total, pagado, vence, receta, pedido } = datos;
  const lista = productos?.length ? productos : producto ? [{ nombre: producto, cantidad: null }] : [];
  const visibles = lista.slice(0, 6);
  return (
    <View ref={ref} collapsable={false} style={{ width: 360, backgroundColor: '#FFFFFF', borderRadius: 28, overflow: 'hidden' }}>
      <View style={{ backgroundColor: MAGENTA, paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Image source={require('../assets/icono.png')} style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFFFFF' }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '900' }}>Farmacia Salud</Text>
          <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600' }}>{pedido ? 'Pedido para retirar' : 'Reserva para retirar'}</Text>
        </View>
      </View>

      <View style={{ padding: 20, gap: 14 }}>
        <Text style={{ fontSize: 15, lineHeight: 21, fontWeight: '700', color: TINTA }}>
          Te compartieron este {pedido ? 'pedido' : 'código'} para que lo recojas{sala ? ` en ${sala}` : ''}.
        </Text>

        <View style={{ alignItems: 'center', gap: 8 }}>
          <View style={{ padding: 12, borderRadius: 18, borderWidth: 1, borderColor: '#E6E1EA' }}>
            <QRCode value={codigo} size={190} color={TINTA} backgroundColor="#FFFFFF" />
          </View>
          <Text style={{ fontSize: 30, fontWeight: '900', letterSpacing: 5, color: TINTA, fontVariant: ['tabular-nums'] }}>{codigo}</Text>
        </View>

        {sala ? <Fila etiqueta="Se retira en" valor={sala} /> : null}
        {visibles.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: GRIS }}>PRODUCTOS</Text>
            {visibles.map((p, i) => (
              <Text key={i} style={{ fontSize: 15, lineHeight: 20, color: TINTA }} numberOfLines={2}>
                {p.cantidad ? <Text style={{ fontWeight: '800' }}>{p.cantidad} × </Text> : null}{p.nombre}
              </Text>
            ))}
            {lista.length > visibles.length ? <Text style={{ fontSize: 13, color: GRIS }}>y {lista.length - visibles.length} más</Text> : null}
          </View>
        ) : null}
        {total != null ? <Fila etiqueta={pagado ? 'Total (ya pagado)' : 'Total a pagar al retirar'} valor={dolares(total)} fuerte /> : null}
        {vence ? <Fila etiqueta="Retirar antes del" valor={cuando(vence)} /> : null}

        <View style={{ gap: 6, padding: 14, borderRadius: 16, backgroundColor: '#F6F2F7' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: MAGENTA }}>PARA RETIRAR</Text>
          {reglas({ vence, receta }).map((x, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ fontSize: 14, lineHeight: 19, color: VERDE, fontWeight: '900' }}>•</Text>
              <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: TINTA }}>{x}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Fila({ etiqueta, valor, fuerte = false }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text style={{ fontSize: 14, color: GRIS }}>{etiqueta}</Text>
      <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: fuerte ? 20 : 15, fontWeight: fuerte ? '900' : '700', color: TINTA, fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}
