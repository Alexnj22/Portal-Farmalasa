// Las gráficas de Metas y de Puntos, nativas y con el MISMO gesto que
// `GraficaHoras` (decisión del usuario del 2026-09-30): se apoya el dedo y se
// desliza; la columna bajo el dedo se resalta, arriba aparece su valor en una
// etiqueta de vidrio y cada cambio da una vibración leve. Al soltar vuelve el
// resumen. Un toque sin arrastrar llama a `onTocar` (la gráfica del cliente lo
// usa para filtrar sus movimientos por mes, como el clic del portal).
//
// Una sola pieza dibuja lo que el portal hacía con cinco de recharts:
//   · 'barra'  — barras; varias series 'barra' se agrupan lado a lado
//   · 'area'   — línea con relleno degradado (acumulados del día)
//   · 'linea'  — línea con puntos (cumplimiento por mes, canjeados)
//   · 'marca'  — un listón corto por columna (la meta encima de la venta)
// más líneas de referencia punteadas con su rótulo (el ritmo diario, el 95% y
// el 100%).
//
// SVG no lee los colores del sistema (`PlatformColor`): las rejillas usan
// `separadorClaro` y los textos van en `Text` de React Native, encima.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Rect, Stop } from 'react-native-svg';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';

const EJE_Y = 44;          // ancho reservado a la izquierda para las cifras del eje

/**
 * @param datos        [{ etiqueta, titulo?, tenue?, ...valores }]
 * @param series       [{ clave, rotulo, color, tipo }]
 * @param formato      (valor, serie, fila) => texto de la etiqueta flotante
 * @param formatoEje   (valor) => texto corto del eje Y
 * @param referencias  [{ valor, color, rotulo }]
 * @param dominio      [min, max] opcional; por defecto [0, máximo + 8%]
 * @param resumen      lo que se ve arriba cuando nadie está tocando
 * @param detalle      (fila) => texto extra en la etiqueta flotante
 * @param activo       índice resaltado (p. ej. el mes elegido)
 * @param onTocar      (índice) => void, en un toque sin arrastrar
 */
export default function Grafica({
  datos = [], series = [], formato = (v) => String(v), formatoEje = (v) => String(Math.round(v)),
  referencias = [], dominio, alto = 180, resumen = null, detalle, activo = null, onTocar,
}) {
  const [ancho, setAncho] = useState(0);
  const [elegida, setElegida] = useState(null);
  const ultima = useRef(null);
  const movio = useRef(false);
  // El toque viaja por una referencia: si fuera dependencia del gesto, una
  // función nueva en cada pintada lo recrearía en medio del arrastre.
  const tocar = useRef(onTocar);
  useEffect(() => { tocar.current = onTocar; }, [onTocar]);
  const [aparece] = useState(() => new Animated.Value(0));
  const n = datos.length || 1;
  const area = Math.max(0, ancho - EJE_Y);
  const paso = area / n;

  useEffect(() => {
    Animated.timing(aparece, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [aparece]);

  const [min, max] = useMemo(() => {
    if (dominio) return dominio;
    const vals = [];
    for (const f of datos) for (const s of series) { const v = Number(f[s.clave]); if (Number.isFinite(v)) vals.push(v); }
    for (const r of referencias) vals.push(Number(r.valor) || 0);
    const tope = Math.max(1, ...vals);
    return [0, tope * 1.08];
  }, [datos, series, referencias, dominio]);
  const y = (v) => {
    const t = (Number(v) - min) / ((max - min) || 1);
    return alto - Math.max(0, Math.min(1, t)) * alto;
  };
  const cx = (i) => EJE_Y + paso * i + paso / 2;

  const indiceEn = (x) => Math.max(0, Math.min(n - 1, Math.floor((x - EJE_Y) / (paso || 1))));
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
    // Sólo roba el gesto si el dedo se mueve de lado: el desplazamiento
    // vertical de la pantalla sigue funcionando encima de la gráfica.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { movio.current = false; elegir(e.nativeEvent.locationX); },
    onPanResponderMove: (e, g) => { if (Math.abs(g.dx) > 6) movio.current = true; elegir(e.nativeEvent.locationX); },
    onPanResponderRelease: () => {
      const i = ultima.current;
      ultima.current = null; setElegida(null);
      if (!movio.current && i != null && tocar.current) tocar.current(i);
    },
    onPanResponderTerminate: () => { ultima.current = null; setElegida(null); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ancho, n]);

  const barras = series.filter((s) => s.tipo === 'barra');
  const anchoGrupo = Math.min(56, paso * 0.72);
  const anchoBarra = barras.length ? Math.max(2, (anchoGrupo - (barras.length - 1) * 2) / barras.length) : 0;
  const resaltada = elegida ?? activo;
  const opacidad = (i, base = 1) => (resaltada == null ? base : i === resaltada ? 1 : 0.28);

  const rejilla = [0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const cadaCuanto = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(area / 46))));
  const fila = elegida != null ? datos[elegida] : null;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ minHeight: 58, justifyContent: 'center' }}>
        {fila ? (
          <Vidrio radio={14} style={{ alignSelf: 'flex-start' }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, gap: 2 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fila.titulo ?? fila.etiqueta}</Text>
              {series.map((s) => (fila[s.clave] == null ? null : (
                <View key={s.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {series.length > 1 ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} /> : null}
                  <Text style={{ color: colorSistema.texto, fontSize: series.length > 1 ? 16 : 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                    {formato(fila[s.clave], s, fila)}
                    {series.length > 1 ? <Text style={{ fontSize: 13, fontWeight: '500', color: colorSistema.texto2 }}>{`  ${s.rotulo}`}</Text> : null}
                  </Text>
                </View>
              )))}
              {detalle && detalle(fila) ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle(fila)}</Text> : null}
            </View>
          </Vidrio>
        ) : resumen}
      </View>

      <Animated.View style={{ opacity: aparece, transform: [{ translateY: aparece.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}
        onLayout={(e) => setAncho(e.nativeEvent.layout.width)} {...gesto.panHandlers}>
        {ancho ? (
          <View>
            <Svg width={ancho} height={alto}>
              <Defs>
                {series.filter((s) => s.tipo === 'area').map((s) => (
                  <LinearGradient key={s.clave} id={`g-${s.clave}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0.05" stopColor={s.color} stopOpacity={0.28} />
                    <Stop offset="0.95" stopColor={s.color} stopOpacity={0} />
                  </LinearGradient>
                ))}
              </Defs>
              {rejilla.map((v) => (
                <Line key={v} x1={EJE_Y} x2={ancho} y1={y(v)} y2={y(v)} stroke={colorSistema.separadorClaro} strokeDasharray="3 5" />
              ))}
              {elegida != null ? (
                <Rect x={EJE_Y + paso * elegida} y={0} width={paso} height={alto} fill="rgba(127,127,127,0.12)" rx={6} />
              ) : null}
              {barras.map((s, k) => datos.map((f, i) => {
                const v = Number(f[s.clave]);
                if (!Number.isFinite(v) || v <= min) return null;
                const h = Math.max(2, alto - y(v));
                const x = cx(i) - anchoGrupo / 2 + k * (anchoBarra + 2);
                return (
                  <Rect key={`${s.clave}-${i}`} x={x} y={alto - h} width={anchoBarra} height={h}
                    rx={Math.min(4, anchoBarra / 2)} fill={s.color} opacity={opacidad(i, f.tenue ? 0.42 : 1)} />
                );
              }))}
              {series.filter((s) => s.tipo === 'area').map((s) => {
                const pts = datos.map((f, i) => [cx(i), y(Number(f[s.clave]) || 0)]);
                if (!pts.length) return null;
                const linea = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
                return (
                  <Path key={s.clave} d={`${linea} L${pts[pts.length - 1][0]},${alto} L${pts[0][0]},${alto} Z`} fill={`url(#g-${s.clave})`} />
                );
              })}
              {series.filter((s) => s.tipo === 'area' || s.tipo === 'linea').map((s) => {
                const pts = datos.map((f, i) => (f[s.clave] == null ? null : `${cx(i)},${y(Number(f[s.clave]))}`)).filter(Boolean);
                return <Polyline key={`l-${s.clave}`} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />;
              })}
              {series.filter((s) => s.tipo === 'linea').map((s) => datos.map((f, i) => (f[s.clave] == null ? null : (
                <Circle key={`p-${s.clave}-${i}`} cx={cx(i)} cy={y(Number(f[s.clave]))} r={i === resaltada ? 5 : 3.2} fill={s.color} />
              ))))}
              {series.filter((s) => s.tipo === 'area').map((s) => (elegida == null || datos[elegida]?.[s.clave] == null ? null : (
                <Circle key={`pa-${s.clave}`} cx={cx(elegida)} cy={y(Number(datos[elegida][s.clave]))} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />
              )))}
              {series.filter((s) => s.tipo === 'marca').map((s) => datos.map((f, i) => (f[s.clave] == null ? null : (
                <Line key={`m-${s.clave}-${i}`} x1={cx(i) - Math.min(14, paso * 0.42)} x2={cx(i) + Math.min(14, paso * 0.42)}
                  y1={y(Number(f[s.clave]))} y2={y(Number(f[s.clave]))} stroke={s.color} strokeWidth={3} strokeLinecap="round" opacity={opacidad(i)} />
              ))))}
              {referencias.map((r) => (
                <Line key={`r-${r.rotulo}`} x1={EJE_Y} x2={ancho} y1={y(r.valor)} y2={y(r.valor)} stroke={r.color} strokeWidth={1.6} strokeDasharray="6 5" />
              ))}
            </Svg>
            {rejilla.map((v) => (
              <Text key={`t-${v}`} style={{ position: 'absolute', left: 0, width: EJE_Y - 6, top: y(v) - 7, textAlign: 'right', color: colorSistema.texto2, fontSize: 10, fontVariant: ['tabular-nums'] }}>
                {formatoEje(v)}
              </Text>
            ))}
            {referencias.map((r) => (
              <Text key={`rt-${r.rotulo}`} style={{ position: 'absolute', right: 2, top: Math.max(0, y(r.valor) - 15), color: r.color, fontSize: 10, fontWeight: '800' }}>
                {r.rotulo}
              </Text>
            ))}
          </View>
        ) : <View style={{ height: alto }} />}
        <View style={{ height: 16, marginTop: 4 }}>
          {ancho ? datos.map((f, i) => (i % cadaCuanto === 0 || i === n - 1 ? (
            <Text key={i} numberOfLines={1} style={{ position: 'absolute', left: cx(i) - 26, width: 52, textAlign: 'center', color: i === resaltada ? colorSistema.texto : colorSistema.texto2, fontSize: 10, fontWeight: i === resaltada ? '700' : '400' }}>
              {f.etiqueta}
            </Text>
          ) : null)) : null}
        </View>
      </Animated.View>

      {series.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
          {series.map((s) => (
            <View key={s.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{s.rotulo}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Una barra hecha de partes que suman el total (el reparto de los puntos
 * ganados), con su leyenda y porcentaje. `partes`: [{ clave, rotulo, valor,
 * pct, color }].
 */
export function BarraDePartes({ partes = [], total }) {
  const t = Number(total) || partes.reduce((s, p) => s + p.valor, 0) || 1;
  if (!partes.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, backgroundColor: 'rgba(127,127,127,0.13)' }}>
        {partes.map((p) => <View key={p.clave} style={{ width: `${(p.valor / t) * 100}%`, backgroundColor: p.color }} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }}>
        {partes.map((p) => (
          <View key={p.clave} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {p.rotulo} <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{`${p.pct}%`}</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * El termómetro de la meta: lo vendido lleno, la proyección como sombra, y dos
 * marcas en el 95% (medio) y el 100% (completo) — la escala llega hasta el
 * 110% para que pasar la meta también se vea.
 */
export function Termometro({ pct, pctProyectado, color, umbralMedio = 95, umbralTotal = 100, tope = 110 }) {
  const lleno = Math.max(0, Math.min(tope, Number(pct) || 0));
  const sombra = Math.max(lleno, Math.min(tope, Number(pctProyectado) || 0));
  const [aparece] = useState(() => new Animated.Value(0));
  useEffect(() => {
    aparece.setValue(0);
    Animated.timing(aparece, { toValue: 1, duration: 650, useNativeDriver: false }).start();
  }, [aparece, lleno]);
  const marca = (u, rotulo) => (
    <View key={rotulo} style={{ position: 'absolute', left: `${(u / tope) * 100}%`, top: -4, bottom: -18, alignItems: 'center' }}>
      <View style={{ width: 2, height: 22, borderRadius: 1, backgroundColor: colorSistema.texto2 }} />
      <Text style={{ position: 'absolute', top: 22, width: 40, left: -20, textAlign: 'center', color: colorSistema.texto2, fontSize: 10, fontWeight: '700' }}>{rotulo}</Text>
    </View>
  );
  return (
    <View style={{ paddingBottom: 18, marginTop: 6 }}>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
        {pctProyectado != null ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(sombra / tope) * 100}%`, backgroundColor: color, opacity: 0.28 }} /> : null}
        <Animated.View style={{ height: 14, borderRadius: 7, backgroundColor: color, width: aparece.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${(lleno / tope) * 100}%`] }) }} />
      </View>
      {marca(umbralMedio, `${umbralMedio}%`)}
      {marca(umbralTotal, `${umbralTotal}%`)}
    </View>
  );
}
