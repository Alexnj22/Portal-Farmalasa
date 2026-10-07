// Lo vendido como INFORMACIÓN y no como papel —la `VistaDetalle` del documento
// en el portal (pedido del usuario, 2026-09-30: «¿dónde puedo ver lo que vendí?
// no en ticket ni PDF»)—: el cliente, los productos con su lote, cómo se pagó y
// los totales. Se lee del MISMO JSON firmado (`leerDocumento`).
import { Text, View } from 'react-native';
import { leerDocumento } from '@nucleo/utils/distribucionDocumento';
import { nombreFormaPago } from '@nucleo/utils/distribucionFacturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../../Formulario';
import { Dato, Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';

export default function DetalleDeVenta({ dte, pagos }) {
  const d = leerDocumento(dte);
  const r = d.resumen;
  return (
    <>
      <Seccion titulo="La venta">
        <Dato primero rotulo="Cliente" valor={d.receptor.nombre} />
        <Dato rotulo="Documento" valor={d.receptor.documento || '—'} />
        <Dato rotulo="Fecha" valor={`${d.fecha} · ${d.hora}`} />
        <Dato rotulo="Condición" valor={d.condicion ?? 'Contado'} />
      </Seccion>

      <Seccion titulo={`${d.renglones.length} producto${d.renglones.length === 1 ? '' : 's'}`}>
        {d.renglones.map((x, i) => (
          <View key={x.n} style={{ flexDirection: 'row', gap: 12, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <Text style={{ width: 34, textAlign: 'right', color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{x.cantidad}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{x.descripcion}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[x.unidad, x.lote && `Lote ${x.lote}`, x.vence && `vence ${x.vence}`, `${formatMoney(x.precio)} c/u`, x.descuento > 0 && `descuento ${formatMoney(x.descuento)}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(x.gravada + x.exenta + x.noSujeta)}</Text>
          </View>
        ))}
      </Seccion>

      <Seccion titulo="Pago">
        {pagos == null ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Cargando…</Text> : null}
        {pagos?.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin pagos registrados.</Text> : null}
        {(pagos ?? []).map((p, i) => {
          const recibido = p.forma === '01' && p.efectivo_recibido != null ? Number(p.efectivo_recibido) : null;
          return (
            <View key={p.id} style={{ gap: 6 }}>
              <Dato primero={i === 0} rotulo={nombreFormaPago(p.forma)} valor={formatMoney(p.monto)} />
              {recibido != null && recibido > Number(p.monto) ? (
                <>
                  <Dato rotulo="Recibido" valor={formatMoney(recibido)} />
                  <Dato rotulo="Cambio" valor={formatMoney(recibido - Number(p.monto))} />
                </>
              ) : null}
              {p.referencia ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Ref. ${p.referencia}`}</Text> : null}
            </View>
          );
        })}
      </Seccion>

      <Seccion titulo="Totales">
        {!r.ivaIncluido ? <Dato primero rotulo="Sumas (sin IVA)" valor={formatMoney(r.subTotal)} /> : null}
        {r.descuento > 0 ? <Dato primero={r.ivaIncluido} rotulo="Descuentos (ya aplicados)" valor={formatMoney(r.descuento)} /> : null}
        {!r.ivaIncluido ? <Dato rotulo="IVA 13%" valor={formatMoney(r.iva)} /> : null}
        {r.percepcion > 0 ? <Dato rotulo="(+) IVA percibido" valor={formatMoney(r.percepcion)} /> : null}
        {r.retencion > 0 ? <Dato rotulo="(−) IVA retenido" valor={`−${formatMoney(r.retencion)}`} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800' }}>Total</Text>
          <Text style={{ color: MARCA.verde, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(r.total)}</Text>
        </View>
        {r.ivaIncluido ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'right' }}>{`IVA incluido: ${formatMoney(r.iva)}`}</Text> : null}
      </Seccion>
    </>
  );
}
