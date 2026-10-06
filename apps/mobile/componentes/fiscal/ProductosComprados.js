// Compras · Productos, NATIVO — `TabProductos` del portal: cada producto con
// historial de compra (primera y última, días desde la primera, recepciones,
// unidades recibidas, costo promedio y último costo), paginado contra el
// servidor. El costo sólo con `compras_ver_montos`. La app le pone el NOMBRE
// al código (`fetchNombresDeProductos`): el portal sólo muestra el número.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchNombresDeProductos, fetchProductPurchaseSummaryPage } from '@nucleo/data/compras';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';

const POR_PAGINA = 30;

export default function ProductosComprados({ busqueda, verMontos }) {
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [nombres, setNombres] = useState(new Map());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const turno = useRef(0);

  useEffect(() => { setPagina(0); }, [busqueda]);
  const cargar = useCallback(async () => {
    const yo = ++turno.current;
    setCargando(true);
    const from = pagina * POR_PAGINA;
    const { data, count, error: e } = await fetchProductPurchaseSummaryPage(from, from + POR_PAGINA - 1, busqueda || null);
    if (yo !== turno.current) return;
    setError(e?.message ?? null);
    setFilas((f) => (pagina === 0 ? (data || []) : [...f, ...(data || [])]));
    setTotal(count || 0);
    setCargando(false);
    const m = await fetchNombresDeProductos((data || []).map((r) => r.erp_product_id));
    if (yo === turno.current) setNombres((prev) => new Map([...prev, ...m]));
  }, [busqueda, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${total.toLocaleString('es-SV')} productos con historial${busqueda ? ' · la búsqueda acepta el código' : ''}`}</Text>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas.map((r) => (
        <View key={r.erp_product_id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18}>
            <View style={{ padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{nombres.get(String(r.erp_product_id)) ?? `Producto ${r.erp_product_id}`}</Text>
                {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(r.latest_cost)}</Text> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`cód. ${r.erp_product_id}`, `primera ${fechaNumerica(r.first_purchase_date)}`, `última ${fechaNumerica(r.last_purchase_date)}`].join(' · ')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '700' }}>{`${r.days_since_first_purchase ?? '—'} d`}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{`${r.total_receipts} recepciones`}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{`${formatQty(r.total_units_received)} u. recibidas`}</Text>
                {verMontos ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`promedio ${formatMoney(r.avg_cost)}`}</Text> : null}
              </View>
            </View>
          </Vidrio>
        </View>
      ))}
      {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!cargando && total > filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
      {!cargando && !filas.length && !error ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin productos con historial de compras</Text> : null}
    </View>
  );
}
