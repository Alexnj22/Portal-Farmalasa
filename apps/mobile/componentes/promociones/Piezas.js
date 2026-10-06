// Las piezas de Promociones en la app: la barra de avance contra el lote, la
// caja de tres datos de cada tarjeta y las barras por sala. Copian la FORMA de
// las del portal (`TabActivas`, `TabSeguimiento`); las cuentas salen del
// núcleo (`promocionesUtils`).
import { Text, View } from 'react-native';
import { Host, Icon } from '@expo/ui';
import { fmtUnidades, tonoDeAvance } from '@nucleo/utils/promocionesUtils';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';

const COLOR_DE_TONO = { success: MARCA.verde, warning: MARCA.ambar, info: MARCA.azulClaro };
export const colorDeAvance = (pct) => COLOR_DE_TONO[tonoDeAvance(pct)];

export function Icono({ nombre, color = colorSistema.texto2, tamano = 15 }) {
  return <Host matchContents><Icon name={iconoDe(nombre)} size={tamano} color={color} /></Host>;
}

/** Una barra de proporción. El ancho ES el dato: no se estira para el dedo. */
export function Barra({ pct, color, alto = 6 }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <View style={{ height: alto, borderRadius: alto / 2, backgroundColor: 'rgba(127,127,127,0.22)', overflow: 'hidden' }}>
      <View style={{ width: `${p}%`, height: '100%', borderRadius: alto / 2, backgroundColor: color }} />
    </View>
  );
}

/** Los tres datos de una tarjeta, en su caja. */
export function TresDatos({ datos }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, padding: 10, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.13)' }}>
      {datos.map((d) => (
        <View key={d.rotulo} style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>{d.rotulo}</Text>
          <Text style={{ color: d.color ?? colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{d.valor}</Text>
        </View>
      ))}
    </View>
  );
}

/** Lo vendido contra el lote de un renglón: «12 de 40 · 30%» y su barra. */
export function AvanceDelLote({ vendido, lote, pct }) {
  if (!lote) {
    return <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fmtUnidades(vendido)} unidades vendidas · sin lote declarado`}</Text>;
  }
  const p = Number(pct) || 0;
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
          <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{fmtUnidades(vendido)}</Text>{` de ${fmtUnidades(lote)}`}
        </Text>
        <Text style={{ color: colorDeAvance(p), fontSize: 13, fontWeight: '800' }}>{`${p}%`}</Text>
      </View>
      <Barra pct={p} color={colorDeAvance(p)} />
    </View>
  );
}

/** Por sala: contra su cupo si lo tiene, o su parte de lo vendido. */
export function BarrasPorSala({ reparto = [] }) {
  if (!reparto.length) return null;
  const conCupo = reparto.some((s) => Number(s.asignado_vigente) > 0);
  const mayor = Math.max(1, ...reparto.map((s) => Number(s.vendido) || 0));
  const total = reparto.reduce((a, s) => a + (Number(s.vendido) || 0), 0);
  return (
    <View style={{ gap: 8, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {conCupo ? 'Por sala, contra su cupo' : 'Por sala'}
      </Text>
      {reparto.map((s) => {
        const v = Number(s.vendido) || 0;
        const cupo = Number(s.asignado_vigente) || 0;
        const pct = conCupo ? (cupo > 0 ? Math.min(100, (v / cupo) * 100) : 0) : (v / mayor) * 100;
        const color = conCupo && cupo > 0 ? colorDeAvance((v / cupo) * 100) : MARCA.azulClaro;
        const cambio = Number(s.asignado_vigente) - Number(s.asignado_original);
        return (
          <View key={s.branch_id} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>{s.sala}</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {fmtUnidades(v)}
                <Text style={{ color: colorSistema.texto2, fontWeight: '400' }}>
                  {conCupo && cupo > 0 ? ` de ${fmtUnidades(cupo)}` : !conCupo && total > 0 ? ` · ${Math.round((v / total) * 100)}%` : ''}
                </Text>
              </Text>
              {conCupo && cambio ? <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>{`${cambio > 0 ? '+' : ''}${cambio}`}</Text> : null}
            </View>
            <Barra pct={Math.max(pct, v > 0 ? 3 : 0)} color={color} alto={8} />
          </View>
        );
      })}
    </View>
  );
}
