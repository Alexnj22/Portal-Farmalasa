// La gráfica de Horarios — `ScheduleChart` del portal: las transacciones
// promedio de los últimos 3 meses, por hora (general o de un día) o por día de
// la semana, cada barra del color de su nivel (`nivelDeTransacciones`, núcleo:
// crítica / pico / normal / muerta). Tocar una barra dice su valor.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';
import Segmentos from '../Segmentos';

export const COLOR_DE_NIVEL = { critica: MARCA.rojo, pico: MARCA.ambar, normal: MARCA.azulClaro, muerta: 'rgba(127,127,127,0.45)' };
const LEYENDA = [['critica', 'Crítica'], ['pico', 'Pico'], ['normal', 'Normal'], ['muerta', 'Baja']];
const ALTO = 120;

export default function GraficaTx({ stats, dia, nombreDelDia }) {
  const [vista, setVista] = useState('dia');
  const [tocada, setTocada] = useState(null);
  const datos = vista === 'semana' ? (stats?.days || []) : vista === 'general' ? (stats?.generalHours || []) : (stats?.specificHours?.[dia] || []);
  const max = Math.max(1, ...datos.map((d) => d.avg || 0));
  const sel = tocada != null ? datos[tocada] : null;
  return (
    <View style={{ gap: 10 }}>
      <Segmentos activa={vista} onCambiar={(v) => { setVista(v); setTocada(null); }} opciones={[
        { id: 'dia', label: nombreDelDia || 'Este día' }, { id: 'general', label: 'Por hora' }, { id: 'semana', label: 'Por día' },
      ]} />
      <View style={{ marginHorizontal: 16 }}>
        <Vidrio radio={20}>
          <View style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tx promedio · últimos 3 meses</Text>
              {sel ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{`${sel.label}: ${sel.avg}`}</Text> : null}
            </View>
            {datos.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: ALTO + 18, gap: 3 }}>
                {datos.map((d, i) => {
                  const alto = d.avg > 0 ? Math.max(6, (d.avg / max) * ALTO) : 2;
                  const color = COLOR_DE_NIVEL[d.nivel] ?? MARCA.azulClaro;
                  const mostrarRotulo = datos.length <= 8 || i % 2 === 0;
                  return (
                    <Pressable key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}
                      onPress={() => { Haptics.selectionAsync().catch(() => {}); setTocada(tocada === i ? null : i); }}>
                      <View style={{ width: '100%', height: alto, borderRadius: 4, backgroundColor: color, opacity: tocada == null || tocada === i ? 1 : 0.45 }} />
                      <Text style={{ color: colorSistema.texto2, fontSize: 9, fontWeight: '600' }} numberOfLines={1}>
                        {mostrarRotulo ? String(d.label).replace(/:00/, '').replace(/\s?a\.\s?m\./, 'a').replace(/\s?p\.\s?m\./, 'p') : ' '}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Sin ventas registradas para esta sala.</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {LEYENDA.map(([k, t]) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: COLOR_DE_NIVEL[k] }} />
                  <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        </Vidrio>
      </View>
    </View>
  );
}
