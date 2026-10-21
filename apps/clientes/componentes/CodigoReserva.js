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
//
// Más corto y con BARRAS (2026-10-20, pedido del dueño): el mensaje son cuatro
// líneas —qué, dónde, hasta qué día, cuánto— y la tarjeta lleva el código de
// barras además del QR, porque los lectores de la sala son de una dimensión y
// no leen el QR (componentes/CodigoBarras.js). Las barras llevan el código SIN
// guion (`R001234`), igual que la constancia impresa del portal, y la búsqueda
// de la sala compara sólo letras y dígitos (`codigoLimpio`). El plazo es un
// DÍA, no una hora: ver `diaDelPlazo` en lib/formato.
// Necesita una compilación nativa nueva (view-shot y expo-sharing son nativos);
// en una compilación vieja `require` falla y queda el texto.
import { useRef, useState } from 'react';
import { Image, Platform, Share, Text, View } from 'react-native';
import Presionable from './Presionable';
// El QR con módulos de píxeles enteros (componentes/CodigoQR.js, 2026-10-14).
import QRCode from './CodigoQR';
import CodigoBarras from './CodigoBarras';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';
import { diaDelPlazo, dolares } from '../lib/formato';
import { sinBloquear } from '../lib/bloqueo';

let captureRef = null;
let Sharing = null;
try { ({ captureRef } = require('react-native-view-shot')); } catch { captureRef = null; }
try { Sharing = require('expo-sharing'); } catch { Sharing = null; }

export const TEXTO_COMPARTIR = 'Quien presente este código en la sucursal puede retirarlo.';

const MAGENTA = '#981D97';
const TINTA = '#1A0822';
const GRIS = '#5B5563';
const LINEA = '#E6E1EA';

// Lo que lee el lector: letras y dígitos, sin el guion (como la constancia impresa).
export const valorDeBarras = (codigo) => String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const listaDe = ({ productos, producto }) => (productos?.length ? productos : producto ? [{ nombre: producto, cantidad: null }] : []);

/** El mensaje: corto, lo que necesita quien va a retirar. */
export function mensajeParaCompartir({ codigo, producto, productos, sala, total, pagado, vence, receta, pedido = false }) {
  const lista = listaDe({ productos, producto });
  const que = lista.length === 1 && lista[0].cantidad ? `${lista[0].cantidad} × ${lista[0].nombre}`
    : lista.length === 1 ? lista[0].nombre : lista.length > 1 ? `${lista.length} productos` : null;
  const dondeCuando = [sala ? `en ${sala}` : null, vence ? `hasta ${diaDelPlazo(vence, Date.now(), { absoluto: true })}` : null].filter(Boolean).join(' ');
  return [
    `${pedido ? 'Pedido' : 'Reserva'} ${codigo} · Farmacia Salud${que ? ` · ${que}` : ''}`,
    dondeCuando ? `Retíralo ${dondeCuando}.` : null,
    total != null ? `Total ${dolares(total)}${pagado ? ', ya pagado' : ', se paga al retirar'}.` : null,
    `Presenta este código en la sucursal${receta ? ' con la receta original' : ''}.`,
  ].filter(Boolean).join('\n');
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
      // Un cuadro para que la tarjeta escondida termine de pintarse (QR y barras son SVG).
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
      {/* Fondo blanco siempre: el lector necesita contraste. Barras para el lector de mostrador, QR para la cámara. */}
      <View style={{ backgroundColor: '#FFFFFF', paddingVertical: 14, paddingHorizontal: 10, borderRadius: 20, alignItems: 'center', gap: 10 }}>
        <QRCode value={codigo} size={tam} color={TINTA} backgroundColor="#FFFFFF" />
        <CodigoBarras value={valorDeBarras(codigo)} ancho={260} alto={64} color={TINTA} />
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

// La imagen que se comparte (rehecha el 2026-10-20): un boleto de 360 de ancho
// (×3 en un teléfono moderno = 1080 px). Arriba la marca; al centro lo que se
// escanea —barras grandes, el código y el QR—; abajo, separado por un corte
// punteado, sólo los datos: dónde, hasta qué día, cuánto y qué. Fondo blanco
// de borde a borde para que el lector tenga contraste aunque se vea en modo oscuro.
function TarjetaParaCompartir({ ref, datos }) {
  const { codigo, sala, total, pagado, vence, receta, pedido } = datos;
  const lista = listaDe(datos);
  const visibles = lista.slice(0, 4);
  return (
    <View ref={ref} collapsable={false} style={{ width: 360, backgroundColor: '#FFFFFF', borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: LINEA }}>
      <View style={{ backgroundColor: MAGENTA, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Image source={require('../assets/icono.png')} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: '#FFFFFF' }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '900' }}>Farmacia Salud</Text>
          <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600' }}>{pedido ? 'Pedido para retirar' : 'Reserva para retirar'}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, alignItems: 'center', gap: 12 }}>
        <CodigoBarras value={valorDeBarras(codigo)} ancho={318} alto={78} color={TINTA} />
        <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 5, color: TINTA, fontVariant: ['tabular-nums'] }}>{codigo}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'stretch' }}>
          <View style={{ padding: 8, borderRadius: 14, borderWidth: 1, borderColor: LINEA }}>
            <QRCode value={codigo} size={96} color={TINTA} backgroundColor="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '800', color: TINTA }}>Preséntalo en la sucursal</Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: GRIS }}>
              Quien lo presente puede retirarlo.{receta ? ' Lleva la receta original.' : ''}
            </Text>
          </View>
        </View>
      </View>

      {/* El corte del boleto. */}
      <View style={{ marginHorizontal: 20, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: LINEA }} />

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20, gap: 10 }}>
        {sala ? <Fila etiqueta="Sucursal" valor={sala} /> : null}
        {vence ? <Fila etiqueta="Retirar hasta" valor={diaDelPlazo(vence, Date.now(), { absoluto: true }).replace(/^el /, '')} /> : null}
        {total != null ? <Fila etiqueta={pagado ? 'Total · pagado' : 'Total · se paga al retirar'} valor={dolares(total)} fuerte /> : null}
        {visibles.length ? (
          <View style={{ gap: 3, paddingTop: 2 }}>
            {visibles.map((p, i) => (
              <Text key={i} style={{ fontSize: 13, lineHeight: 18, color: GRIS }} numberOfLines={1}>
                {p.cantidad ? `${p.cantidad} × ` : ''}{p.nombre}
              </Text>
            ))}
            {lista.length > visibles.length ? <Text style={{ fontSize: 13, color: GRIS }}>y {lista.length - visibles.length} más</Text> : null}
          </View>
        ) : null}
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
