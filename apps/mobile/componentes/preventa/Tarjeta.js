// Una preventa de la lista — la `Tarjeta` de `PreventaView` del portal: el
// número de caja, el cliente, quién y cuándo, cómo paga, el total y el estado;
// al tocarla, sus productos, el descuento por puntos, la factura, lo que se
// cobró distinto y los avisos, con Corregir, Repetir y Anular.
import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { PAGOS, diferenciasDelCobro, estadoDePreventa, sePuedeAnular, sePuedeCorregir } from '@nucleo/utils/preventaDirecta';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Presionable as Pressable } from '../Tocable';
import { MARCA } from '../inicio/marca';
import { Pildora } from '../avisos/Piezas';
import { colorDeVariante } from '../colorDeVariante';
import { BotonChico } from './Linea';

function Nota({ texto, color, children }) {
  return (
    <View style={{ borderRadius: 12, padding: 10, gap: 3, backgroundColor: `${color}1F` }}>
      {texto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{texto}</Text> : null}
      {children}
    </View>
  );
}

export default function Tarjeta({ p, puedeVender, onCorregir, onRepetir, onAnular }) {
  const [abierta, setAbierta] = useState(false);
  const est = estadoDePreventa(p);
  const pago = PAGOS.find((x) => x.value === p.venta?.pago)?.label;
  const detalle = [p.codigo, hora12(p.enviada_at ?? p.created_at), shortEmployeeName({ name: p.vendedor }), pago,
    p.venta?.documento === 'credito_fiscal' ? 'Crédito fiscal' : null, p.venta?.puntos > 0 ? `${p.venta.puntos} puntos` : null,
    p.corregida_veces > 0 ? `corregida ${p.corregida_veces}×` : null].filter(Boolean).join(' · ');
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta((a) => !a); }} accessibilityRole="button"
          accessibilityState={{ expanded: abierta }}
          style={({ pressed }) => ({ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ width: 64, color: p.externo_ref ? colorSistema.texto : colorDeVariante(est.tono), fontSize: p.externo_ref ? 20 : 14, fontWeight: '900', fontVariant: ['tabular-nums'] }}>
            {p.externo_ref ? `#${p.externo_ref}` : '—'}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{p.cliente ?? 'Cliente frecuente'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{detalle}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {p.total != null ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(p.total)}</Text> : null}
            <Pildora texto={est.texto} color={colorDeVariante(est.tono)} />
            {p.cobro_distinto?.alerta ? <Pildora texto="Se cobró distinto" color={MARCA.rojo} /> : null}
          </View>
        </Pressable>
        {abierta ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
            {(p.venta?.renglones ?? []).map((r) => (
              <View key={`${r.producto_id}-${r.factor}`} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 14 }} numberOfLines={2}>{r.cantidad} × {r.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{formatMoney(r.subtotal)}</Text>
              </View>
            ))}
            {p.venta?.descuento_puntos > 0 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: MARCA.verde, fontSize: 14 }}>Descuento por puntos ({p.venta.puntos})</Text>
                <Text style={{ color: MARCA.verde, fontSize: 14, fontVariant: ['tabular-nums'] }}>−{formatMoney(p.venta.descuento_puntos)}</Text>
              </View>
            ) : null}
            {p.factura ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Factura {p.factura}</Text> : null}
            {p.cobro_distinto ? (
              <Nota color={p.cobro_distinto.alerta ? MARCA.rojo : MARCA.azulInfo}
                texto={`Se prometió ${formatMoney(p.cobro_distinto.total_prometido)} y se facturó ${formatMoney(p.cobro_distinto.total_cobrado)}.`}>
                {diferenciasDelCobro(p.cobro_distinto).map((d) => (
                  <Text key={d.nombre} style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    <Text style={{ fontWeight: '700', color: colorSistema.texto }}>{d.nombre}</Text>: {d.texto}
                  </Text>
                ))}
              </Nota>
            ) : null}
            {p.error ? <Nota color={p.estado === 'viva' ? MARCA.ambar : MARCA.rojo} texto={p.error} /> : null}
            {(p.avisos ?? []).map((a) => <Nota key={a} color={MARCA.ambar} texto={a} />)}
            {puedeVender ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {sePuedeCorregir(p) ? <BotonChico texto="Corregir" onPress={onCorregir} /> : null}
                <BotonChico texto="Repetir venta" onPress={onRepetir} color={colorSistema.texto2} />
                {sePuedeAnular(p) ? <BotonChico texto="Anular" onPress={onAnular} color={MARCA.rojo} /> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Vidrio>
    </View>
  );
}
