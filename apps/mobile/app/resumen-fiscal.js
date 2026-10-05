// Resumen fiscal, NATIVO — `ResumenFiscalView`: el movimiento de IVA del mes,
// el pago a cuenta y el anticipo por tarjeta, y cómo se llega al movimiento
// renglón por renglón. Es un indicador, no una declaración, y la pantalla lo
// dice antes de los números.
//
// Los montos los calcula el servidor; el orden y el signo de cada renglón
// salen del núcleo (`resumenFiscal`), lo mismo del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchResumenFiscal } from '@nucleo/data/resumenFiscal';
import { lineasDelResumen, tasaEnTexto } from '@nucleo/utils/resumenFiscal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import PasoDeMes from '../componentes/PasoDeMes';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion } from '../componentes/formulario/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { MARCA } from '../componentes/inicio/marca';

export default function ResumenFiscal() {
  const { getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('resumen_fiscal') === 'ALL';
  const [mes, setMes] = useState(mesSV);
  const [sala, setSala] = useState('ALL');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    const [desde, hasta] = rangoDelMes(mes);
    const { data, error: err } = await fetchResumenFiscal(desde, hasta, sala === 'ALL' ? null : sala);
    if (err) { setError(err.message); setDatos(false); }
    else if (data?.error === 'FORBIDDEN') { setError('No tienes permiso para ver el resumen fiscal.'); setDatos(false); }
    else setDatos(data);
  }, [mes, sala]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const movimiento = Number(datos?.movimiento_iva ?? 0);
  const aFavor = movimiento < 0;
  const pac = datos?.pago_a_cuenta ?? {};
  const tar = datos?.anticipo_tarjeta ?? {};
  const lineas = useMemo(() => (datos ? lineasDelResumen(datos) : []), [datos]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sucursal', activa: sala, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Toda la empresa' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Resumen fiscal', headerLargeTitle: true }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto="Es un indicador, no una declaración. No incluye el saldo a favor del mes anterior ni decide qué compras dan derecho a crédito." />
        </View>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : datos ? (
          <>
            <FilaDeKpis>
              <Kpi icono={aFavor ? 'TrendingDown' : 'TrendingUp'} rotulo="Movimiento de IVA" valor={formatMoney(Math.abs(movimiento))} color={aFavor ? MARCA.verde : MARCA.ambar} apoyo={aFavor ? 'a favor' : 'a pagar'} />
              <Kpi icono="Landmark" rotulo="Pago a cuenta" valor={formatMoney(pac.monto)} color={MARCA.azul} apoyo={`${tasaEnTexto(pac.tasa)} de las ventas`} />
            </FilaDeKpis>
            <Seccion titulo="Cómo se llega ahí">
              {lineas.map((l) => (
                <View key={l.etiqueta} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6, borderTopWidth: l.fuerte ? 0.5 : 0, borderTopColor: colorSistema.separador, marginTop: l.fuerte ? 4 : 0 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: l.fuerte ? 16 : 14, fontWeight: l.fuerte ? '800' : '500' }}>{l.etiqueta}</Text>
                    {l.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{l.detalle}</Text> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: l.fuerte ? 16 : 14, fontWeight: l.fuerte ? '800' : '600', fontVariant: ['tabular-nums'] }}>{`${l.signo}${formatMoney(Math.abs(Number(l.monto || 0)))}`}</Text>
                </View>
              ))}
            </Seccion>
            <Seccion titulo="Pago a cuenta">
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{formatMoney(pac.monto)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${tasaEnTexto(pac.tasa)} sobre ${formatMoney(pac.base)} de ventas del mes. Se paga siempre, no depende del IVA. ${pac.fundamento ?? ''}.`}</Text>
            </Seccion>
            <Seccion titulo="Anticipo por tarjeta · estimado">
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{formatMoney(tar.monto)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${tasaEnTexto(tar.tasa)} de ${formatMoney(tar.base)} cobrados con tarjeta. Lo retiene el procesador: se confirma en el estado de cuenta. ${tar.fundamento ?? ''}.`}</Text>
            </Seccion>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Las dos declaraciones se presentan dentro de los primeros diez días hábiles del mes siguiente.</Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
