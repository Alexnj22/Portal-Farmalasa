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

// Condiciones del Cliente Mayorista (vigentes 15-oct-2026), cláusulas 3 a 5.
export const RANGOS = [
  { clave: 'jade', nombre: 'Jade', desde: 0, puntos: 0.25, cumpleanos: 50, raspable: null },
  { clave: 'zafiro', nombre: 'Zafiro', desde: 300, puntos: 0.5, cumpleanos: 75, raspable: null },
  { clave: 'rubi', nombre: 'Rubí', desde: 800, puntos: 0.75, cumpleanos: 100, raspable: 'Oro' },
  { clave: 'diamante', nombre: 'Diamante', desde: 2000, puntos: 1, cumpleanos: 100, raspable: 'Platino' },
];
export const PRECIOS = { mayoreo: 'Mayoreo', mayoreo_plus: 'Mayoreo Plus' };
const PRECIO_MUESTRA = { jade: 'mayoreo', zafiro: 'mayoreo', rubi: 'mayoreo_plus', diamante: 'mayoreo_plus' };

/** El rango para mostrar: de prueba (con una compra a mitad de camino) o el real del cliente. */
export function rangoDePrueba(clave) {
  const i = Math.max(0, RANGOS.findIndex((r) => r.clave === clave));
  const r = RANGOS[i]; const s = RANGOS[i + 1];
  const compra = s ? Math.round(Math.max(150, r.desde + (s.desde - r.desde) * 0.6)) : 2400;
  return { ...r, precio: PRECIOS[PRECIO_MUESTRA[r.clave]], compra, siguiente: s ? { ...s, falta: s.desde - compra } : null };
}
export function rangoReal(m) {
  if (!m || m.estado !== 'aprobado') return null;
  const i = Math.max(0, RANGOS.findIndex((r) => r.clave === (m.rango ?? 'jade')));
  const r = RANGOS[i]; const s = RANGOS[i + 1]; const compra = Number(m.prom_3m ?? 0);
  return { ...r, precio: PRECIOS[m.precio] ?? 'Mayoreo', compra, retiro: m.retiro_programado ?? null,
    siguiente: s ? { ...s, falta: Math.max(0, s.desde - compra) } : null };
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
            Compras en promedio <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(rango.compra)}</Text> al mes (los 3 meses anteriores). Con{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{dolares(sig.falta)}</Text> más llegas a{' '}
            <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{sig.nombre}</Text> ({sig.puntos} pts por $1).
          </Texto>
        </View>
      ) : (
        <Texto nivel={2} estilo={{ fontSize: 14 }}>Estás en el rango más alto: {dolares(rango.compra)} al mes en promedio.</Texto>
      )}
      {/* Lo que da su rango (Condiciones, cláusula 5). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[`${rango.puntos} pts por $1 a tu precio de mayoreo`, '1 punto por $1 a precio Preferente',
          `${rango.cumpleanos} puntos en tu cumpleaños`, ...(rango.raspable ? [`Raspable mensual ${rango.raspable}`] : []),
          `Tu precio: ${rango.precio}`].map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      {rango.retiro ? <Texto nivel={2} estilo={{ fontSize: 13 }}>Tu condición de Cliente Mayorista termina el {rango.retiro}.</Texto> : null}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {RANGOS.map((r) => {
          const p = COLORES_NIVEL[r.clave];
          const es = r.clave === rango.clave;
          return (
            <View key={r.clave} style={{ flex: 1, alignItems: 'center', gap: 4, opacity: es ? 1 : 0.5 }}>
              <LinearGradient colors={p.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ width: es ? 26 : 20, height: es ? 26 : 20, borderRadius: 5, transform: [{ rotate: '45deg' }], borderWidth: es ? 2 : 0, borderColor: '#FFFFFF' }} />
              <Text style={{ fontSize: 11, fontWeight: es ? '800' : '600', color: colorSistema.texto2 }}>{r.nombre}</Text>
              <Text style={{ fontSize: 10, color: colorSistema.texto3 }}>{r.desde ? `desde ${dolares(r.desde).replace('.00', '')}` : 'al ingresar'}</Text>
            </View>
          );
        })}
      </View>
      <Texto nivel={3} estilo={{ fontSize: 12 }}>
        Como Cliente Mayorista no tienes nivel de Puntos Salud: tu escalera es tu rango. Se recalcula el primer día de cada mes con el
        promedio de los tres meses anteriores, y el precio lo asigna la empresa aparte.
      </Texto>
    </Tarjeta>
  );
}

// La tarjeta de Equipo (2026-10-08): por política, el personal compra a precio
// Mayoreo Plus. Lo comprado a precio de personal no acumula puntos (Reglamento,
// cláusula 3.3: sólo acumula lo comprado a precio Público o Preferente).
export function Equipo() {
  const t = useTema();
  const paleta = COLORES_NIVEL.empleado;
  return (
    <Tarjeta estilo={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LinearGradient colors={paleta.frente} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf="person.2.fill" respaldo="👥" tam={18} color="#FFFFFF" />
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>Tarjeta de</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.3 }}>Equipo Farmacia Salud</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {['Precio Mayoreo Plus', 'En todas las sucursales', 'Lo de precio Público acumula puntos'].map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
            <Icono sf="checkmark" respaldo="✓" tam={10} color={t.color.verdeTexto} />
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto2 }}>{b}</Text>
          </View>
        ))}
      </View>
      <Texto nivel={3} estilo={{ fontSize: 12 }}>
        Por política de personal compras a precio Mayoreo Plus. Lo comprado a ese precio no acumula puntos; lo comprado a precio Público, sí.
        Muestra tu tarjeta en caja.
      </Texto>
    </Tarjeta>
  );
}
