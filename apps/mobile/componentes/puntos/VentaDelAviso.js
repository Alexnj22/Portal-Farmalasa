// La venta de un aviso de puntos, NATIVA — `VentaDelAviso.jsx` del portal: al
// abrir un aviso, arriba de la cuenta del cliente va la venta que lo originó
// (documento, fecha, sala, total), QUIÉN vendió (foto + nombre corto) y sus
// productos. Los datos de la cabecera viajan con el aviso
// (`puntos_panel_avisos`); los productos se piden con el MISMO lector que usa
// Ventas (`fetchInvoiceItemsForInvoice`).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchInvoiceItemsForInvoice } from '@nucleo/data/ventas';
import { avisoDePuntos } from '@nucleo/utils/puntosTexto';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { Grilla, Pildora } from '../avisos/Piezas';
import Avatar from '../Avatar';
import { MARCA } from '../inicio/marca';

const COLOR = { danger: MARCA.rojo, warning: MARCA.ambar, info: MARCA.azulClaro };

export default function VentaDelAviso({ aviso }) {
  const [items, setItems] = useState(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    if (!aviso?.invoice_id) { setItems([]); return undefined; }
    let vivo = true;
    (async () => {
      const { data, error } = await fetchInvoiceItemsForInvoice(aviso.invoice_id);
      if (!vivo) return;
      if (error) setFallo(true);
      setItems(data ?? []);
    })();
    return () => { vivo = false; };
  }, [aviso?.invoice_id]);
  if (!aviso) return null;

  const x = avisoDePuntos(aviso);
  // En estos dos la anulación ES el aviso; los demás ya no llegan anulados.
  const anuladaSinAviso = aviso.venta_vigente === false && !['anulada_con_puntos_gastados', 'canje_devuelto'].includes(aviso.tipo);
  // El renglón -999 es el descuento: no es un producto.
  const productos = (items ?? []).filter((it) => it.erp_product_id !== -999 && it.descripcion);
  const vendedor = aviso.vendedor ? { id: aviso.vendedor_id, name: aviso.vendedor } : null;
  const cuando = [fechaTexto(aviso.venta_fecha, { day: 'numeric', month: 'short', year: 'numeric' }, ''), aviso.venta_hora ? hora12(aviso.venta_hora) : ''].filter(Boolean).join(' · ');

  return (
    <Seccion titulo="La venta del aviso">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pildora texto={x.rotulo} color={COLOR[x.severidad] ?? MARCA.ambar} />
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.puntos(aviso)}</Text>
        {anuladaSinAviso ? <Pildora texto="Anulada después" color={MARCA.azulClaro} /> : null}
      </View>
      {aviso.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{aviso.nota}</Text> : null}
      {anuladaSinAviso ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`Esta venta se anuló después del canje (${aviso.venta_estado}). Si la sala la rehízo, la venta nueva aparece en los movimientos del cliente.`}
        </Text>
      ) : null}
      <Grilla celdas={[
        { rotulo: 'Documento', valor: aviso.documento || '—' },
        { rotulo: 'Fecha', valor: cuando || '—' },
        { rotulo: 'Sala', valor: aviso.sala || '—' },
        { rotulo: 'Total cobrado', valor: aviso.venta_total != null ? formatMoney(aviso.venta_total) : '—' },
      ]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Vendió</Text>
        {vendedor ? (
          <>
            <Avatar empleado={vendedor} tamano={22} />
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName(vendedor)}</Text>
          </>
        ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin vendedor en la factura</Text>}
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>Productos</Text>
      {items == null ? <ActivityIndicator />
        : fallo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>No se pudieron cargar los productos.</Text>
          : !productos.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Esta venta no tiene el detalle de productos.</Text>
            : productos.map((it, i) => (
              <View key={`${it.erp_product_id}-${i}`} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{it.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                    {`${formatQty(it.cantidad)} × ${formatMoney(it.precio_unitario)}${it.presentacion ? ` · ${it.presentacion}` : ''}`}
                  </Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(it.total_linea)}</Text>
              </View>
            ))}
    </Seccion>
  );
}
