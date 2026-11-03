// Memoria (Bienestar, 2026-11-03): 16 cartas, 8 parejas con íconos de la
// farmacia. Se voltean dos; si son iguales se quedan, si no vuelven solas. El
// récord (menos movimientos) queda en el teléfono.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Boton, Pantalla, RADIO, Tarjeta } from '../componentes/ui';
import { Confeti } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { colorSistema } from '../componentes/sistema';
import { suave, useTema } from '../tema/tema';

const CLAVE = 'puntos_salud_memoria_record';
const FIGURAS = ['heart.fill', 'leaf.fill', 'pills.fill', 'drop.fill', 'star.fill', 'syringe.fill', 'moon.fill', 'sparkles'];

function barajar() {
  const cartas = [...FIGURAS, ...FIGURAS].map((sf, i) => ({ id: i, sf }));
  for (let i = cartas.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cartas[i], cartas[j]] = [cartas[j], cartas[i]];
  }
  return cartas;
}

const Carta = memo(function Carta({ carta, tam, abierta, hecha, color, dorso, alTocar }) {
  const giro = useSharedValue(0);
  useEffect(() => { giro.value = withTiming(abierta || hecha ? 1 : 0, { duration: 260 }); }, [abierta, hecha, giro]);
  const frente = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 1 : 0, transform: [{ perspective: 600 }, { rotateY: `${interpolate(giro.value, [0, 1], [180, 360])}deg` }] }));
  const atras = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 0 : 1, transform: [{ perspective: 600 }, { rotateY: `${interpolate(giro.value, [0, 1], [0, 180])}deg` }] }));
  const caja = { position: 'absolute', top: 0, left: 0, width: tam, height: tam, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' };
  return (
    <Pressable onPress={() => alTocar(carta.id)} disabled={abierta || hecha} style={{ width: tam, height: tam }}
      accessibilityRole="button" accessibilityLabel={abierta || hecha ? `Carta ${carta.sf.split('.')[0]}` : 'Carta boca abajo'}>
      <Animated.View style={[caja, atras]}>
        <LinearGradient colors={dorso} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[caja, { position: 'relative' }]}>
          <Text style={{ fontSize: tam * 0.36, fontWeight: '900', color: 'rgba(255,255,255,0.35)' }}>+</Text>
        </LinearGradient>
      </Animated.View>
      <Animated.View style={[caja, frente, { backgroundColor: hecha ? suave(color, 0.22) : colorSistema.superficie,
        borderWidth: 2, borderColor: suave(color, hecha ? 0.5 : 0.9) }]}>
        <Icono sf={carta.sf} respaldo="●" tam={tam * 0.42} color={color} />
      </Animated.View>
    </Pressable>
  );
});

export default function Memoria() {
  const t = useTema();
  const { width } = useWindowDimensions();
  const [cartas, setCartas] = useState(barajar);
  const [abiertas, setAbiertas] = useState([]);
  const [hechas, setHechas] = useState(() => new Set());
  const [movs, setMovs] = useState(0);
  const [record, setRecord] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const espera = useRef(null);
  useEffect(() => {
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v); if (v && Number.isFinite(n)) setRecord(n); }).catch(() => {});
    return () => clearTimeout(espera.current);
  }, []);

  const colorDe = useCallback((sf) => {
    const lista = [t.color.magenta, t.acentos.verde.fuerte, t.acentos.azul.fuerte, t.acentos.violeta.fuerte, t.acentos.naranja.fuerte, t.acentos.rojo.fuerte, t.acentos.azul.fuerte, t.color.magenta];
    return lista[FIGURAS.indexOf(sf)];
  }, [t]);

  const alTocar = useCallback((id) => {
    if (espera.current || abiertas.length >= 2) return;
    Haptics.selectionAsync().catch(() => {});
    const dos = [...abiertas, id];
    setAbiertas(dos);
    if (dos.length < 2) return;
    setMovs((m) => m + 1);
    const [a, b] = dos.map((x) => cartas.find((c) => c.id === x));
    if (a.sf === b.sf) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setHechas((h) => new Set([...h, a.id, b.id]));
      setAbiertas([]);
    } else {
      espera.current = setTimeout(() => { espera.current = null; setAbiertas([]); }, 800);
    }
  }, [abiertas, cartas]);

  const gano = hechas.size === cartas.length;
  useEffect(() => {
    if (!gano) return;
    if (record == null || movs < record) {
      setNuevoRecord(true);
      setRecord(movs);
      SecureStore.setItemAsync(CLAVE, String(movs)).catch(() => {});
    }
  }, [gano]); // eslint-disable-line react-hooks/exhaustive-deps

  const otraVez = () => {
    clearTimeout(espera.current); espera.current = null;
    setCartas(barajar()); setAbiertas([]); setHechas(new Set()); setMovs(0); setNuevoRecord(false);
  };

  const hueco = 10;
  const tam = Math.floor((Math.min(width, 560) - 32 - hueco * 3) / 4);
  const dorso = [t.acentos.violeta.fuerte, t.color.magenta];
  return (
    <Pantalla conPestanas={false} conBurbuja={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <Text style={{ fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{movs} movimiento{movs === 1 ? '' : 's'}</Text>
        <Text style={{ fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{record != null ? `Récord: ${record}` : `Parejas: ${hechas.size / 2} de 8`}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: hueco }}>
        {cartas.map((c) => (
          <Carta key={c.id} carta={c} tam={tam} abierta={abiertas.includes(c.id)} hecha={hechas.has(c.id)}
            color={colorDe(c.sf)} dorso={dorso} alTocar={alTocar} />
        ))}
      </View>
      {gano ? (
        <View>
          <Tarjeta tono={t.color.verde} estilo={{ alignItems: 'center', gap: 6 }}>
            <Icono sf="trophy.fill" respaldo="🏆" tam={30} color={t.color.verdeTexto} />
            <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto }}>{nuevoRecord ? '¡Nuevo récord!' : '¡Lo lograste!'}</Text>
            <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>Encontraste las 8 parejas en {movs} movimientos.</Text>
          </Tarjeta>
          <Confeti colores={[t.color.verde, t.color.magenta, t.acentos.azul.fuerte, t.acentos.naranja.fuerte]} />
        </View>
      ) : null}
      <Boton tipo={gano ? 'principal' : 'secundario'} alTocar={otraVez}>{gano ? 'Jugar otra vez' : 'Barajar de nuevo'}</Boton>
    </Pantalla>
  );
}
