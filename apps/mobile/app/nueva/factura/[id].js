// Nueva solicitud de facturación — paso 2: la factura elegida, con sus
// productos, y qué se quiere pedir. Las mismas cuatro opciones del portal:
//
//   · Anular             — sólo si la sala tiene una CAJA ABIERTA ahora
//                          (`salaConCajaAbierta`, la misma función que el
//                          trigger y la Edge Function). Con duda, no se ofrece.
//   · Forma de pago, vendedor, cliente.
//
// Una factura anulada (`esAnulada`: NULA o invalidada en Hacienda) no se toca.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchInvoiceItemsForInvoice } from '@nucleo/data/facturacion';
import { salaConCajaAbierta } from '@nucleo/data/cortes';
import { esAnulada, estadoDeLaCaja, MOTIVO_SIN_ANULAR, ROTULO_PAGO } from '@nucleo/utils/solicitudFacturacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { Aviso, Dato, Seccion } from '../../../componentes/formulario/Piezas';
import { facturaElegida } from '../../../componentes/formulario/facturaElegida';
import { Chip } from '../../../componentes/inicio/Widget';
import Vidrio from '../../../componentes/Vidrio';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { MARCA } from '../../../componentes/inicio/marca';

function Opcion({ icono, color, titulo, detalle, deshabilitada, onPress }) {
  return (
    <Pressable disabled={deshabilitada} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: deshabilitada ? 0.45 : 1 })}>
      <Vidrio radio={18} interactivo={!deshabilitada}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
          <Chip icono={icono} color={color} tamano={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{titulo}</Text>
            {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle}</Text> : null}
          </View>
          {!deshabilitada ? <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Factura() {
  const { id } = useLocalSearchParams();
  const inv = facturaElegida(id);
  const empleados = useStaffStore((s) => s.employees);
  const [items, setItems] = useState(null);
  const [caja, setCaja] = useState('cargando');

  useEffect(() => {
    if (!inv) return;
    fetchInvoiceItemsForInvoice(inv.id).then(({ data }) => setItems(data || []));
    salaConCajaAbierta(inv._sala?.id ?? inv.branch_id).then(setCaja);
  }, [inv]);

  const vendedor = useMemo(() => (empleados || []).find((e) => String(e.code) === String(inv?.cod_vendedor)), [empleados, inv]);

  if (!inv) {
    return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Factura' }} /><Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 140 }}>Vuelve a elegir la factura.</Text></>;
  }
  const anulada = esAnulada(inv);
  const estadoCaja = estadoDeLaCaja(caja);
  const ir = (accion) => router.push({ pathname: '/nueva/cambio', params: { id: String(inv.id), accion } });

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: inv.correlativo }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Seccion>
          <Dato primero rotulo="Total" valor={formatMoney(inv.total)} fuerte />
          <Dato rotulo="Documento" valor={inv.tipo_documento} />
          <Dato rotulo="Fecha" valor={fechaTexto(String(inv.fecha).slice(0, 10))} />
          <Dato rotulo="Cliente" valor={inv.cliente || 'Consumidor final'} />
          <Dato rotulo="Forma de pago" valor={ROTULO_PAGO[String(inv.tipo_pago || '').toLowerCase()] ?? inv.tipo_pago} />
          <Dato rotulo="Vendedor" valor={vendedor ? shortEmployeeName(vendedor) : (inv.cod_vendedor ? `#${inv.cod_vendedor}` : '—')} />
        </Seccion>

        <Seccion titulo="Productos">
          {items === null ? <Text style={{ color: colorSistema.texto2 }}>Cargando…</Text> : items.length ? items.map((it, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{it.cantidad} × {it.descripcion}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{formatMoney(it.total_linea)}</Text>
            </View>
          )) : <Text style={{ color: colorSistema.texto2 }}>Sin detalle.</Text>}
        </Seccion>

        {anulada ? <Aviso tono="freno" texto="Esta factura ya está anulada: no se le puede pedir ningún cambio." /> : (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>¿Qué necesitas?</Text>
            <Opcion icono="Ban" color={MARCA.rojo} titulo="Anular la factura" deshabilitada={estadoCaja !== 'abierta'}
              detalle={estadoCaja !== 'abierta' ? MOTIVO_SIN_ANULAR[estadoCaja] : 'Devuelve la venta; lo aprueba Supervisión'} onPress={() => ir('anular')} />
            <Opcion icono="CreditCard" color={MARCA.azulClaro} titulo="Cambiar la forma de pago"
              detalle={`Actual: ${ROTULO_PAGO[String(inv.tipo_pago || '').toLowerCase()] || inv.tipo_pago || '—'}`} onPress={() => ir('pago')} />
            <Opcion icono="UserCog" color={MARCA.violeta} titulo="Cambiar el vendedor"
              detalle={vendedor ? `Actual: ${shortEmployeeName(vendedor)}` : `Vendedor: #${inv.cod_vendedor || '—'}`} onPress={() => ir('vendedor')} />
            <Opcion icono="Contact" color={MARCA.verde} titulo="Cambiar el cliente"
              detalle={`Actual: ${inv.cliente || 'Sin nombre'}`} onPress={() => ir('cliente')} />
          </View>
        )}
      </ScrollView>
    </>
  );
}
