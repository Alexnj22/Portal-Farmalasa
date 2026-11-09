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
import { Text, View } from 'react-native';
import Presionable from './Presionable';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Tarjeta, Texto } from './ui';
import { FlechaDesplegable, Latido, NumeroAnimado } from './animacion';
import { colorSistema } from './sistema';
import { diasHasta, dolares, entero, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';
import Icono from './Icono';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const VENTANA_DIAS = 90;
const MESES_GRAFICA = 6;
const ALTO = 64;
const NARANJA = '#FF9F0A';

function hoySV() {
  return new Date(Date.now() - 6 * 3600_000);
}

export default function Vencimientos({ vencimientos }) {
  const t = useTema();
  const { pronto, proximo, barras, maximo, siguientes } = useMemo(() => {
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
      siguientes: lista.slice(0, 3),
      barras,
      maximo: Math.max(1, ...barras.map((b) => b.puntos)),
    };
  }, [vencimientos]);
  const [elegido, setElegido] = useState(null);
  const [abierto, setAbierto] = useState(false);

  if (!proximo) return null;
  const hayGrafica = barras.some((b) => b.puntos > 0);
  const diasProximo = diasHasta(proximo.vence);
  const detalle = elegido != null ? barras[elegido] : null;

  const hayPronto = pronto.puntos > 0;
  const urge = hayPronto && diasProximo != null && diasProximo <= 30;
  const tono = hayPronto ? NARANJA : t.color.magenta;
  return (
    // Compacta (2026-11-09): una fila con la respuesta; el detalle, al tocarla.
    <Tarjeta estilo={{ gap: 10, paddingVertical: 10 }}>
      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto((a) => !a); }} accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        accessibilityLabel={hayPronto ? `${entero(pronto.puntos)} puntos por vencer en 3 meses, ${dolares(pronto.puntos / 100)}. Ver detalle` : 'Nada vence en los próximos 3 meses. Ver detalle'}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(tono, t.oscuro ? 0.26 : 0.13) }}>
          <Icono sf={hayPronto ? 'clock.badge.exclamationmark.fill' : 'checkmark.shield.fill'} respaldo={hayPronto ? '⏰' : '✓'} tam={17} color={hayPronto ? (t.oscuro ? NARANJA : '#B35C00') : t.color.magentaTexto} />
        </View>
        <View style={{ flex: 1 }}>
          {hayPronto ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5 }}>
              <NumeroAnimado valor={pronto.puntos} formato="entero" estilo={{ fontSize: 18, fontWeight: '900', color: t.oscuro ? NARANJA : '#B35C00' }} />
              <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>pts por vencer</Text>
            </View>
          ) : <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>Nada vence pronto</Text>}
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
            {hayPronto ? `${dolares(pronto.puntos / 100)} en los próximos 3 meses` : `Próximo: ${entero(proximo.puntos)} pts el ${fecha(proximo.vence)}`}
          </Text>
        </View>
        {urge ? (
          <Latido>
            <View style={{ backgroundColor: NARANJA, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: '800', color: '#2A1600' }}>
                {diasProximo === 0 ? 'Hoy' : diasProximo === 1 ? 'Mañana' : `${diasProximo} días`}
              </Text>
            </View>
          </Latido>
        ) : null}
        <FlechaDesplegable abierto={abierto} color={colorSistema.texto3} tam={13} />
      </Presionable>

      {abierto ? (
        <Animated.View entering={FadeInDown.duration(220)} style={{ gap: 8 }}>
          {hayGrafica ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: ALTO + 40, gap: 8 }}>
                {barras.map((b, i) => (
                  <Barra key={b.clave} barra={b} indice={i} maximo={maximo} elegida={elegido === i}
                    color={b.pronto ? NARANJA : t.color.magenta} alTocar={() => {
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
            </>
          ) : <LineaDelTiempo lista={siguientes} t={t} />}
        </Animated.View>
      ) : null}
    </Tarjeta>
  );
}

function Barra({ barra, indice, maximo, elegida, color, alTocar }) {
  const alto = useSharedValue(0);
  const realce = useSharedValue(0);
  useEffect(() => {
    alto.value = withDelay(150 + indice * 90, withTiming(barra.puntos / maximo, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, [barra.puntos, maximo, indice, alto]);
  useEffect(() => { realce.value = withTiming(elegida ? 1 : 0, { duration: 180 }); }, [elegida, realce]);
  const estiloBarra = useAnimatedStyle(() => ({
    height: Math.max(barra.puntos ? 6 : 3, alto.value * ALTO),
    transform: [{ scaleX: 1 + realce.value * 0.12 }],
    opacity: 0.75 + realce.value * 0.25,
  }));
  return (
    <Presionable onPress={alTocar} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}
      accessibilityRole="button" accessibilityLabel={`${barra.mes} ${barra.anio}: ${entero(barra.puntos)} puntos`}>
      {barra.puntos ? (
        <Text style={{ fontSize: 11, fontWeight: '800', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{entero(barra.puntos)}</Text>
      ) : null}
      <Animated.View style={[{ width: '100%', borderRadius: 8, backgroundColor: barra.puntos ? color : colorSistema.separador }, estiloBarra]} />
      <Text style={{ fontSize: 12, fontWeight: elegida ? '800' : '600', color: elegida ? colorSistema.texto : colorSistema.texto2 }}>{barra.mes}</Text>
    </Presionable>
  );
}

// La línea del tiempo (2026-11-04): un punto por fecha, unidos por una raya,
// con cuánto falta en grande y los puntos en una píldora. Vertical a propósito:
// con la letra grande cada fila crece hacia abajo y nada se encima (una línea
// horizontal con rótulos se pisaría). Magenta en calma; naranja sólo si una
// fecha cae en los próximos 3 meses.
function LineaDelTiempo({ lista, t }) {
  if (!lista?.length) return null;
  return (
    <View>
      {lista.map((v, i) => {
        const dias = diasHasta(v.vence);
        const pronto = dias != null && dias <= VENTANA_DIAS;
        const color = pronto ? NARANJA : t.color.magenta;
        const ultimo = i === lista.length - 1;
        return (
          <View key={`${v.vence}-${i}`} style={{ flexDirection: 'row', gap: 12 }}
            accessible accessibilityLabel={`${fecha(v.vence)}: vencen ${entero(v.puntos)} puntos, en ${dias} días`}>
            <View style={{ width: 18, alignItems: 'center' }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: i === 0 ? color : 'transparent', borderWidth: 3,
                borderColor: i === 0 ? suave(color, t.oscuro ? 0.45 : 0.3) : suave(color, 0.55) }} />
              {!ultimo ? <View style={{ flex: 1, width: 2, marginVertical: 3, borderRadius: 1, backgroundColor: suave(t.color.magenta, t.oscuro ? 0.35 : 0.2) }} /> : null}
            </View>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: ultimo ? 0 : 14 }}>
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 150 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colorSistema.texto }}>{fecha(v.vence)}</Text>
                <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
                  {dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${entero(dias)} días`}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: suave(color, t.oscuro ? 0.3 : 0.12) }}>
                <Text style={{ fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], color: pronto ? (t.oscuro ? NARANJA : '#B35C00') : t.color.magentaTexto }}>
                  {entero(v.puntos)} pts · {dolares(Number(v.puntos) / 100)}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
