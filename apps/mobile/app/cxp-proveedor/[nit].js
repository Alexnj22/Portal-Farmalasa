// Lo que le debemos a un proveedor, NATIVO — el `PanelProveedor` del portal:
//   · sus condiciones (días y límite de crédito), editables con
//     `guardarCondicionesProveedor` — sin el plazo ninguna factura puede decir
//     si está vencida, por eso van arriba;
//   · cada factura abierta con su saldo, lo que está en trámite y su
//     vencimiento;
//   · REGISTRAR UN PAGO: cuánto se aplica a cada factura (con tope en el saldo
//     menos lo que ya está en trámite, la misma cuenta que
//     `registrar_pago_compra`), la forma, el número de cheque o referencia y la
//     fecha. El monto del pago es la SUMA de lo aplicado. Queda pendiente hasta
//     que Gerencia lo apruebe.
// El reparto a medio armar se guarda solo (`useBorrador`, por NIT), igual que
// en el portal: la sesión se cierra sola y repartir un pago son minutos.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchCuentasPorPagar, fetchDetalleProveedor, guardarCondicionesProveedor, registrarPago } from '@nucleo/data/cuentasPorPagar';
import { FORMAS_DE_PAGO } from '@nucleo/utils/cuentasPorPagar';
import { hastaElTope } from '@nucleo/utils/hastaElTope';
import { dteTypeLabel } from '@nucleo/utils/dteTypes';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

export default function ProveedorPorPagar() {
  const { nit, nombre } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('cuentas_por_pagar', 'can_edit');
  const [fila, setFila] = useState(null);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [montos, setMontos] = useState({});
  const [forma, setForma] = useState('cheque');
  const [referencia, setRef] = useState('');
  const [fecha, setFecha] = useState(hoySV());
  const [dias, setDias] = useState('');
  const [limite, setLimite] = useState('');

  const cargar = useCallback(async () => {
    const [d, cxp] = await Promise.all([fetchDetalleProveedor(String(nit)), fetchCuentasPorPagar(null)]);
    setDocs(d.filas);
    const f = (cxp.filas || []).find((x) => String(x.emisor_nit) === String(nit)) ?? null;
    setFila(f);
    setError(d.error?.message ?? cxp.error?.message ?? null);
    return f;
  }, [nit]);
  useEffect(() => {
    cargar().then((f) => {
      if (!f) return;
      setDias(f.dias_credito ?? ''); setLimite(f.limite_credito ?? '');
      if (f.forma_pago) setForma(f.forma_pago);
    });
  }, [cargar]);

  // El reparto a medio armar, por proveedor. Nunca los días ni el límite: son
  // condiciones con su propio botón y un borrador viejo pisaría lo confirmado.
  const { recuperado, descartar } = useBorrador(`cxp_pago_${nit}`, { montos, forma, referencia, fecha });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado) return;
    repuesto.current = true;
    if (recuperado.montos) setMontos(recuperado.montos);
    if (recuperado.forma) setForma(recuperado.forma);
    if (recuperado.referencia) setRef(recuperado.referencia);
    if (recuperado.fecha) setFecha(recuperado.fecha);
  }, [recuperado]);

  const lista = useMemo(() => docs || [], [docs]);
  const abiertas = useMemo(() => lista.filter((d) => Number(d.saldo) > 0), [lista]);
  const saldo = lista.reduce((s, d) => s + Number(d.saldo || 0), 0);
  const vencido = lista.filter((d) => Number(d.dias_vencido) > 0).reduce((s, d) => s + Number(d.saldo || 0), 0);
  const tramite = lista.reduce((s, d) => s + Number(d.en_tramite || 0), 0);
  const totalAplicado = Object.values(montos).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  const condicionesIguales = String(dias ?? '') === String(fila?.dias_credito ?? '') && String(limite ?? '') === String(fila?.limite_credito ?? '');

  const guardarCondiciones = async () => {
    if (!fila?.proveedor_id) { fallo('Sin ficha', 'Este proveedor todavía no tiene ficha en el portal.'); return; }
    setOcupado(true);
    const { error: e } = await guardarCondicionesProveedor(fila.proveedor_id, { diasCredito: dias, limiteCredito: limite, formaPago: forma }, { proveedor: fila.proveedor, desde: 'app' });
    setOcupado(false);
    if (e) { fallo('No se guardó', e); return; }
    listo('Condiciones guardadas', fila.proveedor);
    cargar();
  };

  const pagar = () => {
    const aplicaciones = Object.entries(montos)
      .map(([document_id, m]) => ({ document_id: Number(document_id), monto: parseFloat(m) }))
      .filter((a) => a.monto > 0);
    if (!aplicaciones.length) { fallo('Falta el reparto', 'Marca a qué facturas se aplica el pago.'); return; }
    const formaTexto = FORMAS_DE_PAGO.find((x) => x.value === forma)?.label ?? forma;
    Alert.alert('¿Registrar el pago?', `${formatMoney(totalAplicado)} a ${aplicaciones.length} factura${aplicaciones.length === 1 ? '' : 's'} · ${formaTexto}${referencia ? ` ${referencia}` : ''}. Queda esperando la aprobación de Gerencia.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Registrar', onPress: async () => {
        setOcupado(true);
        const { error: e } = await registrarPago({ emisorNit: String(nit), fecha, forma, referencia, aplicaciones }, { proveedor: fila?.proveedor ?? nombre, desde: 'app' });
        setOcupado(false);
        if (e) { fallo('No se registró', e); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        descartar();
        setMontos({}); setRef('');
        listo('Pago registrado', 'Espera la aprobación de Gerencia.');
        cargar();
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: String(fila?.proveedor || nombre || 'Proveedor'), headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {docs == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
            <>
              <Seccion titulo="Resumen">
                <Dato primero rotulo="Debemos" valor={formatMoney(saldo)} fuerte />
                <Dato rotulo="Vencido" valor={formatMoney(vencido)} />
                <Dato rotulo="En trámite" valor={formatMoney(tramite)} />
                <Dato rotulo="Días de crédito" valor={fila?.dias_credito != null ? `${fila.dias_credito} días` : 'sin plazo'} />
                <Dato rotulo="Límite de crédito" valor={fila?.limite_credito != null ? formatMoney(fila.limite_credito) : 'sin límite'} />
                {fila?.disponible != null ? <Dato rotulo="Disponible" valor={formatMoney(fila.disponible)} /> : null}
                <Dato rotulo="NIT" valor={String(nit)} />
              </Seccion>

              {puedeEditar ? (
                <Seccion titulo="Condiciones del proveedor" pie="Sin el plazo, ninguna factura puede decir si está vencida.">
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Días de crédito</Text>
                  <Campo multiline={false} keyboardType="number-pad" value={String(dias ?? '')} onChangeText={setDias} placeholder="30" />
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Límite de crédito</Text>
                  <Campo multiline={false} keyboardType="decimal-pad" value={String(limite ?? '')} onChangeText={setLimite} placeholder="Sin límite" />
                  <BotonGrande texto={ocupado ? 'Guardando…' : 'Guardar condiciones'} borde color={MARCA.azulClaro} onPress={guardarCondiciones}
                    deshabilitado={ocupado || (condicionesIguales && forma === (fila?.forma_pago || forma))} />
                </Seccion>
              ) : null}

              <Seccion titulo={`Facturas sin pagar · ${abiertas.length}`}>
                {abiertas.length ? abiertas.map((d, i) => {
                  const tope = Number(d.saldo) - Number(d.en_tramite || 0);
                  return (
                    <View key={d.document_id ?? i} style={{ gap: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${dteTypeLabel(d.tipo_dte)} · ${fechaNumerica(d.fecha_emision)}`}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.saldo)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{d.vence ? `vence ${fechaNumerica(d.vence)}` : 'sin plazo definido'}</Text>
                        {d.tipo_dte === '05' ? <Pildora texto="Nota de crédito" color={MARCA.rojo} /> : null}
                        {Number(d.dias_vencido) > 0 ? <Pildora texto={`Vencida · ${d.dias_vencido} d`} color={MARCA.ambar} /> : null}
                        {Number(d.en_tramite) > 0 ? <Pildora texto={`En trámite ${formatMoney(d.en_tramite)}`} color={MARCA.azulClaro} /> : null}
                      </View>
                      {d.codigo_generacion ? <Text selectable style={{ color: colorSistema.texto2, fontSize: 11, fontFamily: 'Menlo' }}>{d.codigo_generacion}</Text> : null}
                      {puedeEditar && tope > 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`Pagar (hasta ${formatMoney(tope)})`}</Text>
                          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setMontos((m) => ({ ...m, [d.document_id]: tope.toFixed(2) })); }} hitSlop={6}>
                            <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>Todo</Text>
                          </Pressable>
                          <Campo multiline={false} keyboardType="decimal-pad" value={montos[d.document_id] ?? ''} placeholder="0.00" style={{ width: 110, textAlign: 'right' }}
                            onChangeText={(v) => setMontos((m) => ({ ...m, [d.document_id]: hastaElTope(v.replace(',', '.'), tope).valor }))} />
                        </View>
                      ) : null}
                    </View>
                  );
                }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No le debemos nada a este proveedor.</Text>}
              </Seccion>

              {puedeEditar && abiertas.length ? (
                <>
                  <Seccion titulo="El pago">
                    <Opciones valor={forma} onCambiar={setForma} opciones={FORMAS_DE_PAGO.map((f) => ({ id: f.value, label: f.label }))} />
                    <Campo multiline={false} value={referencia} onChangeText={setRef} placeholder="N.º de cheque o referencia" />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fecha</Text>
                      <Fecha valor={fecha} onCambiar={setFecha} hasta={hoySV()} />
                    </View>
                    <Dato rotulo="Total aplicado" valor={formatMoney(totalAplicado)} fuerte />
                  </Seccion>
                  <BotonGrande texto={ocupado ? 'Registrando…' : `Registrar pago${totalAplicado > 0 ? ` · ${formatMoney(totalAplicado)}` : ''}`}
                    onPress={pagar} deshabilitado={ocupado || totalAplicado <= 0 || !fecha} />
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
