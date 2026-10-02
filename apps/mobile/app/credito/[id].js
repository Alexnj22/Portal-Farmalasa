// La ficha de un crédito, NATIVA — la `FichaDelCredito` del portal: cuánto
// debe y cuánto lleva pagado, cuándo compró, quién vendió, lo que se llevó y
// sus abonos. Los abonos se leen del sistema de la caja (es donde están TODOS,
// también los cobrados allá) y se casan con los del portal, que sabe quién
// cobró (`abonosDelCredito`, del núcleo). Sólo lectura: el historial de la caja
// se PIDE, no se escribe.
//
// «Recibir un pago» abre el cobro nativo (`cobrar-credito`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchCreditoDetalle, fetchHistorialDelOrigen } from '@nucleo/data/creditos';
import { abonosDelCredito, pagadoPct, tituloDeDias } from '@nucleo/utils/cartera';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeEdad } from '../../componentes/creditos/edad';

const fecha = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function Credito() {
  const p = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const puedeAbonar = hasPermission('cuentas_por_cobrar', 'can_edit');
  const [datos, setDatos] = useState(undefined);
  const [delOrigen, setDelOrigen] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [d, h] = await Promise.all([
      fetchCreditoDetalle(p.id),
      fetchHistorialDelOrigen({ sala: Number(p.sala), credito: p.credito }),
    ]);
    setDatos(d?.error ? null : d);
    setDelOrigen(h?.error || !h?.ok ? null : (h.abonos || []));
  }, [p.id, p.sala, p.credito]);
  useEffect(() => { cargar(); }, [cargar]);

  const c = datos?.credito;
  const compra = datos?.compra || [];
  const abonos = useMemo(() => abonosDelCredito(delOrigen, datos?.abonos || []), [delOrigen, datos]);
  const saldo = Number(c?.saldo ?? p.saldo) || 0;
  const total = Number(c?.total ?? p.total) || 0;
  const dias = p.dias === '' ? null : Number(p.dias);
  const vendedor = c?.vendedor_id ? porId.get(String(c.vendedor_id)) : null;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Crédito' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Vidrio radio={24}>
          <View style={{ padding: 18, gap: 8 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{p.cliente}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[c?.sala, p.documento].filter(Boolean).join(' · ')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <Text style={{ color: saldo > 0.004 ? colorSistema.texto : MARCA.verde, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(saldo)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{saldo > 0.004 ? 'debe' : 'pagado'}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
              <View style={{ width: `${pagadoPct({ saldo, total })}%`, height: 6, backgroundColor: MARCA.verde }} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatMoney(Math.max(0, total - saldo))} pagados de ${formatMoney(total)}`}</Text>
            {saldo > 0.004 && dias != null ? (
              <View style={{ flexDirection: 'row' }}>
                <Pildora texto={`${dias} día${dias === 1 ? '' : 's'} · ${tituloDeDias(dias, saldo)}`} color={colorDeEdad(dias, saldo)} />
              </View>
            ) : null}
          </View>
        </Vidrio>

        {datos === null ? <Aviso tono="freno" texto="No se pudo abrir la ficha." /> : null}
        {c ? (
          <Seccion titulo="El crédito">
            <Dato primero rotulo="Compró el" valor={fecha(c.fecha)} />
            <Dato rotulo="Último abono" valor={c.ultimo_abono_el ? fecha(c.ultimo_abono_el) : 'ninguno desde el portal'} />
            <Dato rotulo="Documento" valor={`${c.tipo_doc || ''} ${p.documento || ''}`.trim()} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>Vendió</Text>
              {c.vendedor ? <Avatar empleado={vendedor ?? { name: c.vendedor }} tamano={24} /> : null}
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '500' }}>{vendedor ? shortEmployeeName(vendedor) : (c.vendedor || 'sin registrar')}</Text>
            </View>
          </Seccion>
        ) : null}

        {datos ? (
          <Seccion titulo={`Lo que se llevó${compra.length ? ` · ${compra.length}` : ''}`}>
            {compra.length ? compra.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{r.descripcion}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${Number(r.cantidad)} × ${formatMoney(r.precio_unitario)}${r.presentacion ? ` · ${r.presentacion}` : ''}`}</Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(r.total_linea)}</Text>
              </View>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No se encontraron los productos de esta compra.</Text>}
          </Seccion>
        ) : null}

        {datos ? (
          <Seccion titulo={`Abonos${abonos.length ? ` · ${abonos.length}` : ''}`}>
            {abonos.length ? abonos.map((a, i) => (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                {a.abonado_por ? <Avatar empleado={porId.get(String(a.abonado_por)) ?? { name: a.cobrado_por }} tamano={28} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(a.monto)}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {[`${fecha(a.fecha)}${a.hora ? `, ${hora12(a.hora) || a.hora}` : ''}`, a.cobrado_por || 'cobrado en la caja', a.forma].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {a.saldo_despues != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`quedó ${formatMoney(a.saldo_despues)}`}</Text> : null}
              </View>
            )) : (
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                {delOrigen ? 'Todavía no se le ha abonado nada.' : 'No se pudo leer el historial de la caja.'}
              </Text>
            )}
          </Seccion>
        ) : null}

        {puedeAbonar && saldo > 0.004 ? (
          p.enAprobacion ? <Aviso tono="cuidado" texto="Ya tiene un cobro esperando aprobación." />
            : <BotonGrande texto="Recibir un pago" color={MARCA.verde}
                onPress={() => router.push({ pathname: '/cobrar-credito', params: {
                  id: p.id, sala: p.sala, credito: p.credito, documento: p.documento, cliente: p.cliente, dias: p.dias,
                  saldo: String(saldo), total: String(total), fecha: c?.fecha ?? p.fecha ?? '',
                } })} />
        ) : null}
      </ScrollView>
    </>
  );
}
