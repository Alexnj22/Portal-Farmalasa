// Duplicar piezas a otro mes, NATIVO — `DuplicarModal` del portal: el mes
// completo o las piezas que se marquen, al mes que se elija, en el mismo día
// de la semana o en el mismo número de día. Las copias nacen pendientes, sin
// diseños ni pauta: se reutiliza la planificación, no el trabajo. La misma
// llamada del portal (`duplicarPiezas`). Una sola pieza se duplica desde su
// detalle (`marketing-pieza/[id]`).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { duplicarPiezas, fetchMes, fetchPiezas } from '@nucleo/data/marketing';
import { formatoDe } from '@nucleo/utils/marketing';
import { correrMes, etiquetaMes, fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import PasoDeMes from '../componentes/PasoDeMes';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { volver } from '../componentes/volver';

export default function DuplicarPiezas() {
  const { mes: mesParam } = useLocalSearchParams();
  const mes = String(mesParam || mesSV()).slice(0, 7);
  const [piezas, setPiezas] = useState(null);
  const [destino, setDestino] = useState(() => correrMes(mes, 1));
  const [modo, setModo] = useState('semana');
  const [elegidas, setElegidas] = useState(() => new Set());
  const [copiando, setCopiando] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const fila = await fetchMes(mes);
        const ps = fila ? await fetchPiezas(fila.id) : [];
        setPiezas(ps); setElegidas(new Set(ps.map((p) => p.id)));
      } catch (e) { fallo('No se pudo cargar el mes', mensajeAmigable(e)); setPiezas([]); }
    })();
  }, [mes]);
  const ordenadas = useMemo(() => [...(piezas || [])].sort((a, b) => String(a.fecha).localeCompare(b.fecha)), [piezas]);
  const todas = piezas && elegidas.size === piezas.length;
  const alternar = (id) => { Haptics.selectionAsync().catch(() => {}); setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const copiar = async () => {
    setCopiando(true);
    try {
      const r = await duplicarPiezas([...elegidas], destino, modo);
      listo(`${r?.copiadas ?? elegidas.size} pieza(s) copiadas`, `a ${etiquetaMes(destino)}`);
      volver('/marketing');
    } catch (e) { fallo('No se pudo duplicar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    setCopiando(false);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Duplicar ${etiquetaMes(mes)}`, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic">
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginHorizontal: 32 }}>A qué mes</Text>
        <PasoDeMes mes={destino} onCambiar={setDestino} />
        <Segmentos activa={modo} onCambiar={setModo} opciones={[{ id: 'semana', label: 'Mismo día de la semana' }, { id: 'dia', label: 'Mismo número de día' }]} />
        <View style={{ marginHorizontal: 16 }}>
          <Aviso texto={`${modo === 'semana' ? 'El primer lunes cae en el primer lunes, el segundo viernes en el segundo viernes…' : 'El 10 cae en el 10; si el mes no tiene ese día, en el último.'} Las copias quedan pendientes, sin diseños ni pauta.`} />
        </View>
        {piezas == null ? <ActivityIndicator /> : (
          <View style={{ marginHorizontal: 16 }}>
            <Seccion titulo="Qué piezas">
              <Tocable onPress={() => setElegidas(new Set(todas ? [] : piezas.map((p) => p.id)))} style={{ minHeight: 40, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>{todas ? `Quitar todas (${piezas.length})` : `Todas (${piezas.length})`}</Text>
              </Tocable>
              {ordenadas.map((p) => (
                <Tocable key={p.id} onPress={() => alternar(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: elegidas.has(p.id) }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                  <Text style={{ width: 22, color: MARCA.azulClaro, fontSize: 18, fontWeight: '700' }}>{elegidas.has(p.id) ? '✓' : ''}</Text>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>
                    {`${fechaTexto(p.fecha, { weekday: 'short', day: 'numeric' })} · ${formatoDe(p.formato).label} · ${p.titulo}`}
                  </Text>
                </Tocable>
              ))}
              {!piezas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Este mes no tiene piezas.</Text> : null}
            </Seccion>
          </View>
        )}
        <View style={{ marginHorizontal: 16 }}>
          <BotonGrande texto={copiando ? 'Copiando…' : `Copiar ${elegidas.size} a ${etiquetaMes(destino)}`} deshabilitado={!elegidas.size || copiando} onPress={copiar} />
        </View>
      </ScrollView>
    </>
  );
}
