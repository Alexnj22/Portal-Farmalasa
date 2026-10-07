// El código de una reserva o de un pedido del carrito, en QR (2026-10-07): en
// la sucursal lo escanean (o teclean) para encontrarlo, prepararlo y
// facturarlo. Fondo blanco siempre: el lector necesita contraste.
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colorSistema } from './sistema';

export default function CodigoReserva({ codigo, tam = 150, ayuda = 'Muéstralo en la sucursal: lo escanean y te lo entregan listo.' }) {
  if (!codigo) return null;
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 20 }}>
        <QRCode value={codigo} size={tam} color="#1A0822" backgroundColor="#FFFFFF" />
      </View>
      <Text selectable style={{ fontSize: 24, fontWeight: '900', letterSpacing: 4, color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{codigo}</Text>
      {ayuda ? <Text style={{ fontSize: 13, textAlign: 'center', color: colorSistema.texto2, maxWidth: 280 }}>{ayuda}</Text> : null}
    </View>
  );
}
