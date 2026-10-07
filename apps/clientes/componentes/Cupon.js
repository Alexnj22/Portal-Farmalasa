// El cupón del mes (Platino, 2026-10-07): puntos de regalo que vencen a fin de
// mes. Se usan en caja como cualquier saldo, mostrando la tarjeta. Con forma de
// cupón —borde punteado y muescas— para que se lea como tal.
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';
import { COLORES_NIVEL } from './TarjetaSocio';
import { dolares, fecha } from '../lib/formato';

export default function Cupon({ cupon, nivel = 'platino', fondo }) {
  if (!cupon || !(cupon.restantes > 0)) return null;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.platino;
  return (
    <View>
      <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
          <Icono sf="ticket.fill" respaldo="🎟" tam={24} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', paddingLeft: 16 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>TU CUPÓN DEL MES</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{dolares(cupon.restantes / 100)}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>Úsalo en caja con tu tarjeta · hasta el {fecha(cupon.vence)}</Text>
        </View>
      </LinearGradient>
      {/* Las muescas de un cupón, del color del fondo. */}
      <View style={{ position: 'absolute', left: 78, top: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
      <View style={{ position: 'absolute', left: 78, bottom: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
    </View>
  );
}
