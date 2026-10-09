// Marketing · Feed, NATIVO — `TabFeed` del portal: el mes como se verá en el
// perfil de la red de UNA marca —la cuadrícula de tres, lo más nuevo arriba—, y
// las historias aparte, en círculos. Sirve para cuidar la armonía antes de
// aprobar. «Todo el plan» o «Sólo aprobado». El feed sale del núcleo
// (`feedDeMarca`, `portadaDePieza`), lo mismo del portal.
import { useMemo, useState } from 'react';
import { Image, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { feedDeMarca, formatoDe, portadaDePieza } from '@nucleo/utils/marketing';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import Segmentos from '../Segmentos';
import { MARCA } from '../inicio/marca';
import Tocable from '../Tocable';

export default function Feed({ piezas, marcas, firmas, onAbrir }) {
  const activas = (marcas || []).filter((m) => m.activo);
  const [marcaId, setMarcaId] = useState(() => activas[0]?.id ?? null);
  const [alcance, setAlcance] = useState('todo');
  const { width } = useWindowDimensions();
  const lado = Math.floor((width - 32 - 4) / 3);
  const { cuadricula, historias } = useMemo(() => feedDeMarca(piezas, marcaId, alcance), [piezas, marcaId, alcance]);
  const src = (p) => { const a = portadaDePieza(p); return a ? firmas?.get?.(a.url) : null; };
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {activas.map((m) => (
          <Tocable key={m.id} onPress={() => setMarcaId(m.id)}
            style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: m.id === marcaId ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
            <Text style={{ color: m.id === marcaId ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{m.nombre}</Text>
          </Tocable>
        ))}
      </ScrollView>
      <Segmentos activa={alcance} onCambiar={setAlcance} opciones={[{ id: 'todo', label: 'Todo el plan' }, { id: 'aprobado', label: 'Sólo aprobado' }]} />
      {historias.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
          {historias.map((p) => (
            <Tocable key={p.id} onPress={() => onAbrir(p)} style={{ alignItems: 'center', width: 70, gap: 4 }}>
              <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: MARCA.ambar, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.2)' }}>
                {src(p) ? <Image source={{ uri: src(p) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={1}>{fechaTexto(p.fecha, { day: 'numeric', month: 'short' })}</Text>
            </Tocable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {cuadricula.map((p) => (
          <Tocable key={p.id} onPress={() => onAbrir(p)} style={({ pressed }) => ({ width: lado, height: lado, opacity: pressed ? 0.7 : 1, backgroundColor: 'rgba(127,127,127,0.18)', justifyContent: 'center', alignItems: 'center' })}>
            {src(p) ? <Image source={{ uri: src(p) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              : <Text style={{ color: colorSistema.texto2, fontSize: 11, textAlign: 'center', padding: 4 }} numberOfLines={3}>{`${formatoDe(p.formato).label}\n${p.titulo}`}</Text>}
          </Tocable>
        ))}
      </View>
      {!cuadricula.length && !historias.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Nada de esta marca en el mes</Text> : null}
    </>
  );
}
