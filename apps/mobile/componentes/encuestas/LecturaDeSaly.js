// Lo que Saly leyó de los resultados de una encuesta a clientes, NATIVO —
// `SalyLeeResultados` del portal: por bloques (en pocas palabras, los números,
// lo que los explica y qué haría) en vez de un párrafo corrido. Los bloques y
// si se puede leer otra vez salen del núcleo (`bloquesDeLectura`,
// `estadoDeLectura`), lo mismo del portal. La lectura se guarda en la base y
// todos ven la misma; se rehace a mano cuando entran respuestas nuevas.
import { Text, View } from 'react-native';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { bloquesDeLectura, estadoDeLectura } from '@nucleo/utils/encuestasLectura';
import { colorSistema } from '../Formulario';
import Indicador from '../Indicador';
import Tocable from '../Tocable';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';

/** Los números del texto, en negrita: es lo primero que el ojo busca. */
function ConCifras({ texto, estilo }) {
  const partes = String(texto).split(/(\d+(?:[.,]\d+)?\s?%|\(\d+ de \d+\)|\b\d+ de \d+\b)/g);
  return (
    <Text style={estilo}>
      {partes.map((p, i) => (i % 2 ? <Text key={i} style={{ fontWeight: '800', color: colorSistema.texto }}>{p}</Text> : p))}
    </Text>
  );
}

function Boton({ texto, onPress }) {
  return (
    <Tocable onPress={onPress} hitSlop={8} accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center' }}>
      <Text style={{ color: MARCA.violetaClaro, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
}

export default function LecturaDeSaly({ lectura, nombre, leyendo, onActualizar }) {
  const e = estadoDeLectura(lectura);
  if (leyendo) {
    return (
      <View style={{ marginHorizontal: 16 }}>
        <Vidrio radio={16}>
          <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityLiveRegion="polite">
            <Indicador />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`Saly está leyendo los resultados de ${nombre}…`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Cruza las respuestas entre sí para ver qué explica cada cosa. Tarda menos de un minuto.</Text>
            </View>
          </View>
        </Vidrio>
      </View>
    );
  }
  if (!lectura?.texto) {
    if (!e.puede) return null;
    return (
      <View style={{ marginHorizontal: 16 }}>
        <Vidrio radio={16}>
          <View style={{ padding: 14, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>¿Qué significan estos resultados?</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Saly lee los números de ${nombre}, cruza las respuestas entre sí y te dice qué haría.`}</Text>
            <Boton texto="Léelos, Saly" onPress={onActualizar} />
          </View>
        </Vidrio>
      </View>
    );
  }
  const bloques = bloquesDeLectura(lectura.texto);
  const resumen = bloques.find((b) => b.clave === 'resumen') || (bloques[0]?.titulo == null ? bloques[0] : null);
  const resto = bloques.filter((b) => b !== resumen);
  const rotulo = { color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' };

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={16}>
        <View style={{ padding: 14, gap: 12 }} accessibilityLabel="Lo que Saly leyó de los resultados">
          <View style={{ gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Qué significan los resultados</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
              {`Saly leyó ${lectura.respuestas_n} respuesta${lectura.respuestas_n === 1 ? '' : 's'} de ${nombre} · ${fechaTexto(lectura.generado_at, { day: 'numeric', month: 'short' })} ${hora12(lectura.generado_at)}`}
            </Text>
            {e.puede ? <Boton texto={`Leer otra vez (${e.nuevas} nuevas)`} onPress={onActualizar} /> : null}
          </View>
          {resumen ? (
            <View style={{ gap: 4, padding: 12, borderRadius: 14, borderTopLeftRadius: 4, backgroundColor: `${MARCA.violetaClaro}22` }}>
              <Text style={rotulo}>En pocas palabras</Text>
              <ConCifras texto={[resumen.texto, ...resumen.puntos].filter(Boolean).join(' ')} estilo={{ color: colorSistema.texto, fontSize: 15, lineHeight: 21 }} />
            </View>
          ) : null}
          {resto.map((b) => {
            const acciones = b.clave === 'acciones';
            const items = b.puntos.length ? b.puntos : [b.texto];
            return (
              <View key={`${b.clave}-${b.titulo}`} style={{ gap: 6 }}>
                <Text style={rotulo}>{b.titulo}</Text>
                {b.puntos.length > 0 && b.texto ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{b.texto}</Text> : null}
                {items.map((t, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 12, backgroundColor: colorSistema.separador }}>
                    {acciones ? (
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: MARCA.azul, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{i + 1}</Text>
                      </View>
                    ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>•</Text>}
                    <View style={{ flex: 1 }}><ConCifras texto={t} estilo={{ color: colorSistema.texto2, fontSize: 14, lineHeight: 20 }} /></View>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      </Vidrio>
    </View>
  );
}
