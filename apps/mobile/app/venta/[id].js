// Una venta, NATIVA — lo que el portal muestra al expandir una fila de Ventas:
// el encabezado (cliente, cuándo, dónde, quién, cómo se pagó y si Hacienda la
// selló) y sus productos con cantidad, precio, lote y vencimiento. El
// descuento por puntos y los renglones repetidos salen del núcleo
// (`renglonesDeLaVenta`), igual que en el portal; en un crédito fiscal se
// desglosa el IVA y la retención.
//
// Como la fila del portal: el TIPO DE PRECIO cobrado en cada renglón (VIP,
// Clínica, Mayoreo, Premium, P7, Viñeta, Especial…; núcleo: `tierDelRenglon`)
// y los «Cambios registrados» de la factura (forma de pago, sello de
// Hacienda) con el valor anterior y el nuevo.
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchCualesVanBajoReceta, fetchInvoiceById, fetchInvoiceChangelog, fetchInvoiceItemsForInvoice, fetchProductPreciosActivos } from '@nucleo/data/ventas';
import { tieneSelloMh } from '@nucleo/data/facturacion';
import { ROTULO_PUNTOS } from '@nucleo/data/puntos';
import { CAMPO_LABELS, RELEVANT_CAMPOS, fmtCampoVal, renglonesDeLaVenta, tierDelRenglon } from '@nucleo/utils/ventasPeriodo';
import { ESTADOS_ANULADA, ROTULO_PAGO } from '@nucleo/utils/solicitudFacturacion';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';

const cantidad = (n) => { const f = parseFloat(n || 0); return f % 1 === 0 ? String(f) : f.toFixed(3).replace(/\.?0+$/, ''); };

export default function Venta() {
  const { id } = useLocalSearchParams();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const [v, setV] = useState(undefined);
  const [items, setItems] = useState(null);
  const [receta, setReceta] = useState(new Set());
  const [precios, setPrecios] = useState(null);   // product_id → filas de precio
  const [cambios, setCambios] = useState([]);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: inv }, { data: renglones }, { data: log }] = await Promise.all([
      fetchInvoiceById(Number(id)), fetchInvoiceItemsForInvoice(Number(id)), Promise.resolve(fetchInvoiceChangelog([Number(id)])).catch(() => ({ data: [] })),
    ]).catch(() => [{ data: null }, { data: null }, { data: [] }]);
    setV(inv ?? null);
    setItems(renglones ?? []);
    setCambios((log || []).filter((c) => RELEVANT_CAMPOS.has(c.campo)));
    const ids = [...new Set((renglones || []).map((it) => it.erp_product_id).filter((x) => x && x > 0))];
    if (ids.length) {
      // Sin respuesta, sin etiqueta: ninguna de las dos frena la pantalla.
      const [{ data }, { data: filasPrecio }] = await Promise.all([
        fetchCualesVanBajoReceta(ids), Promise.resolve(fetchProductPreciosActivos(ids)).catch(() => ({ data: [] })),
      ]);
      setReceta(new Set((data || []).map((p) => p.id)));
      const porProducto = new Map();
      for (const p of filasPrecio || []) { if (!porProducto.has(p.product_id)) porProducto.set(p.product_id, []); porProducto.get(p.product_id).push(p); }
      setPrecios(porProducto);
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (v === null) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Venta' }} />
        <View style={{ padding: 16 }}><Aviso tono="freno" texto="No se encontró esta venta." /></View>
      </>
    );
  }

  const anulada = v && ESTADOS_ANULADA.includes(v.estado);
  const sala = v ? (sucursales || []).find((b) => Number(b.id) === Number(v.branch_id))?.name : null;
  const emp = v ? (empleados || []).find((e) => e.code === v.cod_vendedor) : null;
  const { productos, descuento } = renglonesDeLaVenta(items, v?.total);
  const puntos = ROTULO_PUNTOS[v?.puntos_enviados?.estado_puntos ?? v?.puntos_enviados?.[0]?.estado_puntos];
  const fiscal = v && (v.tipo_documento === 'CCF' || v.tipo_documento === 'COF') && v.subtotal != null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: v?.tipo_documento ? `${v.tipo_documento} ${v.correlativo ?? ''}`.trim() : 'Venta' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {v ? (
          <>
            <Vidrio radio={24}>
              <View style={{ padding: 18, gap: 8 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{v.cliente || 'Consumidor final'}</Text>
                <Text style={{ color: anulada ? colorSistema.texto2 : MARCA.verde, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'],
                  textDecorationLine: anulada ? 'line-through' : 'none' }}>{formatMoney(v.total)}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {anulada ? <Pildora texto="Anulada" color={MARCA.rojo} /> : null}
                  {tieneSelloMh(v.recibido_mh) ? <Pildora texto="Sellada por Hacienda" color={MARCA.verde} /> : <Pildora texto="Sin sello de Hacienda" color={MARCA.ambar} />}
                  {puntos ? <Pildora texto={`Puntos ${puntos.label.toLowerCase()}`} color={MARCA.ambar} /> : null}
                </View>
              </View>
            </Vidrio>
            <Seccion titulo="La venta">
              <Dato primero rotulo="Cuándo" valor={`${fechaTexto(v.fecha, { day: 'numeric', month: 'long', year: 'numeric' })} · ${hora12(v.hora)}`} />
              <Dato rotulo="Sala" valor={sala} />
              <Dato rotulo="Vendedor" valor={emp ? shortEmployeeName(emp) : v.cod_vendedor} />
              <Dato rotulo="Forma de pago" valor={ROTULO_PAGO[v.tipo_pago] ?? v.tipo_pago} />
              <Dato rotulo="Documento" valor={[v.tipo_documento, v.correlativo].filter(Boolean).join(' ')} />
            </Seccion>
          </>
        ) : null}
        {items ? (
          <Seccion titulo={`Productos · ${productos.length}`}>
            {productos.length ? productos.map((it, i) => { const tier = precios ? tierDelRenglon(it.precio_unitario, precios.get(it.erp_product_id)) : null; return (
              <View key={i} style={{ gap: 5, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{it.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(it.total_linea)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${cantidad(it.cantidad)} × ${formatMoney(it.precio_unitario)}`}</Text>
                  {tier ? <Pildora texto={`Precio ${tier.label}${tier.num != null ? ` ${tier.num}` : ''}`} color={tier.key === 'especial' ? MARCA.violeta : tier.key === 'vineta' ? colorSistema.texto2 : MARCA.ambar} /> : null}
                </View>
                {receta.has(it.erp_product_id) || it.presentacion || it.lote || it.fecha_vencimiento ? (
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {receta.has(it.erp_product_id) ? <Pildora texto="Bajo Receta" color={MARCA.violeta} /> : null}
                    {it.presentacion ? <Pildora texto={it.presentacion} color={colorSistema.texto2} /> : null}
                    {it.lote ? <Pildora texto={`Lote ${it.lote}`} color={MARCA.azulClaro} /> : null}
                    {it.fecha_vencimiento ? <Pildora texto={`Vence ${fechaTexto(it.fecha_vencimiento, { day: 'numeric', month: 'short', year: '2-digit' })}`} color={colorSistema.texto2} /> : null}
                  </View>
                ) : null}
              </View>
            ); }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Esta sala todavía no tiene el detalle de productos.</Text>}
            {descuento > 0 ? (
              <View style={{ flexDirection: 'row', paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: MARCA.ambar, fontSize: 15, fontWeight: '700' }}>Descuento por puntos</Text>
                <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`−${formatMoney(descuento)}`}</Text>
              </View>
            ) : null}
          </Seccion>
        ) : null}
        {cambios.length ? (
          <Seccion titulo="Cambios registrados">
            {cambios.map((c, i) => (
              <View key={i} style={{ gap: 2, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{CAMPO_LABELS[c.campo] ?? c.campo}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                  <Text style={{ color: colorSistema.texto2, textDecorationLine: 'line-through' }}>{fmtCampoVal(c.campo, c.valor_anterior)}</Text>
                  {` → ${fmtCampoVal(c.campo, c.valor_nuevo)}`}
                </Text>
              </View>
            ))}
          </Seccion>
        ) : null}
        {fiscal ? (
          <Seccion titulo="Totales">
            <Dato primero rotulo="Subtotal (sin IVA)" valor={formatMoney(v.subtotal)} />
            <Dato rotulo="IVA (13%)" valor={formatMoney(v.iva)} />
            {Number(v.retencion) > 0 ? <Dato rotulo="Retención de IVA" valor={`−${formatMoney(v.retencion)}`} /> : null}
            <Dato rotulo="Total" valor={formatMoney(v.total)} fuerte />
          </Seccion>
        ) : null}
      </ScrollView>
    </>
  );
}
