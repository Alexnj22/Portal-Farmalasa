// «Pregunta por pregunta», NATIVO — la `Distribucion` del portal: una barra
// por opción con cuántos la eligieron y su porcentaje, la posición promedio en
// un ranking, o el promedio en una pregunta de número. Las opciones y sus
// rótulos salen del núcleo (`categoriasDe`, `tipoDe`).
import { Text, View } from 'react-native';
import { categoriasDe, tipoDe } from '@nucleo/utils/encuestasClientes';
import { formatPct } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

function Barra({ label, valor, max, sub }) {
  const ancho = max ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{label}</Text>
        {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{sub}</Text> : null}
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', minWidth: 28, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
        <View style={{ width: `${ancho}%`, height: 8, borderRadius: 4, backgroundColor: MARCA.azulClaro }} />
      </View>
    </View>
  );
}

export function Distribucion({ p, numero }) {
  const total = p.respuestas || 0;
  let cuerpo;
  if (p.tipo === 'ranking') {
    const orden = Object.entries(p.ranking || {}).sort((a, b) => a[1] - b[1]);
    cuerpo = orden.map(([id, pos], i) => (
      <Text key={id} style={{ color: colorSistema.texto, fontSize: 14 }}>
        {`${i + 1}. ${p.opciones?.find((o) => o.id === id)?.texto || id}`}
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{` · posición promedio ${pos}`}</Text>
      </Text>
    ));
  } else if (p.tipo === 'numero') {
    cuerpo = <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Promedio: ${p.promedio ?? '—'}`}</Text>;
  } else {
    const cats = categoriasDe(p);
    const max = Math.max(1, ...cats.map((c) => p.conteo?.[c.clave] || 0));
    cuerpo = cats.map((c) => {
      const n = p.conteo?.[c.clave] || 0;
      return <Barra key={c.clave} label={c.label} valor={n} max={max} sub={total ? formatPct((n / total) * 100, { decimales: 0 }) : null} />;
    });
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>
        <Text style={{ color: colorSistema.texto2 }}>{`${numero}. `}</Text>{p.texto}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: -4 }}>
        {[tipoDe(p.tipo).corto, `${total} resp.`, p.puntaje != null ? `${p.puntaje}/100` : null].filter(Boolean).join(' · ')}
      </Text>
      {cuerpo}
    </View>
  );
}

/** Todas las preguntas con respuesta cerrada (las de texto van en Comentarios). */
export default function PreguntaPorPregunta({ preguntas }) {
  const cerradas = (preguntas || []).filter((p) => p.tipo !== 'texto');
  if (!cerradas.length) return null;
  return (
    <View style={{ gap: 18 }}>
      {cerradas.map((p, i) => <Distribucion key={p.id} p={p} numero={i + 1} />)}
    </View>
  );
}
