// «Pregunta por pregunta», NATIVO — gemelo de `GraficaDePregunta` del portal
// (2026-11-20): dona cuando se elige UNA respuesta entre pocas, barras en la
// múltiple y en el NPS, la posición promedio en un ranking y el promedio en
// una de número. Qué forma lleva y las porciones salen del núcleo
// (`graficaDe`, `porcionesDe`), lo mismo del portal.
//
// Cada respuesta se toca: filtra todos los resultados por quienes la eligieron
// (`onFiltrar(pregunta, clave)`); tocar la elegida lo quita.
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, G } from 'react-native-svg';
import { graficaDe, porcionesDe, tipoDe } from '@nucleo/utils/encuestasClientes';
import { formatPct } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Tocable from '../Tocable';

// Se arma al pintar: el azul de la marca cambia con el sistema en Android.
const paleta = () => [MARCA.azulClaro, MARCA.ambar, MARCA.violetaClaro, MARCA.rosa, MARCA.verde, MARCA.azulInfo, MARCA.gris, MARCA.amarillo];
const deNps = (clave) => (Number(clave) >= 9 ? MARCA.verde : Number(clave) >= 7 ? MARCA.ambar : MARCA.rojo);

function colorDe(p, c, i) {
  if (p.tipo === 'nps') return deNps(c.clave);
  if (p.tipo === 'si_no') return c.clave === 'true' ? MARCA.verde : MARCA.rojo;
  const lista = paleta();
  return lista[i % lista.length];
}

function Respuesta({ c, color, activa, apagada, onPress, barra, max }) {
  return (
    <Tocable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: activa }}
      accessibilityLabel={`${c.label}: ${c.n}, ${formatPct(c.pct, { decimales: 0 })}. ${activa ? 'Quitar filtro' : 'Ver sólo a quienes la eligieron'}`}
      style={{ minHeight: 44, justifyContent: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 10, opacity: apagada ? 0.4 : 1,
        backgroundColor: activa ? `${MARCA.azulClaro}22` : 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {!barra ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{c.label}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{c.n}</Text>
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
          {formatPct(c.pct, { decimales: 0 })}
        </Text>
      </View>
      {barra ? (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
          <View style={{ width: `${max ? (c.pct / max) * 100 : 0}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
        </View>
      ) : null}
    </Tocable>
  );
}

function Dona({ p, porciones, total, elegida }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const inicios = porciones.reduce((a, c) => [...a, a[a.length - 1] + (total ? (c.n / total) * C : 0)], [0]);
  const mayor = porciones.reduce((a, c) => (c.n > (a?.n ?? -1) ? c : a), null);
  const centro = elegida != null ? porciones.find((c) => c.clave === elegida) : mayor;
  return (
    <View style={{ width: 132, height: 132, alignSelf: 'center' }}>
      <Svg width={132} height={132} viewBox="0 0 100 100">
        <G rotation={-90} origin="50, 50">
          <Circle cx={50} cy={50} r={R} fill="none" strokeWidth={14} stroke={colorSistema.separador} />
          {porciones.map((c, i) => {
            if (!c.n || !total) return null;
            const largo = (c.n / total) * C;
            const aire = c.n === total ? 0 : Math.min(1, largo / 2);
            return (
              <Circle key={c.clave} cx={50} cy={50} r={R} fill="none" strokeWidth={14} stroke={colorDe(p, c, i)}
                strokeOpacity={elegida != null && elegida !== c.clave ? 0.25 : 1}
                strokeDasharray={`${Math.max(0, largo - aire)} ${C}`} strokeDashoffset={-inicios[i]} />
            );
          })}
        </G>
      </Svg>
      {centro && total ? (
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatPct(centro.pct, { decimales: 0 })}</Text>
          <Text numberOfLines={2} style={{ color: colorSistema.texto2, fontSize: 11, textAlign: 'center' }}>{centro.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Distribucion({ p, numero, filtro, onFiltrar }) {
  const total = p.respuestas || 0;
  const forma = graficaDe(p);
  const elegida = filtro?.pregunta === p.id ? filtro.valor : null;
  const tocar = (clave) => {
    Haptics.selectionAsync().catch(() => {});
    onFiltrar?.(p.id, elegida === clave ? null : clave);
  };
  let cuerpo;
  if (forma === 'ranking') {
    const orden = Object.entries(p.ranking || {}).sort((a, b) => a[1] - b[1]);
    cuerpo = orden.map(([id, pos], i) => (
      <Text key={id} style={{ color: colorSistema.texto, fontSize: 14 }}>
        {`${i + 1}. ${p.opciones?.find((o) => o.id === id)?.texto || id}`}
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{` · posición promedio ${pos}`}</Text>
      </Text>
    ));
  } else if (forma === 'numero') {
    cuerpo = <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Promedio: ${p.promedio ?? '—'}`}</Text>;
  } else {
    const porciones = porcionesDe(p);
    const max = Math.max(1, ...porciones.map((c) => c.pct));
    const filas = porciones.map((c, i) => (
      <Respuesta key={c.clave} c={c} color={colorDe(p, c, i)} activa={elegida === c.clave}
        apagada={elegida != null && elegida !== c.clave} onPress={() => tocar(c.clave)} barra={forma === 'barras'} max={max} />
    ));
    cuerpo = (
      <>
        {forma === 'dona' ? <Dona p={p} porciones={porciones} total={total} elegida={elegida} /> : null}
        <View style={{ gap: 2 }}>{filas}</View>
        {p.tipo === 'multiple' ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>Podían marcar varias. Los porcentajes no suman 100 %.</Text> : null}
      </>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>
        <Text style={{ color: colorSistema.texto2 }}>{`${numero}. `}</Text>{p.texto}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: -4 }}>
        {[tipoDe(p.tipo).corto, `${total} resp.`, p.puntaje != null ? `${p.puntaje}/100` : null].filter(Boolean).join(' · ')}
      </Text>
      {total === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie la respondió con estos filtros.</Text> : cuerpo}
    </View>
  );
}

/** Todas las preguntas con respuesta cerrada (las de texto van en Comentarios). */
export default function PreguntaPorPregunta({ preguntas, numeroDe = {}, filtro = null, onFiltrar }) {
  const cerradas = (preguntas || []).filter((p) => p.tipo !== 'texto');
  if (!cerradas.length) return null;
  return (
    <View style={{ gap: 22 }}>
      {cerradas.map((p, i) => <Distribucion key={p.id} p={p} numero={numeroDe[p.id] ?? i + 1} filtro={filtro} onFiltrar={onFiltrar} />)}
    </View>
  );
}
