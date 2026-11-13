// La firma del paciente con el dedo, NATIVA — gemela de
// `src/components/common/FirmaEnPantalla.jsx` (2026-11-13, «dejemos TODO
// completamente nativo»). Mismo contrato: `onChange(dataUrl | null)` al
// terminar cada trazo y al borrar, con `data:image/png;base64,…` — lo que
// `inyeccion_libro_guardar` acepta (menos de 200 000 caracteres). Se dibuja
// con react-native-svg (ya está en el binario) y se exporta a PNG con su
// `toDataURL`: tinta negra sobre blanco, como en papel.
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colorSistema } from './Formulario';
import Tocable from './Tocable';

const ALTO = 180;
// El PNG sale a este tamaño, no al de la pantalla: a 3x pasaba el límite.
const SALIDA = { width: 600, height: 200 };

const camino = (p) => (p.length ? `M${p[0][0]},${p[0][1]}${p.slice(1).map(([x, y]) => `L${x},${y}`).join('')}${p.length === 1 ? 'l0.1,0' : ''}` : '');

// `onFirmando(true|false)`: la pantalla apaga el desplazamiento mientras el
// dedo firma (en iOS el ScrollView nativo le roba el gesto al recuadro).
export default function FirmaEnPantalla({ onChange, disabled, ayuda, onFirmando }) {
  const [trazos, setTrazos] = useState([]);
  const actual = useRef([]);
  const [, redibujar] = useState(0);
  const svg = useRef(null);
  const ancho = useRef(300);

  const exportar = () => {
    // Se espera al siguiente cuadro para que el último trazo ya esté pintado.
    requestAnimationFrame(() => {
      svg.current?.toDataURL((b64) => onChange?.(b64 ? `data:image/png;base64,${b64}` : null), SALIDA);
    });
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    // La hoja no se desplaza mientras se firma.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      onFirmando?.(true);
      const { locationX: x, locationY: y } = e.nativeEvent;
      actual.current = [[Math.round(x), Math.round(y)]];
      redibujar((n) => n + 1);
    },
    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      actual.current.push([Math.round(x), Math.round(y)]);
      redibujar((n) => n + 1);
    },
    onPanResponderTerminate: () => { onFirmando?.(false); },
    onPanResponderRelease: () => {
      onFirmando?.(false);
      const hecho = actual.current;
      actual.current = [];
      setTrazos((t) => [...t, hecho]);
      exportar();
    },
  }), [disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const borrar = () => { setTrazos([]); actual.current = []; onChange?.(null); };
  const vacia = !trazos.length && !actual.current.length;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>Firma del paciente</Text>
        {!vacia ? (
          <Tocable onPress={borrar} disabled={disabled} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ color: colorSistema.acento, fontSize: 14 }}>Borrar</Text>
          </Tocable>
        ) : null}
      </View>
      <View {...pan.panHandlers} onLayout={(e) => { ancho.current = e.nativeEvent.layout.width; }}
        style={{ height: ALTO, borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF', opacity: disabled ? 0.6 : 1 }}
        accessibilityLabel="Recuadro para firmar">
        <Svg ref={svg} width="100%" height={ALTO}>
          <Rect x="0" y="0" width="100%" height={ALTO} fill="#FFFFFF" />
          {trazos.map((p, i) => <Path key={i} d={camino(p)} stroke="#000000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
          {actual.current.length ? <Path d={camino(actual.current)} stroke="#000000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
        {vacia ? (
          <Text pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', top: ALTO / 2 - 10, color: '#8A8A8E', fontSize: 15 }}>Firme aquí con el dedo</Text>
        ) : null}
      </View>
      {ayuda ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{ayuda}</Text> : null}
    </View>
  );
}
