// Por vencer, contado como la persona lo piensa: «¿pierdo algo pronto?».
//
// La lista de fechas que había antes decía «1 oct 2027 · 67 pts» y no
// contestaba nada (probado en TestFlight el 2026-10-06: «vencen en 2027, mejor
// que salgan si vencerán en los próximos 3 meses y cuántos»). Ahora:
//
//   · arriba, la respuesta: cuántos puntos (y cuántos dólares) vencen en los
//     próximos 3 meses, contando hacia arriba; o «nada vence» con lo próximo;
//   · abajo, una gráfica de los próximos 6 meses: las barras crecen con
//     resorte una tras otra, las de los 3 meses van en naranja, y al tocar una
//     se ve el detalle de ese mes.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Tarjeta, Texto, Titulo } from './ui';
import { Latido, NumeroAnimado } from './animacion';
import { colorSistema } from './sistema';
import { diasHasta, dolares, entero, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const VENTANA_DIAS = 90;
const MESES_GRAFICA = 6;
const ALTO = 120;
const NARANJA = '#FF9F0A';

function hoySV() {
  return new Date(Date.now() - 6 * 3600_000);
}

export default function Vencimientos({ vencimientos }) {
  const t = useTema();
  const { pronto, proximo, barras, maximo } = useMemo(() => {
    const lista = (vencimientos ?? []).filter((v) => (diasHasta(v.vence) ?? -1) >= 0);
    const pronto = lista.filter((v) => diasHasta(v.vence) <= VENTANA_DIAS);
    const h = hoySV();
    const barras = Array.from({ length: MESES_GRAFICA }, (_, i) => {
      const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + i, 1));
      const clave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const del = lista.filter((v) => String(v.vence).startsWith(clave));
      return {
        clave, mes: MESES[d.getUTCMonth()], anio: d.getUTCFullYear(),
        puntos: del.reduce((s, v) => s + Number(v.puntos), 0),
        // El mes cae en la ventana si su PRIMER vencimiento cae en ella.
        pronto: del.some((v) => diasHasta(v.vence) <= VENTANA_DIAS),
        fechas: del,
      };
    });
    return {
      pronto: { puntos: pronto.reduce((s, v) => s + Number(v.puntos), 0), cuantos: pronto.length },
      proximo: lista[0] ?? null,
      barras,
      maximo: Math.max(1, ...barras.map((b) => b.puntos)),
    };
  }, [vencimientos]);
  const [elegido, setElegido] = useState(null);

  if (!proximo) return null;
  const hayGrafica = barras.some((b) => b.puntos > 0);
  const diasProximo = diasHasta(proximo.vence);
  const detalle = elegido != null ? barras[elegido] : null;

  return (
    <Tarjeta estilo={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Titulo>Puntos por vencer</Titulo>
        {pronto.puntos > 0 && diasProximo != null && diasProximo <= 30 ? (
          <Latido>
            <View style={{ backgroundColor: NARANJA, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#2A1600' }}>
                {diasProximo === 0 ? 'Vence hoy' : diasProximo === 1 ? 'Vence mañana' : `En ${diasProximo} días`}
              </Text>
            </View>
          </Latido>
        ) : null}
      </View>

      {pronto.puntos > 0 ? (
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <NumeroAnimado valor={pronto.puntos} formato="entero" estilo={{ fontSize: 34, fontWeight: '900', color: t.oscuro ? NARANJA : '#B35C00', letterSpacing: -0.5 }} />
            <Texto nivel={2}>pts · {dolares(pronto.puntos / 100)}</Texto>
          </View>
          <Texto nivel={2} estilo={{ fontSize: 14 }}>
            vencen en los próximos 3 meses. Úsalos en tu próxima compra.
          </Texto>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: suave(t.color.verde, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: t.color.verdeTexto }}>✓</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Texto estilo={{ fontWeight: '700' }}>Nada vence en los próximos 3 meses</Texto>
            <Texto nivel={2} estilo={{ fontSize: 14 }}>Lo próximo: {entero(proximo.puntos)} pts el {fecha(proximo.vence)}.</Texto>
          </View>
        </View>
      )}

      {hayGrafica ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: ALTO + 40, gap: 8 }}>
            {barras.map((b, i) => (
              <Barra key={b.clave} barra={b} indice={i} maximo={maximo} elegida={elegido === i}
                color={b.pronto ? NARANJA : t.color.verde} alTocar={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setElegido(elegido === i ? null : i);
                }} />
            ))}
          </View>
          <Texto nivel={3} estilo={{ fontSize: 13 }}>
            {detalle
              ? detalle.puntos
                ? `${detalle.mes} ${detalle.anio}: ${entero(detalle.puntos)} pts (${detalle.fechas.map((f) => fecha(f.vence)).join(', ')})`
                : `${detalle.mes} ${detalle.anio}: no vence nada.`
              : 'Próximos 6 meses. Toca un mes para ver el detalle.'}
          </Texto>
        </View>
      ) : null}
    </Tarjeta>
  );
}

function Barra({ barra, indice, maximo, elegida, color, alTocar }) {
  const alto = useSharedValue(0);
  const realce = useSharedValue(0);
  useEffect(() => {
    alto.value = withDelay(150 + indice * 90, withSpring(barra.puntos / maximo, { damping: 13, stiffness: 120 }));
  }, [barra.puntos, maximo, indice, alto]);
  useEffect(() => { realce.value = withTiming(elegida ? 1 : 0, { duration: 180 }); }, [elegida, realce]);
  const estiloBarra = useAnimatedStyle(() => ({
    height: Math.max(barra.puntos ? 6 : 3, alto.value * ALTO),
    transform: [{ scaleX: 1 + realce.value * 0.12 }],
    opacity: 0.75 + realce.value * 0.25,
  }));
  return (
    <Pressable onPress={alTocar} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}
      accessibilityRole="button" accessibilityLabel={`${barra.mes} ${barra.anio}: ${entero(barra.puntos)} puntos`}>
      {barra.puntos ? (
        <Text style={{ fontSize: 11, fontWeight: '800', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{entero(barra.puntos)}</Text>
      ) : null}
      <Animated.View style={[{ width: '100%', borderRadius: 8, backgroundColor: barra.puntos ? color : colorSistema.separador }, estiloBarra]} />
      <Text style={{ fontSize: 12, fontWeight: elegida ? '800' : '600', color: elegida ? colorSistema.texto : colorSistema.texto2 }}>{barra.mes}</Text>
    </Pressable>
  );
}
