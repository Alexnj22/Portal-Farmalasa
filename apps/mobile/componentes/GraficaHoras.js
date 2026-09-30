// Una gráfica de barras por hora que se RECORRE con el dedo (decisión del
// usuario del 2026-09-30: las gráficas del sistema de Apple no dejan tocar una
// barra para ver su valor; «si con el nativo no se puede lograr la
// funcionalidad esperada, hagamos el B»).
//
// Como la app Bolsa: se apoya el dedo y se desliza; la barra bajo el dedo se
// resalta, arriba aparece su valor en una etiqueta de vidrio y cada cambio de
// hora da una vibración leve. Al soltar, vuelve a mostrar el total. Colores
// del sistema para los ejes y el de la marca para las barras; igual en iPhone
// y Android.
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Line, Rect } from 'react-native-svg';
import Vidrio from './Vidrio';
import { colorSistema } from './Formulario';

const etiquetaDeHora = (h) => (h === 12 ? '12 m.' : h < 12 ? `${h} a. m.` : `${h - 12} p. m.`);
const corta = (h) => (h === 12 ? '12' : h < 12 ? `${h}a` : `${h - 12}p`);

/**
 * @param valores  un número por hora, desde `desde`
 * @param extra    opcional, un texto por hora para la etiqueta («8 tickets»)
 * @param formato  cómo se escribe un valor
 */
export default function GraficaHoras({ valores = [], desde = 7, color = '#12B76A', alto = 180, formato = (v) => String(v), extra, resumen }) {
  const [ancho, setAncho] = useState(0);
  const [elegida, setElegida] = useState(null);
  const ultima = useRef(null);
  const max = Math.max(1, ...valores);
  const n = valores.length || 1;
  const hueco = 4;
  const anchoBarra = ancho ? (ancho - hueco * (n - 1)) / n : 0;

  const indiceEn = (x) => Math.max(0, Math.min(n - 1, Math.floor(x / (ancho / n))));
  const elegir = (x) => {
    const i = indiceEn(x);
    if (i !== ultima.current) {
      ultima.current = i;
      Haptics.selectionAsync().catch(() => {});
      setElegida(i);
    }
  };

  const gesto = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // Sólo roba el gesto si el dedo se mueve de lado: así el desplazamiento
    // vertical de la pantalla sigue funcionando encima de la gráfica.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => elegir(e.nativeEvent.locationX),
    onPanResponderMove: (e) => elegir(e.nativeEvent.locationX),
    onPanResponderRelease: () => { ultima.current = null; setElegida(null); },
    onPanResponderTerminate: () => { ultima.current = null; setElegida(null); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ancho, n]);

  const hora = elegida != null ? desde + elegida : null;
  const pico = valores.indexOf(Math.max(...valores));

  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: 58, justifyContent: 'center' }}>
        {elegida != null ? (
          <Vidrio radio={14} style={{ alignSelf: 'flex-start' }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{etiquetaDeHora(hora)}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {formato(valores[elegida])}{extra ? <Text style={{ fontSize: 14, fontWeight: '500', color: colorSistema.texto2 }}>  {extra[elegida]}</Text> : null}
              </Text>
            </View>
          </Vidrio>
        ) : resumen}
      </View>

      <View onLayout={(e) => setAncho(e.nativeEvent.layout.width)} {...gesto.panHandlers}>
        {ancho ? (
          <Svg width={ancho} height={alto}>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={ancho} y1={alto * f} y2={alto * f} stroke={colorSistema.separadorClaro} strokeDasharray="3 5" />
            ))}
            {valores.map((v, i) => {
              const h = Math.max(3, (v / max) * (alto - 6));
              const activa = elegida == null ? i === pico : i === elegida;
              return (
                <Rect key={i} x={i * (anchoBarra + hueco)} y={alto - h} width={anchoBarra} height={h} rx={Math.min(6, anchoBarra / 2)}
                  fill={color} opacity={elegida == null ? (activa ? 1 : 0.55) : (activa ? 1 : 0.25)} />
              );
            })}
          </Svg>
        ) : <View style={{ height: alto }} />}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {valores.map((_, i) => (i % 3 === 0 ? (
          <Text key={i} style={{ color: colorSistema.texto2, fontSize: 11 }}>{corta(desde + i)}</Text>
        ) : null))}
      </View>
    </View>
  );
}
