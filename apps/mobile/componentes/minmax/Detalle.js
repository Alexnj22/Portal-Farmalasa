// Lo que el panel de Min·Máx del portal (`tabminmax/ExpandedPanel`) muestra
// del PRODUCTO, más allá de cada sala: los lotes que vencen en 60 días con la
// política de devolución (y hasta cuándo mandarlos a Bodega), las últimas
// compras y las últimas ventas de la red. Compras y ventas sólo con
// `minmax_ver_costos`, como en el portal.
import { Text, View } from 'react-native';
import { avisoDeLote } from '@nucleo/utils/plazoDeDevolucion';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

const fecha = (d) => (d ? fechaTexto(d, { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const Nota = ({ texto }) => <Text style={{ color: colorSistema.texto2, fontSize: 14, fontStyle: 'italic' }}>{texto}</Text>;

export function LotesPorVencer({ lotes, politica }) {
  if (!lotes?.length) return null;
  const pie = politica ? [
    politica.proveedor_nombre,
    politica.es_devolutivo ? (politica.meses_devolucion != null ? `${politica.meses_devolucion} meses para devolver` : 'devolutivo') : 'No devolutivo (ND)',
    politica.es_cofarsal ? 'COFARSAL' : null,
  ].filter(Boolean).join(' · ') : null;
  return (
    <Seccion titulo="Vencen en 60 días" pie={pie}>
      {lotes.map((l, i) => {
        const a = avisoDeLote(l, politica);
        return (
          <View key={`${l.erp_sucursal_id}-${l.lote}-${i}`} style={{ gap: 3, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ width: 52, color: a.urgente ? MARCA.rojo : MARCA.ambar, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${a.dias} d`}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${formatQty(l.cantidad)} u. · ${ERP_NAMES[l.erp_sucursal_id] ?? `Sala ${l.erp_sucursal_id}`}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Lote ${l.lote || '—'} · vence ${fecha(l.fecha_vencimiento)}`}</Text>
              </View>
            </View>
            {a.limite ? (
              <Text style={{ marginLeft: 62, color: a.fueraDePlazo ? MARCA.rojo : colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
                {`${a.fueraDePlazo ? 'Fuera de plazo — el límite era el' : 'Enviar a Bodega antes del'} ${fechaTexto(a.limite, { day: '2-digit', month: 'short' })}`}
              </Text>
            ) : null}
            {a.reportarND ? <Text style={{ marginLeft: 62, color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>ND — reportar a jefe inmediato (6-7 meses antes de vencer)</Text> : null}
          </View>
        );
      })}
    </Seccion>
  );
}

export function UltimasCompras({ compras, conCosto }) {
  return (
    <Seccion titulo="Últimas compras (Bodega)">
      {!conCosto ? <Nota texto="Sin permiso para ver costos de compra." /> : !compras?.length ? <Nota texto="Sin compras registradas." /> : compras.map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{p.proveedor || 'Sin proveedor'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[fecha(p.fecha), `${formatQty(p.cantidad)} u.`, p.lote && p.lote !== 'GENERICO' ? `lote ${p.lote}` : null].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(p.precio_unitario)}</Text>
        </View>
      ))}
    </Seccion>
  );
}

export function UltimasVentas({ ventas, conCosto, titulo = 'Últimas ventas' }) {
  return (
    <Seccion titulo={titulo}>
      {!conCosto ? <Nota texto="Sin permiso para ver costos de compra." /> : !ventas?.length ? <Nota texto="Sin ventas registradas." /> : ventas.map((v, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{v.cliente || 'Consumidor final'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[fecha(v.fecha), ERP_NAMES[v.erp_sucursal_id] ?? null, `${formatQty(v.cantidad)} u.`].filter(Boolean).join(' · ')}</Text>
          </View>
          {Number(v.total_linea) > 0 ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(v.total_linea)}</Text> : null}
        </View>
      ))}
    </Seccion>
  );
}
