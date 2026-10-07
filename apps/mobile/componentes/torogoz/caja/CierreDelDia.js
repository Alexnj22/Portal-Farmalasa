// El cierre del día de la distribuidora —el `TabCierreDia` del portal (borrador
// 0024)—: la empresa entera en una pantalla. Lo vendido por forma de pago, lo
// que entró a la oficina, los depósitos al banco y la conciliación: recibido −
// depositado = lo que queda en caja fuerte.
//
// No se cierra con vendedores sin liquidar, y lo que no se depositó exige decir
// dónde quedó (`cierreDelDiaListo`, del núcleo). Cerrado, las liquidaciones de
// ese día ya no se reabren sin reabrir antes el cierre. El depósito y la nota a
// medio escribir se guardan.
//
// ⚠ Registrar un depósito, cerrar y reabrir el día mueven DINERO de verdad; en
// el entorno de pruebas no se hacen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cerrarDia, fetchCierreDia, mensajeDeDistribucion, reabrirDia, registrarDeposito } from '@nucleo/data/distribucion';
import { cierreDelDiaListo, cuentaDelDia, depositoListo, formasDelDia, preguntaDelCierre } from '@nucleo/utils/distribucionCaja';
import { nombreFormaPago } from '@nucleo/utils/distribucionFacturacion';
import { ticketDeCierreDia } from '@nucleo/utils/distribucionDocumento';
import { MARCA_PAPEL } from '@nucleo/utils/distribucionMarca';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../formulario/Piezas';
import { Pildora } from '../../avisos/Piezas';
import Avatar from '../../Avatar';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { MARCA } from '../../inicio/marca';
import { fallo, listo, trabajando } from '../../Progreso';
import { compartirTicket, elegir, imprimirTicket } from '../fiscal/papel';
import DiaElegido from './DiaElegido';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

const PETROLEO = '#0f6e7d';
const soloMonto = (v) => v.replace(',', '.').replace(/[^0-9.]/g, '');

export default function CierreDelDia({ fecha, onFecha, onVendedor, emisor, recarga = 0 }) {
  const clave = `distribucion-cierre-dia-${fecha}`;
  const [d, setD] = useState(undefined);
  const [error, setError] = useState(null);
  const [dep, setDep] = useState({ monto: '', banco: '', referencia: '' });
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    try { setD(await fetchCierreDia(fecha)); setError(null); }
    catch (e) { setD(null); setError(mensajeDeDistribucion(e)); }
  }, [fecha]);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  useEffect(() => {
    const b = loadDraft(clave);
    setDep(b?.dep ?? { monto: '', banco: '', referencia: '' }); setNota(b?.nota ?? '');
  }, [clave]);
  useEffect(() => { if (dep.monto || dep.referencia || nota) saveDraft(clave, { dep, nota }); }, [clave, dep, nota]);

  const { recibido, depositado, queda } = cuentaDelDia(d);
  const formas = useMemo(() => formasDelDia(d), [d]);
  const cerrado = !!d?.cierre;
  const deposito = depositoListo(dep);
  const puedeCerrar = cierreDelDiaListo(d, queda, nota);
  const anotar = (accion, id, detalle) => useStaffStore.getState().appendAuditLog?.(accion, id, { ...detalle, via: 'app' });

  const correr = (titulo, mensaje, boton, texto, fn, ok) => Alert.alert(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' },
    { text: boton, onPress: async () => {
      setOcupado(true); trabajando(texto);
      try { const r = await fn(); ok?.(r); await cargar(); }
      catch (e) { fallo('No se pudo', mensajeDeDistribucion(e)); }
      finally { setOcupado(false); }
    } },
  ]);
  const depositar = () => correr('¿Registrar el depósito?', `${formatMoney(deposito.monto)} en ${dep.banco.trim()} · boleta ${dep.referencia.trim()}.`, 'Registrar', 'Registrando el depósito…',
    () => registrarDeposito(fecha, deposito.monto, dep.banco.trim(), dep.referencia.trim()), (id) => {
      anotar('DISTRIBUCION_DEPOSITO', String(id), { fecha, monto: deposito.monto, banco: dep.banco.trim(), referencia: dep.referencia.trim() });
      listo('Depósito registrado', formatMoney(deposito.monto));
      setDep({ monto: '', banco: dep.banco, referencia: '' });
    });
  const cerrar = () => correr('¿Cerrar el día?', queda ? `Quedan ${formatMoney(queda)} sin depositar: ${nota.trim()}.` : 'Todo lo recibido se depositó.', 'Cerrar el día', 'Cerrando el día…',
    () => cerrarDia(fecha, nota.trim()), (id) => {
      anotar('DISTRIBUCION_CIERRE_DIA', String(id), { fecha, recibido, depositado, queda });
      listo('Día cerrado', queda ? `Quedan ${formatMoney(queda)} sin depositar` : 'Todo lo recibido se depositó.');
      setNota(''); clearDraft(clave);
    });
  const reabrir = () => correr('¿Reabrir el día?', 'Las liquidaciones de ese día se vuelven a poder reabrir.', 'Reabrir', 'Reabriendo…',
    () => reabrirDia(d.cierre.id, motivo.trim()), () => {
      anotar('DISTRIBUCION_CIERRE_DIA_REABIERTO', String(d.cierre.id), { fecha, motivo: motivo.trim() });
      setReabriendo(false); setMotivo('');
    });
  const papel = () => {
    const t = ticketDeCierreDia(d, MARCA_PAPEL, emisor ?? {});
    elegir('Cierre del día', [
      { texto: 'Imprimir', accion: () => imprimirTicket(t).catch((e) => fallo('No se pudo imprimir', e?.message ?? '')) },
      { texto: 'Compartir', accion: () => compartirTicket(t, `Cierre del día ${fecha}`).catch((e) => fallo('No se pudo compartir', e?.message ?? '')) },
    ]);
  };

  return (
    <View style={{ gap: 14 }}>
      <DiaElegido fecha={fecha} onCambiar={onFecha} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {d === undefined ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
      {d ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Receipt" rotulo="Vendido" valor={formatMoney(Number(d.ventas.total), { decimales: 0 })} color={PETROLEO}
              apoyo={`${Number(d.ventas.documentos)} documentos${Number(d.devoluciones) > 0 ? ` · ${formatMoney(Number(d.devoluciones))} devuelto` : ''}`} />
            <Kpi icono="Wallet" rotulo="Efectivo recibido" valor={formatMoney(recibido, { decimales: 0 })} color={MARCA.verde}
              apoyo={`Fondos ${formatMoney(Number(d.fondos), { decimales: 0 })} · gastos ${formatMoney(Number(d.gastos), { decimales: 0 })}`} />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="Landmark" rotulo="Depositado" valor={formatMoney(depositado, { decimales: 0 })} color={MARCA.violeta} apoyo={`${d.depositos.length} depósitos`} />
            <Kpi icono="Lock" rotulo="Queda en caja fuerte" valor={formatMoney(queda)} color={queda < 0 ? MARCA.rojo : MARCA.ambar} pide={queda < 0}
              apoyo={Number(d.diferencias) === 0 ? 'Liquidaciones sin diferencia' : `Diferencias ${formatMoney(Number(d.diferencias))}`} />
          </FilaDeKpis>

          <View style={{ marginHorizontal: 16, gap: 16 }}>
            {ACCIONES_DE_DINERO && puedeCerrar.motivo ? <Aviso tono="cuidado" texto={puedeCerrar.motivo} /> : null}

            <Seccion titulo="Vendedores" pie={d.vendedores.length ? 'Toca uno para abrir su liquidación.' : undefined}>
              {d.vendedores.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie vendió ni cobró este día.</Text> : null}
              {d.vendedores.map((v, i) => (
                <Pressable key={v.id} onPress={() => onVendedor(v.id)} accessibilityRole="button" accessibilityLabel={shortEmployeeName(v)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, opacity: pressed ? 0.6 : 1,
                    paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador })}>
                  <Avatar empleado={v} tamano={30} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(v)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`vendió ${formatMoney(Number(v.ventas))}`}</Text>
                  </View>
                  {v.cierre_id
                    ? <Pildora texto={`Entregó ${formatMoney(Number(v.contado))}${Number(v.diferencia) === 0 ? '' : ` (${formatMoney(Number(v.diferencia))})`}`} color={Number(v.diferencia) === 0 ? MARCA.verde : MARCA.ambar} />
                    : <Pildora texto={`Por liquidar ${formatMoney(Number(v.esperado))}`} color={MARCA.ambar} />}
                </Pressable>
              ))}
            </Seccion>

            <Seccion titulo="Por forma de pago">
              {formas.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin pagos este día.</Text> : null}
              {formas.map(([f, m], i) => <Dato key={f} primero={i === 0} rotulo={nombreFormaPago(f)} valor={formatMoney(m)} />)}
            </Seccion>

            {d.gastos_lista.length ? (
              <Seccion titulo="Gastos de ruta">
                {d.gastos_lista.map((g, i) => <Dato key={i} primero={i === 0} rotulo={g.concepto} valor={formatMoney(Number(g.monto))} />)}
              </Seccion>
            ) : null}

            <Seccion titulo="Depósitos">
              {d.depositos.length === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin depósitos este día.</Text> : null}
              {d.depositos.map((x, i) => <Dato key={x.id} primero={i === 0} rotulo={`${x.banco} · ${x.referencia}`} valor={formatMoney(Number(x.monto))} />)}
              {/* Sólo consulta (soloConsulta.js): depósitos y cierre del día se registran en el portal. */}
              {!cerrado && !ACCIONES_DE_DINERO ? <SeHaceEnElPortal texto="Los depósitos se registran desde el portal." /> : null}
              {!cerrado && ACCIONES_DE_DINERO ? (
                <View style={{ gap: 8, paddingTop: d.depositos.length ? 10 : 0, borderTopWidth: d.depositos.length ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <Campo multiline={false} value={dep.monto} onChangeText={(v) => setDep((x) => ({ ...x, monto: soloMonto(v) }))} keyboardType="decimal-pad"
                    placeholder={`Monto ${queda > 0 ? queda.toFixed(2) : '0.00'}`} />
                  <Campo multiline={false} value={dep.banco} onChangeText={(v) => setDep((x) => ({ ...x, banco: v }))} placeholder="Banco" />
                  <Campo multiline={false} value={dep.referencia} onChangeText={(v) => setDep((x) => ({ ...x, referencia: v }))} placeholder="Número de boleta" autoCapitalize="characters" />
                  <BotonGrande borde color={PETROLEO} texto="Registrar depósito" deshabilitado={!deposito.listo || ocupado} onPress={depositar} />
                </View>
              ) : null}
            </Seccion>

            <Seccion titulo={cerrado ? 'Día cerrado' : 'Cerrar el día'}>
              {cerrado ? (
                <>
                  <Text style={{ color: MARCA.verde, fontSize: 16, fontWeight: '800' }}>Día cerrado</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Cerró ${shortEmployeeName(d.cierre.cerrado_por)} a las ${hora12(d.cierre.cerrado_at)}${d.cierre.nota ? ` · ${d.cierre.nota}` : ''}.`}</Text>
                  {!ACCIONES_DE_DINERO ? null : reabriendo ? (
                    <View style={{ gap: 8 }}>
                      <Campo value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se reabre?" />
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}><BotonGrande borde color={colorSistema.texto2} texto="Cancelar" onPress={() => setReabriendo(false)} /></View>
                        <View style={{ flex: 1 }}><BotonGrande color={PETROLEO} texto="Reabrir el día" deshabilitado={!motivo.trim() || ocupado} onPress={reabrir} /></View>
                      </View>
                    </View>
                  ) : <BotonGrande borde color={PETROLEO} texto="Reabrir el día" onPress={() => setReabriendo(true)} />}
                </>
              ) : !ACCIONES_DE_DINERO ? (
                <SeHaceEnElPortal texto="El día se cierra desde el portal." />
              ) : (
                <>
                  {queda !== 0 ? <Campo value={nota} onChangeText={setNota} placeholder={`${preguntaDelCierre(queda, formatMoney)} — caja fuerte, fondo de mañana…`} /> : null}
                  {queda === 0 && d.pendientes === 0 ? <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '600' }}>Todo lo recibido está depositado.</Text> : null}
                  <BotonGrande color={PETROLEO} texto="Cerrar el día" deshabilitado={!puedeCerrar.listo || ocupado} onPress={cerrar} />
                </>
              )}
            </Seccion>
            <BotonGrande borde color={PETROLEO} texto="Imprimir o compartir el cierre" onPress={papel} />
          </View>
        </>
      ) : null}
    </View>
  );
}
