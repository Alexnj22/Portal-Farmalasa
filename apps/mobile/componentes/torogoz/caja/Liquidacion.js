// La liquidación diaria del vendedor —el `TabLiquidacion` del portal (borrador
// 0020)—: lo que vendió, lo que cobró, lo que le devolvieron y el efectivo que
// tiene que entregar, más su caja del día y el camión (0031).
//
// Un vendedor ve la suya. Quien administra ve a todos los que tuvieron
// movimiento ese día, cuenta el efectivo y cierra: una diferencia exige
// motivo. La cuenta del cierre sale del núcleo (`cuentaDelCierre`), la misma
// que usa el portal.
//
// ⚠ «Cerrar liquidación» y «Reabrir» mueven la caja DE VERDAD; en el entorno de
// pruebas no se hacen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  cerrarLiquidacion, fetchCamionDelDia, fetchLiquidacion, fetchLiquidacionesDelDia, fetchVendedores, mensajeDeDistribucion, reabrirLiquidacion,
} from '@nucleo/data/distribucion';
import {
  cuentaDelCierre, formasDeLaLiquidacion, resumenDelCamion, rotuloDiferencia, vendedoresParaElegir,
} from '@nucleo/utils/distribucionCaja';
import { TIPO_DOCUMENTO } from '@nucleo/utils/distribucionComun';
import { nombreFormaPago } from '@nucleo/utils/distribucionFacturacion';
import { ticketDeLiquidacion } from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from '@nucleo/utils/distribucionMarca';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../formulario/Piezas';
import Avatar from '../../Avatar';
import Vidrio from '../../Vidrio';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { MARCA } from '../../inicio/marca';
import { fallo, listo, trabajando } from '../../Progreso';
import { compartirTicket, elegir, imprimirTicket } from '../fiscal/papel';
import CajaDelVendedor from './CajaDelVendedor';
import DiaElegido from './DiaElegido';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

const PETROLEO = '#0f6e7d';
const soloMonto = (v) => v.replace(',', '.').replace(/[^0-9.]/g, '');

export default function Liquidacion({ fecha, onFecha, vendedor, onVendedor, puedeConfigurar, emisor, recarga = 0 }) {
  const { user } = useAuth();
  const vendedorId = puedeConfigurar ? (vendedor || null) : (user?.id ?? null);
  const [delDia, setDelDia] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [liq, setLiq] = useState(undefined);
  const [camion, setCamion] = useState([]);
  const [error, setError] = useState(null);
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [lista, todos] = puedeConfigurar ? await Promise.all([fetchLiquidacionesDelDia(fecha), fetchVendedores()]) : [[], []];
      setDelDia(lista); setVendedores(todos);
      const quien = vendedorId ?? lista[0]?.id ?? null;
      const [l, cam] = quien
        ? await Promise.all([fetchLiquidacion(quien, fecha), fetchCamionDelDia(quien, fecha).catch(() => [])])
        : [null, []];
      setLiq(l); setCamion(cam); setError(null);
    } catch (e) {
      setLiq(null); setError(mensajeDeDistribucion(e));
    }
  }, [fecha, vendedorId, puedeConfigurar]);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  useEffect(() => { setContado(''); setNota(''); setReabriendo(false); }, [fecha, vendedorId]);

  const esperado = Number(liq?.efectivo?.esperado ?? 0);
  const cuenta = cuentaDelCierre(esperado, contado, nota);
  const formas = useMemo(() => formasDeLaLiquidacion(liq), [liq]);
  const cam = camion.length ? resumenDelCamion(camion) : null;
  const c = liq?.cierre;
  const elegido = vendedorId ?? delDia[0]?.id;
  const opciones = vendedoresParaElegir(delDia, vendedores);

  const anotar = (accion, id, detalle) => useStaffStore.getState().appendAuditLog?.(accion, id, { ...detalle, via: 'app' });
  const cerrar = () => Alert.alert('¿Cerrar la liquidación?',
    `${shortEmployeeName(liq.vendedor)} · contado ${formatMoney(cuenta.contado)} de ${formatMoney(esperado)}. ${cuenta.diferencia === 0 ? 'Cuadra.' : rotuloDiferencia(cuenta.diferencia, formatMoney) + '.'}`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Cerrar', onPress: async () => {
        setOcupado(true); trabajando('Cerrando la liquidación…');
        try {
          const r = await cerrarLiquidacion(liq.vendedor.id, fecha, cuenta.contado, nota.trim());
          anotar('DISTRIBUCION_LIQUIDACION_CERRADA', String(r?.id ?? ''), { vendedor: liq.vendedor.id, fecha, esperado: r?.esperado, contado: r?.contado, diferencia: r?.diferencia });
          if (Number(r?.diferencia) === 0) listo('Liquidación cerrada', 'Sin diferencia.');
          else fallo('Liquidación cerrada', `${rotuloDiferencia(r?.diferencia, formatMoney)}.`);
          await cargar();
        } catch (e) { fallo('No se pudo cerrar', mensajeDeDistribucion(e)); }
        finally { setOcupado(false); }
      } },
    ]);
  const reabrir = () => Alert.alert('¿Reabrir la liquidación?', 'Se vuelve a contar el efectivo.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Reabrir', onPress: async () => {
      setOcupado(true); trabajando('Reabriendo…');
      try {
        await reabrirLiquidacion(c.id, motivo.trim());
        anotar('DISTRIBUCION_LIQUIDACION_REABIERTA', String(c.id), { motivo: motivo.trim() });
        listo('Liquidación reabierta', '');
        setReabriendo(false); setMotivo('');
        await cargar();
      } catch (e) { fallo('No se pudo reabrir', mensajeDeDistribucion(e)); }
      finally { setOcupado(false); }
    } },
  ]);
  const papel = () => {
    const t = ticketDeLiquidacion(liq, MARCA_PAPEL, emisor ?? {});
    elegir('Liquidación', [
      { texto: 'Imprimir', accion: () => imprimirTicket(t).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
      { texto: 'Compartir', accion: () => compartirTicket(t, `Liquidación ${shortEmployeeName(liq.vendedor)} ${fecha}`).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
    ]);
  };

  return (
    <View style={{ gap: 14 }}>
      <DiaElegido fecha={fecha} onCambiar={onFecha} />

      {puedeConfigurar && opciones.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {opciones.map((v) => {
            const activo = String(elegido) === String(v.id);
            const delDiaV = delDia.find((x) => String(x.id) === String(v.id));
            return (
              <Pressable key={v.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onVendedor(v.id); }} accessibilityRole="button" accessibilityState={{ selected: activo }}>
                <Vidrio radio={18} interactivo tinte={activo ? `${PETROLEO}55` : undefined}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44 }}>
                    <Avatar empleado={v} tamano={28} />
                    <View>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{shortEmployeeName(v)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                        {delDiaV ? (delDiaV.cierre_id ? (Number(delDiaV.diferencia) === 0 ? 'Cerrada' : `Cerrada ${formatMoney(Number(delDiaV.diferencia))}`) : `Por cerrar · ${formatMoney(Number(delDiaV.esperado))}`) : 'Sin movimiento'}
                      </Text>
                    </View>
                  </View>
                </Vidrio>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {liq === undefined ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
      {liq === null && !error ? (
        <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto={puedeConfigurar ? 'Nadie vendió ni cobró este día.' : 'Este día no vendiste ni cobraste.'} /></View>
      ) : null}

      {liq ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Receipt" rotulo="Vendido" valor={formatMoney(Number(liq.ventas.total), { decimales: 0 })} color={PETROLEO}
              apoyo={`${Number(liq.ventas.documentos)} documentos · ${formatMoney(Number(liq.credito), { decimales: 0 })} a crédito`} />
            <Kpi icono="HandCoins" rotulo="Cobrado de cartera" valor={formatMoney(Number(liq.cobros.total), { decimales: 0 })} color={MARCA.verde}
              apoyo={`${liq.cobros.lista.length} cobros`} />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="ArrowLeftRight" rotulo="Devuelto" valor={formatMoney(Number(liq.devoluciones.total), { decimales: 0 })} color={MARCA.ambar}
              apoyo={Number(liq.devoluciones.a_favor) > 0 ? `${formatMoney(Number(liq.devoluciones.a_favor))} a favor` : 'Notas de crédito'} />
            <Kpi icono="Wallet" rotulo="Efectivo a entregar" valor={formatMoney(esperado)} color={MARCA.violeta}
              apoyo={Number(liq.efectivo.fondo) > 0 ? `Incluye ${formatMoney(Number(liq.efectivo.fondo))} de fondo` : `${formatMoney(Number(liq.efectivo.ventas), { decimales: 0 })} ventas + ${formatMoney(Number(liq.efectivo.cobros), { decimales: 0 })} cobros`} />
          </FilaDeKpis>

          <View style={{ marginHorizontal: 16, gap: 16 }}>
            <CajaDelVendedor liq={liq} fecha={fecha} esHoy={fecha === hoySV()} puedeAdministrar={!!liq.puede_cerrar && ACCIONES_DE_DINERO} onCambio={cargar} />

            {cam ? (
              <Seccion titulo="Camión" pie={`${cam.notas}${cam.abierta ? ' · todavía no se descarga' : ''}`}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }}>
                  {cam.filas.map(([rot, n]) => (
                    <View key={rot} style={{ width: '50%' }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{rot}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{String(n)}</Text>
                    </View>
                  ))}
                </View>
                {cam.faltante > 0 ? <Aviso tono="cuidado" texto={`Faltaron ${cam.faltante} unidades del camión (${formatMoney(cam.costo)} al costo)${cam.notaDeCierre ? `: ${cam.notaDeCierre}` : ''}.`} /> : null}
              </Seccion>
            ) : null}

            {Number(liq.devoluciones.a_favor) > 0 ? (
              <Aviso tono="nota" texto={`Hay ${formatMoney(Number(liq.devoluciones.a_favor))} de devoluciones a favor de clientes. No se restan del efectivo: si el vendedor se lo devolvió en la ruta, anótalo como motivo de la diferencia.`} />
            ) : null}

            <Seccion titulo="Por forma de pago">
              {formas.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin pagos este día.</Text> : null}
              {formas.map((f, i) => (
                <View key={f.forma} style={{ gap: 2, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{nombreFormaPago(f.forma)}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.ventas + f.cobros)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {[f.ventas ? `ventas ${formatMoney(f.ventas)}` : '', f.cobros ? `cobros ${formatMoney(f.cobros)}` : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ))}
              {liq.cheques.length ? (
                <View style={{ gap: 2, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>Cheques a entregar</Text>
                  {liq.cheques.map((ch, i) => <Text key={i} style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${ch.cliente} · ${ch.referencia ?? 'sin número'} · ${formatMoney(Number(ch.monto))}`}</Text>)}
                </View>
              ) : null}
            </Seccion>

            <Seccion titulo={c ? 'Liquidación cerrada' : 'Por cerrar'}>
              {c ? (
                <>
                  <Dato primero rotulo="Esperado" valor={formatMoney(Number(c.esperado))} />
                  <Dato rotulo="Contado" valor={formatMoney(Number(c.contado))} />
                  <Dato rotulo="Diferencia" valor={rotuloDiferencia(c.diferencia, formatMoney)} fuerte />
                  {c.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Motivo: ${c.nota}`}</Text> : null}
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Cerró ${shortEmployeeName(c.cerrada_por)} a las ${hora12(c.cerrada_at)}.`}</Text>
                  {c.cambio_despues ? <Aviso tono="cuidado" texto={`Hubo ventas o cobros después del cierre: el efectivo a entregar ahora es ${formatMoney(esperado)}. Reábrela para volver a contar.`} /> : null}
                  {liq.puede_cerrar && ACCIONES_DE_DINERO ? (reabriendo ? (
                    <View style={{ gap: 8 }}>
                      <Campo value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se reabre?" />
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}><BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={() => setReabriendo(false)} /></View>
                        <View style={{ flex: 1 }}><BotonGrande color={PETROLEO} texto="Reabrir" deshabilitado={!motivo.trim() || ocupado} onPress={reabrir} /></View>
                      </View>
                    </View>
                  ) : <BotonGrande borde color={PETROLEO} texto="Reabrir" onPress={() => setReabriendo(true)} />) : null}
                </>
              ) : liq.puede_cerrar && ACCIONES_DE_DINERO ? (
                <>
                  <Campo multiline={false} value={contado} onChangeText={(v) => setContado(soloMonto(v))} keyboardType="decimal-pad" placeholder={`Efectivo contado (${esperado.toFixed(2)})`}
                    style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }} />
                  {cuenta.diferencia != null ? (
                    <Text style={{ color: cuenta.diferencia === 0 ? MARCA.verde : MARCA.rojo, fontSize: 16, fontWeight: '800' }}>
                      {cuenta.diferencia === 0 ? '✓ Cuadra' : `${cuenta.diferencia > 0 ? 'Sobran' : 'Faltan'} ${formatMoney(Math.abs(cuenta.diferencia))}`}
                    </Text>
                  ) : null}
                  {cuenta.diferencia != null && cuenta.diferencia !== 0 ? (
                    <Campo value={nota} onChangeText={setNota} placeholder="Motivo de la diferencia — p. ej. devolvió $5 al cliente de la nota de crédito" />
                  ) : null}
                  <BotonGrande color={PETROLEO} texto="Cerrar liquidación" deshabilitado={!cuenta.listo || ocupado} onPress={cerrar} />
                </>
              ) : liq.puede_cerrar ? <SeHaceEnElPortal texto="La liquidación se cierra desde el portal." />
                : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>La cierra quien recibe el efectivo.</Text>}
            </Seccion>

            <Seccion titulo={`Ventas · ${liq.ventas.lista.length}`}>
              {liq.ventas.lista.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No facturó este día.</Text> : null}
              {liq.ventas.lista.map((v, i) => (
                <View key={v.id} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{v.cliente}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${TIPO_DOCUMENTO[v.tipo]?.largo ?? v.tipo} · ${hora12(v.hora)}`}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(v.total))}</Text>
                </View>
              ))}
            </Seccion>

            {liq.cobros.lista.length ? (
              <Seccion titulo="Cobros de cartera">
                {liq.cobros.lista.map((r, i) => (
                  <View key={r.id} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{r.cliente}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${nombreFormaPago(r.forma)} · ${hora12(r.hora)}`}</Text>
                    </View>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(r.monto))}</Text>
                  </View>
                ))}
              </Seccion>
            ) : null}

            <BotonGrande borde color={PETROLEO} texto="Imprimir o compartir la liquidación" onPress={papel} />
          </View>
        </>
      ) : null}
    </View>
  );
}
