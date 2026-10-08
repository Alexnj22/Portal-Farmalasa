// El rango del Cliente Mayorista (2026-10-08). Hoy sólo en modo de prueba,
// para ver cómo se ve antes de abrirlo a clientes. Las reglas son las de las
// «Condiciones del Cliente Mayorista»: el rango sale del promedio de compra de
// los tres meses anteriores, se recalcula el primer día del mes, y da puntos
// por cada US$1.00 a precio de mayoreo. El precio (Mayoreo, Plus, Elite) es
// independiente del rango.
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Tarjeta, Texto } from './ui';
import { BarraAnimada } from './animacion';
import { COLORES_NIVEL } from './TarjetaSocio';
import { colorSistema } from './sistema';
import Icono from './Icono';
import { dolares } from '../lib/formato';
import { useTema } from '../tema/tema';

export const RANGOS = [
  { clave: 'jade', nombre: 'Jade', desde: 100, puntos: 0.25 },
  { clave: 'zafiro', nombre: 'Zafiro', desde: 300, puntos: 0.5 },
  { clave: 'rubi', nombre: 'Rubí', desde: 750, puntos: 0.75 },
  { clave: 'diamante', nombre: 'Diamante', desde: 1500, puntos: 1 },
];
const PRECIO = { jade: 'Mayoreo', zafiro: 'Mayoreo Plus', rubi: 'Mayoreo Plus', diamante: 'Mayoreo Elite' };

/** Un rango de muestra con una compra a mitad de camino del siguiente. */
export function rangoDePrueba(clave) {
  const i = Math.max(0, RANGOS.findIndex((r) => r.clave === clave));
  const r = RANGOS[i]; const s = RANGOS[i + 1];
  const compra = s ? Math.round(r.desde + (s.desde - r.desde) * 0.6) : 2100;
  return { ...r, precio: PRECIO[r.clave], compra, siguiente: s ? { ...s, falta: s.desde - compra } : null };
}

export default function Mayorista({ rango }) {
  const t = useTema();
  if (!rango) return null;
  const paleta = COLORES_NIVEL[rango.clave];
  const sig = rango.siguiente;
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] }}>
          <View style={{ transform: [{ rotate: '-45deg' }] }}><Icono sf="diamond.fill" respaldo="◆" tam={18} color="#FFFFFF" /></View>
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>Cliente Mayorista</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>{rango.nombre}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: colorSistema.texto }}>{rango.precio}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{rango.puntos} pts / $1 de mayoreo</Text>
        </View>
      </View>
      {sig ? (
        <View style={{ gap: 6 }}>
          <BarraAnimada avance={Math.min(1, rango.compra / sig.desde)} color={paleta.frente[1]} fondo={t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} />
          <Texto nivel={2} estilo={{ fontSize: 14 }}>
            Compras en promedio <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(rango.compra)}</Text> al mes. Con{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(sig.falta)}</Text> más llegas a{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{sig.nombre}</Text> ({sig.puntos} pts por $1).
          </Texto>
        </View>
      ) : (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Estás en el rango más alto: {dolares(rango.compra)} al mes en promedio.</Texto>
      )}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {RANGOS.map((r) => {
          const p = COLORES_NIVEL[r.clave];
          const es = r.clave === rango.clave;
          return (
            <View key={r.clave} style={{ flex: 1, alignItems: 'center', gap: 4, opacity: es ? 1 : 0.5 }}>
              <LinearGradient colors={p.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: es ? 26 : 20, height: es ? 26 : 20, borderRadius: 5, transform: [{ rotate: '45deg' }], borderWidth: es ? 2 : 0, borderColor: '#FFFFFF' }} />
              <Text style={{ fontSize: 11, fontWeight: es ? '800' : '600', color: colorSistema.texto2 }}>{r.nombre}</Text>
              <Text style={{ fontSize: 10, color: colorSistema.texto3 }}>desde {dolares(r.desde).replace('.00', '')}</Text>
            </View>
          );
        })}
      </View>
      <Texto nivel={3} estilo={{ fontSize: 12 }}>El rango se recalcula el primer día de cada mes con el promedio de los tres meses anteriores.</Texto>
    </Tarjeta>
  );
}
