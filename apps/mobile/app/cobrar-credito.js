// Recibir un pago de un crédito, NATIVO — el `DialogoAbono` del portal. Un
// abono se escribe en el sistema de la caja y NO tiene vuelta atrás (allá no
// hay borrar ni anular), así que la regla entera —con qué se paga, cuándo un
// comprobante frena, cómo se reparte entre los créditos del cliente y cuándo
// está listo— sale del núcleo (`abonoDeCredito`), la MISMA que usa el portal.
//
//   · Efectivo: se escribe cuánto se abona; entra al cajón y cuenta para el corte.
//   · Transferencia, tarjeta, cheque: el comprobante (foto) se LEE
//     (`leerPagoDeCredito`) y llena monto, fecha, número y POS. Lo que se aplica
//     tiene que dar EXACTO el comprobante, y un comprobante puede cubrir varios
//     créditos del mismo cliente.
//   · Solicitar aprobación: se elige la forma real y el motivo; el crédito sigue
//     debiendo hasta que alguien firme. Un comprobante a nombre de otro también
//     va a aprobación solo.
//
// El servidor (`creditos-erp`) vuelve a validar el monto contra el saldo REAL
// de la caja antes de escribir. El formulario guarda borrador: la sesión se
// cierra sola y nadie vuelve a escribir un comprobante entero.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { fetchCreditosDelCliente, fetchCreditosReservados, fetchPosProveedores, leerPagoDeCredito, pagarCreditos } from '@nucleo/data/creditos';
import {
  aplicacionesDelPago, APROBACION, estadoDelCobro, FORMAS_DE_COBRO, FORMAS_REALES, MOTIVO_DEL_FRENO,
  repartoDelMasViejo, repartoDesdeElComprobante, ROTULO_DE_FORMA, sumaDeSaldos,
} from '@nucleo/utils/abonoDeCredito';
import { hastaElTope } from '@nucleo/utils/hastaElTope';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fotos, { subirFotos } from '../componentes/formulario/Fotos';
import Fecha from '../componentes/formulario/Fecha';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo as avisarListo, trabajando } from '../componentes/Progreso';

const corta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: '2-digit' }) : '');

export default function CobrarCredito() {
  const p = useLocalSearchParams();
  const credito = useMemo(() => ({
    id: Number(p.id), credito: p.credito, documento: p.documento, fecha: p.fecha, cliente: p.cliente,
    saldo: Number(p.saldo) || 0, total: Number(p.total) || 0, dias: p.dias === '' ? null : Number(p.dias),
  }), [p.id, p.credito, p.documento, p.fecha, p.cliente, p.saldo, p.total, p.dias]);
  const sala = Number(p.sala);
  const claveBorrador = `abono_de_credito:${credito.id}`;

  const [forma, setForma] = useState('Efectivo');
  const [formaReal, setFormaReal] = useState('Transferencia');
  const [motivo, setMotivo] = useState('');
  const [montoDoc, setMontoDoc] = useState('');
  const [topeado, setTopeado] = useState(false);
  const [documento, setDocumento] = useState('');
  const [fechaDoc, setFechaDoc] = useState('');
  const [pos, setPos] = useState('');
  const [fotos, setFotos] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [errorLectura, setErrorLectura] = useState(null);
  const [hermanos, setHermanos] = useState([]);
  const [posDisponibles, setPosDisponibles] = useState([]);
  const [repartir, setRepartir] = useState(false);
  const [reparto, setReparto] = useState({ [credito.id]: '' });
  const [quitados, setQuitados] = useState(() => new Set());
  const [enviando, setEnviando] = useState(false);
  // Un crédito con un cobro esperando firma se ve igual que uno libre: sin esta
  // comprobación se cobraría dos veces. Si no se pudo leer, no se cobra.
  const [reserva, setReserva] = useState('leyendo');   // leyendo | libre | ocupado | sin-leer

  useEffect(() => {
    let vivo = true;
    Promise.all([fetchCreditosDelCliente(credito.id), fetchPosProveedores(), fetchCreditosReservados(sala)]).then(([otros, prov, res]) => {
      if (!vivo) return;
      setReserva(!res?.ok ? 'sin-leer' : res.porCredito.has(`${sala}:${credito.credito}`) ? 'ocupado' : 'libre');
      setHermanos(otros || []);
      setPosDisponibles(prov || []);
    });
    // El borrador se ofrece, no se impone: puede ser de otro intento.
    const b = loadDraft(claveBorrador);
    if (b && (b.forma !== 'Efectivo' || Object.values(b.reparto || {}).some((v) => String(v).trim()))) {
      Alert.alert('Hay un cobro a medias', 'Quedó un cobro sin terminar para este crédito. ¿Lo recuperas?', [
        { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearDraft(claveBorrador) },
        { text: 'Recuperar', onPress: () => {
          setForma(b.forma || 'Efectivo'); setFormaReal(b.formaReal || 'Transferencia'); setMotivo(b.motivo || '');
          setMontoDoc(b.montoDoc || ''); setDocumento(b.documento || ''); setFechaDoc(b.fechaDoc || ''); setPos(b.pos || '');
          setRepartir(!!b.repartir); setReparto(b.reparto || { [credito.id]: '' }); setQuitados(new Set(b.quitados || []));
        } },
      ]);
    }
    return () => { vivo = false; };
  }, [credito.id, credito.credito, sala, claveBorrador]);

  useEffect(() => {
    saveDraft(claveBorrador, { forma, formaReal, motivo, montoDoc, documento, fechaDoc, pos, repartir, reparto, quitados: [...quitados] });
  }, [claveBorrador, forma, formaReal, motivo, montoDoc, documento, fechaDoc, pos, repartir, reparto, quitados]);

  const otros = useMemo(() => hermanos.filter((h) => String(h.id) !== String(credito.id)), [hermanos, credito.id]);
  const lista = useMemo(() => (repartir && hermanos.length
    ? hermanos.filter((h) => String(h.id) === String(credito.id) || !quitados.has(String(h.id)))
    : [credito]), [repartir, hermanos, credito, quitados]);
  const debeTodo = sumaDeSaldos(hermanos, credito);
  const e = estadoDelCobro({ forma, montoDoc, reparto, creditos: lista, lectura, hayArchivo: fotos.length > 0, motivo });

  const cambiarForma = (v) => {
    setForma(v);
    if (v === 'Efectivo') setRepartir(false);
    setFotos([]); setLectura(null); setErrorLectura(null);
    setDocumento(''); setFechaDoc(''); setPos(''); setMontoDoc(''); setMotivo(''); setTopeado(false);
  };

  const alCambiarFotos = useCallback(async (nuevas) => {
    setFotos(nuevas); setLectura(null); setErrorLectura(null);
    const f = nuevas[0];
    if (!f) return;
    setLeyendo(true);
    const r = await leerPagoDeCredito(f, { forma, saldo: sumaDeSaldos(hermanos, credito) });
    setLeyendo(false);
    if (r?.error) { setErrorLectura(mensajeAmigable(r.error)); return; }
    setLectura(r);
    if (r.sugerido?.monto != null) {
      setMontoDoc(String(r.sugerido.monto));
      const d = repartoDesdeElComprobante(r.sugerido.monto, credito, otros);
      if (d.repartir) setRepartir(true);
      setReparto(d.reparto);
    }
    if (r.sugerido?.fecha) setFechaDoc(r.sugerido.fecha);
    if (r.sugerido?.documento) setDocumento(String(r.sugerido.documento));
    if (r.sugerido?.pos) setPos(r.sugerido.pos);
  }, [forma, hermanos, credito, otros]);

  const escribirMonto = (v) => {
    const r = hastaElTope(v.replace(/[^\d.,]/g, '').replace(',', '.'), debeTodo);
    setMontoDoc(r.valor); setTopeado(r.topeado);
  };
  const quitar = (id) => {
    const q = new Set(quitados).add(String(id));
    setReparto((r) => { const { [id]: _fuera, ...resto } = r; return resto; });
    if (!otros.some((o) => !q.has(String(o.id)))) { setQuitados(new Set()); setRepartir(false); } else setQuitados(q);
  };

  const cobrar = () => {
    const resumen = `${credito.cliente} · ${formatMoney(e.iraAprobacion && e.conPapel ? e.totalPago : e.sumaRepartida)}`;
    Alert.alert(e.iraAprobacion ? '¿Enviar a aprobación?' : '¿Registrar el pago?',
      e.iraAprobacion ? `${resumen}. El crédito sigue con saldo hasta que lo confirmen.` : `${resumen}. Un abono no se puede deshacer.`, [
        { text: 'Revisar', style: 'cancel' },
        { text: e.iraAprobacion ? 'Enviar' : 'Cobrar', onPress: enviar },
      ]);
  };
  const enviar = async () => {
    setEnviando(true); trabajando(e.iraAprobacion ? 'Enviando a aprobación…' : 'Registrando el pago…');
    try {
      let comprobanteUrl = null;
      if (fotos.length) {
        try { comprobanteUrl = (await subirFotos(fotos, { bucket: 'payment-proofs', carpeta: `abonos-credito/${sala}` }))[0] ?? null; } catch { comprobanteUrl = null; }
      }
      const r = await pagarCreditos({
        sala, forma: e.pideAprobacion ? formaReal : forma, documento: documento.trim(),
        montoDocumento: Number(e.totalPago.toFixed(2)), aplicaciones: aplicacionesDelPago(lista, reparto),
        comprobanteUrl, lectura: lectura || null, fechaDocumento: fechaDoc || null, pos: pos || null,
        motivo: motivo.trim() || null, requiereAprobacion: e.iraAprobacion,
      });
      if (r?.error || (r?.ok === false && !r?.aviso)) throw (r.error || new Error(r?.motivo || r?.mensaje || 'No se pudo cobrar.'));
      clearDraft(claveBorrador);
      if (r.aviso) fallo('El pago quedó a medias', r.aviso);
      else if (r.aprobacionPedida) avisarListo('Queda esperando aprobación', `${credito.cliente} · ${formatMoney(e.totalPago)}`);
      else avisarListo('Pago registrado', `${credito.cliente} · ${formatMoney(r.aplicado)} en ${r.aplicaciones?.length || 1} crédito${(r.aplicaciones?.length || 1) === 1 ? '' : 's'}`);
      router.back();
    } catch (err) {
      fallo('No se pudo cobrar', mensajeAmigable(err, 'Vuelve a intentar en un momento.'));
    } finally {
      setEnviando(false);
    }
  };

  const yaPago = Math.max(0, credito.total - credito.saldo);
  const mostrarMontos = !e.conPapel || (lectura && !e.bloqueado);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Recibir un pago' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Vidrio radio={24}>
            <View style={{ padding: 18, gap: 6 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{credito.cliente}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[credito.documento, corta(credito.fecha)].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(credito.saldo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>debe</Text>
              </View>
              {yaPago > 0.004 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatMoney(yaPago)} pagados de ${formatMoney(credito.total)}`}</Text> : null}
              {otros.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Tiene ${hermanos.length} créditos en esta sala: ${formatMoney(debeTodo)} en total.`}</Text> : null}
            </View>
          </Vidrio>

          <Seccion titulo="Con qué paga">
            <Opciones opciones={FORMAS_DE_COBRO.map((f) => ({ id: f, label: ROTULO_DE_FORMA[f] || f }))} valor={forma} onCambiar={cambiarForma} />
          </Seccion>

          {e.conPapel ? (
            <Seccion titulo={`Comprobante (${forma.toLowerCase()})`} pie="Una foto del comprobante o de la pantalla del banco. Se lee sola.">
              <Fotos fotos={fotos} onCambiar={alCambiarFotos} max={1} />
            </Seccion>
          ) : null}
          {leyendo ? <Aviso tono="nota" texto="Leyendo el comprobante…" /> : null}
          {errorLectura ? <Aviso tono="cuidado" texto={`No se pudo leer el comprobante: ${errorLectura} Vuelve a intentarlo con otra foto.`} /> : null}
          {e.bloqueado ? <Aviso tono="freno" texto={MOTIVO_DEL_FRENO[lectura.veredicto] || 'El comprobante no se pudo dar por bueno.'} /> : null}
          {!e.bloqueado && lectura?.nombreSinReconocer ? (
            <Aviso tono="cuidado" texto={`${lectura.leido?.beneficiario ? `El comprobante está a nombre de «${lectura.leido.beneficiario}», que no es la empresa.` : 'El comprobante no dice a quién se le pagó.'} El cobro se va a registrar esperando aprobación: el crédito sigue con saldo hasta que confirmen que el pago entró.`} />
          ) : null}
          {lectura && !e.bloqueado && (lectura.avisos || []).length ? <Aviso tono="cuidado" texto={lectura.avisos.join(' ')} /> : null}

          {e.pideAprobacion ? (
            <Seccion titulo="Forma de pago" pie="El cobro queda esperando aprobación. El crédito sigue con saldo hasta que lo confirmen.">
              <Opciones opciones={FORMAS_REALES} valor={formaReal} onCambiar={setFormaReal} />
              <Campo value={motivo} onChangeText={setMotivo} placeholder="Motivo — p. ej. ISSS, planilla de agosto" />
            </Seccion>
          ) : null}

          {mostrarMontos && e.conPapel ? (
            <Seccion titulo="El comprobante" pie={otros.length ? `Deuda total: ${formatMoney(debeTodo)} en ${hermanos.length} créditos` : `Debe ${formatMoney(debeTodo)}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Monto</Text>
                <View style={{ minWidth: 140 }}><Campo multiline={false} value={montoDoc} onChangeText={escribirMonto} keyboardType="decimal-pad" placeholder="$0.00" style={{ textAlign: 'center' }} /></View>
              </View>
              <Fecha valor={fechaDoc || null} onCambiar={setFechaDoc} />
              <Campo multiline={false} value={documento} onChangeText={setDocumento} maxLength={40} placeholder="Número del comprobante" autoCapitalize="characters" />
              {forma === 'Tarjeta' && posDisponibles.length ? (
                <Opciones opciones={posDisponibles.map((x) => ({ id: x.codigo, label: x.nombre }))} valor={pos} onCambiar={setPos} />
              ) : null}
            </Seccion>
          ) : null}
          {topeado ? <Aviso tono="cuidado" texto={`${credito.cliente} debe ${formatMoney(debeTodo)} en total, así que el monto se ajustó a esa cifra. Un pago por más de la deuda no se puede registrar.`} /> : null}

          {mostrarMontos ? (
            <Seccion titulo={repartir ? 'A qué créditos se aplica' : 'Cuánto se le abona'}>
              {lista.map((h, i) => {
                const esEste = String(h.id) === String(credito.id);
                const puesto = Number(reparto[h.id]) || 0;
                const debe = Number(h.saldo) || 0;
                const queda = Math.max(0, debe - puesto);
                const excede = puesto > debe + 0.004;
                return (
                  <View key={h.id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    {lista.length > 1 ? (
                      <Text style={{ color: esEste ? MARCA.azulClaro : colorSistema.texto, fontSize: 14, fontWeight: esEste ? '700' : '500' }}>
                        {`${corta(h.fecha)} · ${h.documento}${h.dias != null ? ` · ${h.dias} d` : ''}`}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: excede ? MARCA.rojo : puesto > 0.004 && queda <= 0.004 ? MARCA.verde : colorSistema.texto2, fontSize: 14 }}>
                        {excede ? `Más de lo que debe (${formatMoney(debe)})` : puesto <= 0.004 ? `debe ${formatMoney(debe)}` : queda <= 0.004 ? 'Queda solvente' : `queda ${formatMoney(queda)} de ${formatMoney(debe)}`}
                      </Text>
                      <View style={{ minWidth: 104 }}>
                        <Campo multiline={false} value={reparto[h.id] ?? ''} keyboardType="decimal-pad" placeholder="0.00" style={{ textAlign: 'center' }}
                          onChangeText={(v) => setReparto((r) => ({ ...r, [h.id]: hastaElTope(v.replace(/[^\d.,]/g, '').replace(',', '.'), debe).valor }))} />
                      </View>
                      <Pressable onPress={() => setReparto((r) => ({ ...r, [h.id]: debe.toFixed(2) }))} hitSlop={6}
                        style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, opacity: pressed ? 0.5 : 1 })}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Todo</Text>
                      </Pressable>
                      {!esEste ? (
                        <Pressable onPress={() => quitar(h.id)} hitSlop={6} accessibilityLabel={`Quitar ${h.documento}`}
                          style={({ pressed }) => ({ minHeight: 44, minWidth: 32, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                          <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>✕</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              {e.conPapel && repartir && e.totalPago > 0 ? (
                <Pressable onPress={() => setReparto(repartoDelMasViejo(e.totalPago, [credito, ...otros.filter((o) => !quitados.has(String(o.id)))]))}
                  style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Repartir del más viejo</Text>
                </Pressable>
              ) : null}
              {forma !== 'Efectivo' && otros.length && !repartir ? (
                <Pressable onPress={() => { setQuitados(new Set()); setRepartir(true); }}
                  style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Abonar también a otra cuenta (${otros.length})`}</Text>
                </Pressable>
              ) : null}
              <View style={{ flexDirection: 'row', paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>{e.conPapel ? 'Va aplicado' : 'Total a cobrar'}</Text>
                <Text style={{ color: e.cuadra || !e.conPapel ? colorSistema.texto : MARCA.rojo, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {`${formatMoney(e.sumaRepartida)}${e.conPapel && e.totalPago > 0 ? ` de ${formatMoney(e.totalPago)}` : ''}`}
                </Text>
              </View>
            </Seccion>
          ) : null}
          {e.descuadre ? <Aviso tono="cuidado" texto={e.descuadre.faltan != null ? `Faltan ${formatMoney(e.descuadre.faltan)} por aplicar.` : `Sobran ${formatMoney(e.descuadre.sobran)} sobre el comprobante.`} /> : null}
          {forma === 'Efectivo' ? <Aviso tono="nota" texto="El efectivo entra al cajón y cuenta para el corte del día." /> : null}

          {reserva === 'ocupado' ? <Aviso tono="freno" texto="Este crédito ya tiene un cobro esperando aprobación." /> : null}
          {reserva === 'sin-leer' ? <Aviso tono="freno" texto="No se pudo comprobar qué créditos están en aprobación. Por precaución no se puede cobrar: vuelve a entrar en un momento." /> : null}
          <BotonGrande texto={enviando ? 'Enviando…' : e.iraAprobacion ? 'Enviar a aprobación' : 'Cobrar'} color={MARCA.verde}
            deshabilitado={enviando || leyendo || !e.listo || reserva !== 'libre'} onPress={cobrar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
