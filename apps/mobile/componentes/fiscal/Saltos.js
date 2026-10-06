// Facturación · Saltos, NATIVO y de sólo lectura — `TabSaltos` del portal:
// los saltos de correlativo (números que faltan entre una factura y la
// siguiente) y los documentos con campos nulos, con sus cuatro cifras
// (Saltos / Sin resolver / Solventados / Campos nulos). Solventar un salto
// pide revisar el talonario a la vista: se queda en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchGapResolutions, fetchNullResolutionIds, fetchSalesInvoiceGaps, fetchSalesInvoiceNulls } from '@nucleo/data/facturacion';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';

const clave = (g) => `${g.branch_id}__${g.tipo_documento}__${g.gap_from}__${g.gap_to}`;

export default function Saltos({ sala, nombreSala, recarga }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    const [g, n, r, nr] = await Promise.all([fetchSalesInvoiceGaps(sala), fetchSalesInvoiceNulls(sala), fetchGapResolutions(), fetchNullResolutionIds()]);
    setError(g.error?.message || n.error?.message || r.error?.message || nr.error?.message || null);
    setD({ gaps: g.data || [], nulls: n.data || [], res: r.data || [], nullRes: new Set((nr.data || []).map((x) => x.null_id)) });
  }, [sala]);
  useEffect(() => { cargar(); }, [cargar, recarga]);

  const resueltos = useMemo(() => new Set((d?.res || []).map(clave)), [d]);
  const pendientes = useMemo(() => (d?.gaps || []).filter((g) => !resueltos.has(clave(g))), [d, resueltos]);
  const nulos = useMemo(() => (d?.nulls || []).filter((n) => !d.nullRes.has(n.id)), [d]);
  if (!d) return <ActivityIndicator style={{ marginTop: 24 }} />;

  return (
    <View style={{ gap: 10 }}>
      <FilaDeKpis>
        <Kpi icono="Hourglass" rotulo="Saltos" valor={String(d.gaps.length)} color={MARCA.azulClaro} apoyo={`${d.res.length} solventados`} />
        <Kpi icono="AlertTriangle" rotulo="Sin resolver" valor={String(pendientes.length)} color={pendientes.length ? MARCA.rojo : MARCA.verde} pide={pendientes.length > 0} apoyo={`${nulos.length} con campos nulos`} />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {pendientes.map((g) => {
        const n = Number(g.gap_count ?? (Number(g.gap_to) - Number(g.gap_from) + 1));
        return (
          <View key={clave(g)} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} tinte="rgba(240,68,56,0.08)">
              <View style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${g.tipo_documento} · del ${g.gap_from} al ${g.gap_to}`}</Text>
                  <Pildora texto={`${n} faltante${n === 1 ? '' : 's'}`} color={MARCA.rojo} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[nombreSala(g.branch_id), g.siguiente_correlativo ? `sigue el ${g.siguiente_correlativo}` : null].filter(Boolean).join(' · ')}</Text>
              </View>
            </Vidrio>
          </View>
        );
      })}
      {nulos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginHorizontal: 20, marginTop: 6 }}>{`Campos nulos · ${nulos.length}`}</Text> : null}
      {nulos.map((n) => (
        <View key={n.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${n.correlativo ?? 'Sin número'}${n.erp_invoice_id ? ` · ID ${n.erp_invoice_id}` : ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[nombreSala(n.branch_id), n.fecha ? fechaTexto(n.fecha, { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(Array.isArray(n.campos_nulos) ? n.campos_nulos : String(n.campos_nulos || '').split(',')).filter(Boolean).map((c) => <Pildora key={c} texto={String(c).trim()} color={MARCA.ambar} />)}
              </View>
            </View>
          </Vidrio>
        </View>
      ))}
      {!pendientes.length && !nulos.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin saltos ni campos nulos</Text> : null}
      {pendientes.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Solventar un salto se hace en el portal, con el talonario a la vista." /></View> : null}
    </View>
  );
}
