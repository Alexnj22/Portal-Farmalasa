// Torogoz › la cuenta de un cliente, NATIVA — el `CarteraClienteModal` del
// portal: qué debe, cobrarle y lo que ya pagó.
//
// El cobro se arma aquí y lo decide la base (`dist_cobrar`, borrador 0014): la
// pantalla muestra ANTES a qué documentos va cada centavo —con la misma regla
// que la base, primero lo que vence antes— o deja repartirlo a mano. Un
// reintento no cobra dos veces (`clientUuid`, que se guarda con el borrador), el
// monto no puede pasar de lo que se debe, y un cheque o una transferencia
// llevan su número. Lo que impide cobrar lo dice el núcleo
// (`problemaDelCobro`), igual que en el portal.
//
// ⚠ «Cobrar» y «Anular cobro» mueven DINERO de verdad (la cartera y la caja del
// vendedor). En el entorno de pruebas no se cobra: ahí sólo se mira.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anularRecibo, cobrar, fetchEmisor, fetchEstadoCuenta, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { cambioDelCobro, problemaDelCobro, repartoDelCobro } from '@nucleo/utils/distribucionCartera';
import { FORMA_PAGO, leerMonto } from '@nucleo/utils/distribucionComun';
import { nombreFormaPago } from '@nucleo/utils/distribucionFacturacion';
import { nuevoUuid } from '@nucleo/utils/distribucionComercial';
import { ticketDeEstadoDeCuenta, ticketDeRecibo } from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from '@nucleo/utils/distribucionMarca';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../../componentes/formulario/Piezas';
import { Pildora } from '../../../componentes/avisos/Piezas';
import Avatar from '../../../componentes/Avatar';
import Vidrio from '../../../componentes/Vidrio';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';
import { compartirTicket, elegir, imprimirTicket } from '../../../componentes/torogoz/fiscal/papel';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';

const PETROLEO = '#0f6e7d';
const aC = (n) => Math.round(Number(n || 0) * 100);
const soloMonto = (v) => v.replace(',', '.').replace(/[^0-9.]/g, '');

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ width: '48%', padding: 12, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.12)', gap: 2 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}

export default function CuentaDelCliente() {
  const p = useLocalSearchParams();
  const clienteId = Number(p.id);
  const { hasPermission } = useAuth();
  // Sólo consulta (soloConsulta.js): cobrar y anular cobros mueven dinero, se
  // hacen desde el portal.
  const vende = !!hasPermission?.('distribucion', 'can_edit');
  const puedeCobrar = vende && ACCIONES_DE_DINERO;
  const puedeAnular = !!hasPermission?.('distribucion_config', 'can_edit') && ACCIONES_DE_DINERO;
  const claveBorrador = `distribucion-cobro-${clienteId}`;

  const [estado, setEstado] = useState(null);
  const [emisor, setEmisor] = useState(null);
  const [error, setError] = useState(null);
  const [monto, setMonto] = useState('');
  const [forma, setForma] = useState('01');
  const [referencia, setReferencia] = useState('');
  const [recibido, setRecibido] = useState('');
  const [nota, setNota] = useState('');
  const [aMano, setAMano] = useState(false);
  const [manual, setManual] = useState({});
  const [imprimir, setImprimir] = useState(true);
  const [cobrando, setCobrando] = useState(false);
  const [uuid, setUuid] = useState(() => nuevoUuid());
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setEstado(await fetchEstadoCuenta(clienteId)); setError(null); }
    catch (e) { setError(mensajeDeDistribucion(e)); }
  }, [clienteId]);
  useEffect(() => { cargar(); fetchEmisor().then(setEmisor).catch(() => setEmisor(null)); }, [cargar]);

  // Un cobro a medio escribir sobrevive a que la sesión se cierre sola. Y con
  // él su `uuid`: si el cobro llegó a la base pero la respuesta se perdió,
  // reintentarlo después no cobra dos veces.
  useEffect(() => {
    if (!puedeCobrar) return;
    const b = loadDraft(claveBorrador);
    if (b && (b.monto || b.referencia || b.nota || Object.keys(b.manual ?? {}).length)) {
      Alert.alert('Hay un cobro a medias', 'Quedó un cobro sin terminar para este cliente. ¿Lo recuperas?', [
        { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearDraft(claveBorrador) },
        { text: 'Recuperar', onPress: () => {
          setMonto(b.monto ?? ''); setForma(b.forma ?? '01'); setReferencia(b.referencia ?? ''); setRecibido(b.recibido ?? '');
          setNota(b.nota ?? ''); setAMano(!!b.aMano); setManual(b.manual ?? {}); if (b.uuid) setUuid(b.uuid);
        } },
      ]);
    }
  }, [claveBorrador, puedeCobrar]);
  useEffect(() => {
    if (!puedeCobrar) return;
    if (monto || referencia || nota || Object.keys(manual).length) saveDraft(claveBorrador, { monto, forma, referencia, recibido, nota, aMano, manual, uuid });
  }, [claveBorrador, puedeCobrar, monto, forma, referencia, recibido, nota, aMano, manual, uuid]);

  const cr = estado?.credito ?? {};
  const abiertas = useMemo(() => (estado?.cuentas ?? []).filter((x) => x.estado === 'abierta'), [estado]);
  const saldo = Number(cr.saldo ?? 0);
  const vencido = Number(cr.vencido ?? 0);
  const n = leerMonto(monto) ?? 0;
  const reparto = useMemo(() => repartoDelCobro(abiertas, { aMano, monto: n, manual, leer: leerMonto }), [abiertas, aMano, n, manual]);
  const totalManual = reparto.reduce((a, r) => a + aC(r.monto), 0) / 100;
  const montoFinal = aMano ? totalManual : n;
  const porCuenta = new Map(reparto.map((r) => [r.cxc_id, r]));
  const recibidoN = leerMonto(recibido);
  const cambio = cambioDelCobro(forma, recibidoN, montoFinal);
  const problema = problemaDelCobro({ puedeCobrar, montoFinal, saldo, aMano, reparto, forma, referencia, cambio });
  const listoParaCobrar = montoFinal > 0 && !problema && !cobrando;

  const papelDelRecibo = (r) => ticketDeRecibo(r, MARCA_PAPEL, emisor ?? {});
  const sacarRecibo = (r) => elegir(`Recibo ${r.id}`, [
    { texto: 'Imprimir', accion: () => imprimirTicket(papelDelRecibo(r)).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
    { texto: 'Compartir', accion: () => compartirTicket(papelDelRecibo(r), `Recibo ${r.id} ${p.nombre ?? ''}`).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
  ]);
  const estadoDeCuenta = () => {
    const t = ticketDeEstadoDeCuenta({ cliente: p.nombre, estado, marca: MARCA_PAPEL, emisor: emisor ?? {} });
    elegir('Estado de cuenta', [
      { texto: 'Imprimir', accion: () => imprimirTicket(t).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
      { texto: 'Compartir', accion: () => compartirTicket(t, `Estado de cuenta ${p.nombre ?? ''}`).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
    ]);
  };

  const hacerCobro = () => {
    if (!listoParaCobrar) return;
    Alert.alert('¿Registrar el cobro?', `${p.nombre} · ${formatMoney(montoFinal)} en ${nombreFormaPago(forma).toLowerCase()}${cambio > 0 ? ` · cambio ${formatMoney(cambio)}` : ''}.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Cobrar', onPress: async () => {
        setCobrando(true); trabajando('Registrando el cobro…');
        try {
          const recibo = await cobrar({
            clienteId, monto: montoFinal, forma, clientUuid: uuid,
            referencia: referencia.trim() || null, recibido: forma === '01' ? recibidoN : null, nota: nota.trim() || null,
            aplicacion: aMano ? reparto.map((r) => ({ cxc_id: r.cxc_id, monto: r.monto })) : null,
          });
          useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_COBRO', String(recibo.id), { cliente: clienteId, monto: montoFinal, forma, via: 'app' });
          listo('Cobro registrado', `${formatMoney(montoFinal)} · queda debiendo ${formatMoney(recibo.saldo_cliente)}`);
          if (imprimir) imprimirTicket(papelDelRecibo(recibo)).catch(() => {});
          setMonto(''); setReferencia(''); setRecibido(''); setNota(''); setManual({}); setAMano(false);
          setUuid(nuevoUuid());
          clearDraft(claveBorrador);
          cargar();
        } catch (e) {
          fallo('No se pudo cobrar', mensajeDeDistribucion(e));
        } finally { setCobrando(false); }
      } },
    ]);
  };

  const confirmarAnulacion = (id) => Alert.alert('¿Anular este cobro?', 'El saldo vuelve a las cuentas del cliente.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular cobro', style: 'destructive', onPress: async () => {
      trabajando('Anulando…');
      try {
        await anularRecibo(id, motivo.trim());
        useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_COBRO_ANULADO', String(id), { motivo: motivo.trim(), via: 'app' });
        listo('Cobro anulado', 'El saldo volvió a las cuentas.');
        setAnulando(null); setMotivo('');
        cargar();
      } catch (e) { fallo('No se pudo anular', mensajeDeDistribucion(e)); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cuenta' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          <Vidrio radio={24}>
            <View style={{ padding: 18, gap: 6 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{p.nombre}</Text>
              {p.ruta || p.telefono ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[p.ruta, p.telefono && `Tel. ${p.telefono}`].filter(Boolean).join(' · ')}</Text> : null}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <Text style={{ color: saldo > 0 ? colorSistema.texto : MARCA.verde, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(saldo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>debe</Text>
              </View>
            </View>
          </Vidrio>
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!estado && !error ? <Aviso tono="nota" texto="Cargando…" /> : null}
          {estado ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
                <Cifra rotulo="Límite" valor={formatMoney(cr.limite)} />
                <Cifra rotulo="Vencido" valor={formatMoney(vencido)} color={vencido > 0 ? MARCA.rojo : undefined} />
                <Cifra rotulo="Atraso máximo" valor={cr.dias_atraso > 0 ? `${cr.dias_atraso} días` : 'Al día'} color={cr.dias_atraso > 0 ? MARCA.rojo : MARCA.verde} />
                <Cifra rotulo="Disponible" valor={formatMoney(cr.disponible)} color={Number(cr.disponible) <= 0 ? MARCA.ambar : undefined} />
              </View>
              {saldo > Number(cr.limite ?? 0) ? <Aviso tono="cuidado" texto="Debe más que su límite de crédito: no se le puede vender a crédito hasta que abone." /> : null}

              <Seccion titulo={`${abiertas.length} documento${abiertas.length === 1 ? '' : 's'} por cobrar`}
                pie={puedeCobrar && abiertas.length > 1 ? (aMano ? 'Repartido a mano: escribe cuánto va a cada documento.' : 'Se reparte solo: primero lo que vence antes.') : undefined}>
                {abiertas.length === 0 ? <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '600' }}>No debe nada.</Text> : null}
                {abiertas.map((x, i) => {
                  const r = porCuenta.get(x.id);
                  const atraso = Number(x.dias);
                  return (
                    <View key={x.id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 13, fontFamily: 'Menlo' }} numberOfLines={1}>{x.numero_control}</Text>
                          <Text style={{ color: atraso > 0 ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
                            {`${fechaNumerica(x.fecha)} · vence ${fechaNumerica(x.vence)}${atraso > 0 ? ` · ${atraso} días de atraso` : ''}`}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(x.saldo)}</Text>
                          {Number(x.abonado) > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`de ${formatMoney(x.monto)}`}</Text> : null}
                        </View>
                      </View>
                      {aMano ? (
                        <Campo multiline={false} value={manual[x.id] ?? ''} keyboardType="decimal-pad" placeholder="$0.00 a este documento"
                          onChangeText={(v) => setManual((m) => ({ ...m, [x.id]: soloMonto(v) }))} />
                      ) : r ? (
                        <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '600' }}>{`−${formatMoney(r.monto)} · queda ${formatMoney(r.queda)}`}</Text>
                      ) : null}
                    </View>
                  );
                })}
                {puedeCobrar && abiertas.length > 1 ? (
                  <Pressable onPress={() => { setAMano((v) => !v); setManual({}); }} hitSlop={6} style={{ minHeight: 40, justifyContent: 'center' }}>
                    <Text style={{ color: PETROLEO, fontSize: 15, fontWeight: '700' }}>{aMano ? 'Repartir automático' : 'Repartir a mano'}</Text>
                  </Pressable>
                ) : null}
              </Seccion>

              {vende && !ACCIONES_DE_DINERO && abiertas.length > 0 ? <SeHaceEnElPortal texto="Los cobros se registran desde el portal." /> : null}
              {puedeCobrar && abiertas.length > 0 ? (
                <>
                  <Seccion titulo="Cobrar">
                    {aMano ? (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Monto (suma del reparto)</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(totalManual)}</Text>
                      </View>
                    ) : (
                      <>
                        <Campo multiline={false} value={monto} onChangeText={(v) => setMonto(soloMonto(v))} keyboardType="decimal-pad" placeholder="Monto $0.00"
                          style={{ fontSize: 22, fontWeight: '700', textAlign: 'center' }} />
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          {vencido > 0 && vencido < saldo ? <View style={{ flex: 1 }}><BotonGrande borde color={PETROLEO} texto={`Lo vencido ${formatMoney(vencido)}`} onPress={() => setMonto(vencido.toFixed(2))} /></View> : null}
                          <View style={{ flex: 1 }}><BotonGrande borde color={PETROLEO} texto={`Todo ${formatMoney(saldo)}`} onPress={() => setMonto(saldo.toFixed(2))} /></View>
                        </View>
                      </>
                    )}
                  </Seccion>
                  <Seccion titulo="Forma de pago">
                    <Opciones color={PETROLEO} opciones={FORMA_PAGO.map((f) => ({ id: f.value, label: f.label }))} valor={forma} onCambiar={(v) => { setForma(v); setRecibido(''); }} />
                  </Seccion>
                  <Seccion titulo={forma === '01' ? 'Entrega' : ['04', '05'].includes(forma) ? 'Número (obligatorio)' : 'Número o autorización'}
                    pie={forma === '01' && cambio > 0 ? `Cambio ${formatMoney(cambio)}` : undefined}>
                    {forma === '01' ? (
                      <Campo multiline={false} value={recibido} onChangeText={(v) => setRecibido(soloMonto(v))} keyboardType="decimal-pad" placeholder={montoFinal ? montoFinal.toFixed(2) : '0.00'} />
                    ) : (
                      <Campo multiline={false} value={referencia} onChangeText={setReferencia} placeholder="Número" autoCapitalize="characters" />
                    )}
                    <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional) — p. ej. abono acordado por teléfono" />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Imprimir el recibo</Text>
                      <Switch value={imprimir} onValueChange={setImprimir} />
                    </View>
                  </Seccion>
                  {problema ? <Aviso tono="freno" texto={problema} /> : null}
                  <BotonGrande color={PETROLEO} texto={cobrando ? 'Cobrando…' : montoFinal > 0 ? `Cobrar ${formatMoney(montoFinal)}` : 'Cobrar'} deshabilitado={!listoParaCobrar} onPress={hacerCobro} />
                </>
              ) : null}

              <Seccion titulo="Cobros recientes">
                {(estado.recibos ?? []).length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin cobros registrados.</Text> : null}
                {(estado.recibos ?? []).slice(0, 12).map((r, i) => (
                  <View key={r.id} style={{ gap: 6, opacity: r.anulado_at ? 0.55 : 1, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Pressable onPress={() => sacarRecibo(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityRole="button" accessibilityLabel={`Recibo ${r.id}`}>
                      {r.recibido_por ? <Avatar empleado={r.recibido_por} tamano={30} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`Recibo ${r.id} · ${nombreFormaPago(r.forma)}${r.referencia ? ` ${r.referencia}` : ''}`}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                          {`${fechaHora12(r.created_at)} · ${shortEmployeeName(r.recibido_por) || '—'} · ${(r.abonos ?? []).length} documento${(r.abonos ?? []).length === 1 ? '' : 's'}${r.anulado_at ? ` · ${r.anulado_motivo}` : ''}`}
                        </Text>
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(r.monto)}</Text>
                    </Pressable>
                    {r.anulado_at ? <Pildora texto="Anulado" color={MARCA.rojo} /> : null}
                    {puedeAnular && !r.anulado_at && anulando !== r.id ? (
                      <Pressable onPress={() => { setAnulando(r.id); setMotivo(''); }} hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
                        <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>Anular este cobro</Text>
                      </Pressable>
                    ) : null}
                    {anulando === r.id ? (
                      <View style={{ gap: 8 }}>
                        <Campo value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se anula? — p. ej. el cheque rebotó" />
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                          <View style={{ flex: 1 }}><BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={() => setAnulando(null)} /></View>
                          <View style={{ flex: 1 }}><BotonGrande color={MARCA.rojo} texto="Anular cobro" deshabilitado={!motivo.trim()} onPress={() => confirmarAnulacion(r.id)} /></View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))}
              </Seccion>
              {abiertas.length > 0 ? <BotonGrande borde color={PETROLEO} texto="Estado de cuenta" onPress={estadoDeCuenta} /> : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
