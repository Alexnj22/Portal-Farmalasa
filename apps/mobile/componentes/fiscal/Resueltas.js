// El historial de lo resuelto en Facturación, NATIVO — la sección plegable de
// `TabPendienteMH` y `TabAnuladas` del portal: este mes o todo, con quién lo
// resolvió, cuándo y su nota.
//   · En Hacienda (`cola='mh'`): las que Hacienda selló en el mes (sello
//     válido, `fetchConfirmedMhInvoices`) más las resueltas a mano.
//   · En Anuladas (`cola='nulas'`): las solventadas, con la marca
//     «Solventado internamente» de las que se excluyeron del barrido —nunca se
//     le mandaron a Hacienda, a propósito—.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  fetchConfirmedMhInvoices, fetchExcluidasDelBarrido, fetchInvoiceResolutionsHistorial, fetchInvoicesByIds,
} from '@nucleo/data/facturacion';
import { hoySV } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import Tocable from '../Tocable';

const COLUMNAS = 'id, correlativo, erp_invoice_id, branch_id, tipo_documento, cliente, fecha, total';

async function facturasPorId(ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await fetchInvoicesByIds(ids.slice(i, i + 200), COLUMNAS);
    if (error) throw error;
    for (const f of data || []) mapa[f.id] = f;
  }
  return mapa;
}

export default function Resueltas({ cola, sala, nombreSala, verMontos, recarga }) {
  const [abierto, setAbierto] = useState(false);
  const [todos, setTodos] = useState(false);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const mes = hoySV().slice(0, 7);

  const cargar = useCallback(async () => {
    try {
      const [{ data: hist, error: e1 }, excl, sellos] = await Promise.all([
        fetchInvoiceResolutionsHistorial('id, invoice_id, comment, resolved_by, resolved_at'),
        cola === 'nulas' ? Promise.resolve(fetchExcluidasDelBarrido()).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        cola === 'mh' ? Promise.resolve(fetchConfirmedMhInvoices(sala, `${mes}-01`, hoySV())).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      if (e1) throw e1;
      const excluidas = new Set((excl.data || []).map((x) => x.invoice_id));
      const selladas = sellos.data || [];
      const conSello = new Set(selladas.map((x) => x.id));
      const resoluciones = (hist || []).filter((r) => !conSello.has(r.invoice_id));
      const facturas = await facturasPorId([...new Set(resoluciones.map((r) => r.invoice_id))]);
      const aMano = resoluciones.map((r) => ({ ...r, factura: facturas[r.invoice_id] || null, excluida: excluidas.has(r.invoice_id) }))
        .filter((r) => !sala || String(r.factura?.branch_id) === String(sala));
      const porSello = selladas.map((f) => ({ id: `s${f.id}`, factura: f, sellada: true, resolved_at: f.fecha }));
      setFilas([...porSello, ...aMano].sort((a, b) => String(b.resolved_at || '').localeCompare(String(a.resolved_at || ''))));
      setError(null);
    } catch (e) { setFilas([]); setError(e?.message || 'No se pudo cargar el historial.'); }
  }, [cola, sala, mes]);
  useEffect(() => { if (abierto) cargar(); }, [abierto, cargar, recarga]);

  const visibles = useMemo(() => (filas || []).filter((r) => todos || String(r.resolved_at || '').startsWith(mes)), [filas, todos, mes]);
  return (
    <View style={{ marginHorizontal: 16, gap: 8, marginTop: 8 }}>
      <Tocable onPress={() => setAbierto((v) => !v)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
          {`${abierto ? '▾' : '▸'} ${cola === 'mh' ? 'Selladas y resueltas' : 'Solventadas'} ${todos ? '· todas' : '· este mes'}${filas ? ` · ${visibles.length}` : ''}`}
        </Text>
      </Tocable>
      {abierto ? (
        filas == null ? <ActivityIndicator /> : (
          <>
            {error ? <Text style={{ color: MARCA.rojo, fontSize: 13 }}>{error}</Text> : null}
            {visibles.map((r) => {
              const f = r.factura;
              return (
                <Vidrio key={r.id} radio={16}>
                  <View style={{ padding: 12, gap: 3 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${f?.tipo_documento ?? ''} ${f?.correlativo ?? ''}${f?.erp_invoice_id ? ` · #${f.erp_invoice_id}` : ''}`}</Text>
                      {verMontos && f?.total ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{formatMoney(f.total)}</Text> : null}
                    </View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[f?.cliente, f ? nombreSala(f.branch_id) : null].filter(Boolean).join(' · ')}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {r.sellada ? <Pildora texto="Sellada por Hacienda" color={MARCA.verde} /> : <Pildora texto="Resuelta a mano" color={MARCA.azulClaro} />}
                      {r.excluida ? <Pildora texto="Solventado internamente" color={MARCA.ambar} /> : null}
                    </View>
                    {r.comment ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${r.comment}»`}</Text> : null}
                    {!r.sellada ? (
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${r.resolved_by ? shortEmployeeName({ name: r.resolved_by }) : '—'}${r.resolved_at ? ` · ${fechaHora12(r.resolved_at)}` : ''}`}</Text>
                    ) : null}
                  </View>
                </Vidrio>
              );
            })}
            {!visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nada resuelto en este período.</Text> : null}
            <Tocable onPress={() => setTodos((v) => !v)} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{todos ? 'Ver solo este mes' : 'Ver todas'}</Text>
            </Tocable>
          </>
        )
      ) : null}
    </View>
  );
}
