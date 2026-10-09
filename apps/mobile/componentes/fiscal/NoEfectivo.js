// Facturación · No efectivo, NATIVO — `TabNoEfectivo` del portal: las ventas
// con tarjeta, transferencia, cheque, crédito o bitcoin del mes, agrupadas por
// forma de pago, que alguien tiene que CONFIRMAR que de verdad entraron.
//
// Confirmar: con nota y, si se quiere, una foto del comprobante (cámara o
// galería). Si la foto no sube, NO se confirma — decisión del usuario del
// 2026-09-26 en el portal: antes el pago quedaba «confirmado» sin el
// comprobante que se adjuntó y nadie lo sabía. Lo escribe
// `insertPaymentConfirmation`, la misma función del portal, que deja su
// renglón en la bitácora.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { fetchNonCashInvoices, fetchPaymentConfirmationIds, fetchPaymentConfirmationsHistorial, insertPaymentConfirmation } from '@nucleo/data/facturacion';
import { NON_CASH_TYPES } from '@nucleo/utils/colasDeFacturacion';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import PasoDeMes from '../PasoDeMes';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';
import Tocable from '../Tocable';

const ROTULO = { tarjeta: 'Tarjeta', credito: 'Crédito', transferencia: 'Transferencia', bitcoin: 'Bitcoin', cheque: 'Cheque' };
const finDeMes = (mes) => { const [a, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };

async function elegirFoto(camara) {
  const permiso = camara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) { Alert.alert('Sin permiso', camara ? 'La app necesita la cámara.' : 'La app necesita tus fotos.'); return null; }
  const op = { mediaTypes: ['images'], quality: 0.6 };
  const r = camara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'image/jpeg', ext: (a.fileName?.split('.').pop() || 'jpg').toLowerCase() };
}

export default function NoEfectivo({ sala, nombreSala, texto, canEdit, user, verMontos }) {
  const [mes, setMes] = useState(mesSV());
  const [pend, setPend] = useState(null);
  const [confirmadas, setConfirmadas] = useState(new Set());
  const [historial, setHistorial] = useState([]);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [nota, setNota] = useState('');
  const [foto, setFoto] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const [inv, ids, h] = await Promise.all([fetchNonCashInvoices(sala, `${mes}-01`, finDeMes(mes), NON_CASH_TYPES), fetchPaymentConfirmationIds(), fetchPaymentConfirmationsHistorial()]);
    setError(ids.error?.message || h.error?.message || null);
    setPend(Array.isArray(inv) ? inv : (inv?.data || []));
    setConfirmadas(new Set((ids.data || []).map((r) => r.invoice_id)));
    setHistorial(h.data || []);
  }, [sala, mes]);
  useEffect(() => { setPend(null); cargar(); }, [cargar]);

  const visibles = useMemo(() => (pend || []).filter((r) => !confirmadas.has(r.id))
    .filter((r) => !texto?.trim() || tokenMatch(texto.trim(), r.correlativo, r.cliente, r.tipo_pago)), [pend, confirmadas, texto]);
  const porTipo = useMemo(() => {
    const g = {};
    for (const r of visibles) { const t = String(r.tipo_pago || 'otro').toLowerCase(); (g[t] ||= []).push(r); }
    return Object.entries(g);
  }, [visibles]);
  const total = visibles.reduce((s, r) => s + Number(r.total || 0), 0);
  const delMes = historial.filter((h) => String(h.confirmed_at || '').startsWith(mes)).length;

  const confirmar = async (r) => {
    setGuardando(true);
    let proofUrl = null;
    if (foto) {
      try {
        const datos = await (await fetch(foto.uri)).arrayBuffer();
        proofUrl = await subirArchivo('payment-proofs', `invoices/${r.id}/${Date.now()}.${foto.ext}`, datos, { contentType: foto.tipo });
      } catch {
        fallo('No se pudo subir el comprobante', 'El pago no se confirmó. Revisa la conexión e intenta de nuevo.');
        setGuardando(false); return;
      }
    }
    const { error: e } = await insertPaymentConfirmation({
      invoice_id: r.id, confirmed_by: user?.name || user?.email || 'Desconocido', confirmed_by_photo: user?.photo_url || user?.photoRaw || null,
      notes: nota.trim() || null, proof_url: proofUrl, tipo_pago: r.tipo_pago, branch_id: r.branch_id,
    }, { correlativo: r.correlativo, desde: 'app' });
    setGuardando(false);
    if (e) { fallo('No se pudo confirmar', 'El pago no quedó registrado. Si sigue, tu rol no tiene permiso de edición en Facturación.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo('Pago confirmado', r.correlativo || '');
    setConfirmadas((s) => new Set([...s, r.id]));
    setAbierta(null); setNota(''); setFoto(null);
  };

  return (
    <View style={{ gap: 10 }}>
      <PasoDeMes mes={mes} onCambiar={setMes} />
      {pend ? (
        <FilaDeKpis>
          <Kpi icono="CreditCard" rotulo="Pendientes" valor={String(visibles.length)} color={visibles.length ? MARCA.ambar : MARCA.verde} apoyo="sin confirmar" />
          <Kpi icono="DollarSign" rotulo="Total pendiente" valor={verMontos ? formatMoney(total) : '—'} color={MARCA.violeta} apoyo={`${delMes} confirmados este mes`} />
        </FilaDeKpis>
      ) : null}
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {pend == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : porTipo.map(([t, filas]) => (
        <View key={t} style={{ gap: 8 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginHorizontal: 20 }}>{`${ROTULO[t] ?? t} · ${filas.length}`}</Text>
          {filas.map((r) => {
            const abierto = abierta === r.id;
            return (
              <View key={r.id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={18}>
                  <Tocable disabled={!canEdit} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abierto ? null : r.id); setNota(''); setFoto(null); }} style={{ padding: 12, gap: 4 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${r.tipo_documento ?? ''} ${r.correlativo ?? 'sin número'}`}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{verMontos ? formatMoney(r.total) : '—'}</Text>
                    </View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[r.cliente || 'Sin cliente', nombreSala(r.branch_id), r.fecha ? `${fechaTexto(r.fecha, { day: 'numeric', month: 'short' })}${r.hora ? ` ${String(r.hora).slice(0, 5)}` : ''}` : null].filter(Boolean).join(' · ')}</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}><Pildora texto={ROTULO[t] ?? t} color={MARCA.azulClaro} />{canEdit && !abierto ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>Confirmar ›</Text> : null}</View>
                  </Tocable>
                  {abierto ? (
                    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                      <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional): número de voucher, banco…" />
                      {foto ? <Image source={{ uri: foto.uri }} style={{ width: 96, height: 96, borderRadius: 12 }} /> : null}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}><BotonGrande texto="Foto" borde color={MARCA.azulClaro} onPress={async () => { const f = await elegirFoto(true); if (f) setFoto(f); }} /></View>
                        <View style={{ flex: 1 }}><BotonGrande texto="Galería" borde color={MARCA.azulClaro} onPress={async () => { const f = await elegirFoto(false); if (f) setFoto(f); }} /></View>
                      </View>
                      <BotonGrande texto={guardando ? 'Confirmando…' : 'Confirmar el pago'} color={MARCA.verde} deshabilitado={guardando} onPress={() => confirmar(r)} />
                    </View>
                  ) : null}
                </Vidrio>
              </View>
            );
          })}
        </View>
      ))}
      {pend && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Todo confirmado este mes</Text> : null}
    </View>
  );
}
