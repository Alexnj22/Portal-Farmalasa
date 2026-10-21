// Facturación · No efectivo, NATIVO — `TabNoEfectivo` del portal: las ventas
// con tarjeta, transferencia, cheque, crédito o bitcoin del mes, agrupadas por
// forma de pago, que alguien tiene que CONFIRMAR que de verdad entraron.
//
// Confirmar: con nota y, si se quiere, el comprobante: foto (cámara o
// galería) o un PDF, como el portal (`image/*,application/pdf`). Si la foto no sube, NO se confirma — decisión del usuario del
// 2026-09-26 en el portal: antes el pago quedaba «confirmado» sin el
// comprobante que se adjuntó y nadie lo sabía. Lo escribe
// `insertPaymentConfirmation`, la misma función del portal, que deja su
// renglón en la bitácora.
//
// Debajo, «N confirmados»: la misma tabla del portal (`CONFIRMED_COLS`) — forma
// de pago, documento, sala, cliente, fecha, total, quién confirmó y cuándo, la
// nota y el comprobante adjunto (se abre firmado al momento), con los filtros
// por forma de pago y por sala.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Platform, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { fetchInvoicesByIds, fetchNonCashInvoices, fetchPaymentConfirmationIds, fetchPaymentConfirmationsHistorial, insertPaymentConfirmation } from '@nucleo/data/facturacion';
import { NON_CASH_TYPES } from '@nucleo/utils/colasDeFacturacion';
import { openStoredFile, signPhotosDeep, subirArchivo } from '@nucleo/utils/storageFiles';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
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
import Avatar from '../Avatar';

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

async function elegirPdf() {
  const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'application/pdf', ext: 'pdf', nombre: a.name || 'comprobante.pdf' };
}

// Una pregunta con sus opciones: la hoja de acciones en iOS, el diálogo en Android.
function elegirUna(titulo, opciones, alElegir) {
  const textos = opciones.map((o) => o.label);
  if (Platform.OS !== 'web') { // en Android lo dibuja HojasAndroid: Alert sólo muestra 3 botones
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: [...textos, 'Cancelar'], cancelButtonIndex: textos.length },
      (i) => { if (i < textos.length) alElegir(opciones[i].id); });
  } else {
    Alert.alert(titulo, '', [...opciones.map((o) => ({ text: o.label, onPress: () => alElegir(o.id) })), { text: 'Cancelar', style: 'cancel' }]);
  }
}

async function facturasPorId(ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await fetchInvoicesByIds(ids.slice(i, i + 200), 'id, correlativo, branch_id, tipo_documento, cliente, fecha, total, tipo_pago');
    if (error) throw error;
    for (const f of data || []) mapa[f.id] = f;
  }
  return mapa;
}

const PAGINA_CONF = 25;

export default function NoEfectivo({ sala, nombreSala, salas = [], texto, canEdit, user, verMontos }) {
  const [mes, setMes] = useState(mesSV());
  const [pend, setPend] = useState(null);
  const [confirmadas, setConfirmadas] = useState(new Set());
  const [historial, setHistorial] = useState([]);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [nota, setNota] = useState('');
  const [foto, setFoto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verConfirmados, setVerConfirmados] = useState(false);
  const [confTipo, setConfTipo] = useState('');
  const [confSala, setConfSala] = useState('');
  const [confPaginas, setConfPaginas] = useState(1);
  const [facturasConf, setFacturasConf] = useState(null);

  const cargar = useCallback(async () => {
    const [inv, ids, h] = await Promise.all([fetchNonCashInvoices(sala, `${mes}-01`, finDeMes(mes), NON_CASH_TYPES), fetchPaymentConfirmationIds(), fetchPaymentConfirmationsHistorial()]);
    setError(inv === null ? 'No se pudo leer la lista completa.' : (ids.error?.message || h.error?.message || null));
    setPend(Array.isArray(inv) ? inv : (inv?.data || []));
    setConfirmadas(new Set((ids.data || []).map((r) => r.invoice_id)));
    setHistorial(await signPhotosDeep(h.data || []).catch(() => h.data || []));
    setFacturasConf(null);
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

  // Los documentos de los confirmados se leen al abrir la sección, no antes:
  // son los de toda la historia y casi nunca se miran.
  useEffect(() => {
    if (!verConfirmados || facturasConf) return;
    facturasPorId([...new Set(historial.map((h) => h.invoice_id))]).then(setFacturasConf).catch(() => setFacturasConf({}));
  }, [verConfirmados, facturasConf, historial]);
  useEffect(() => { setConfPaginas(1); }, [confTipo, confSala]);
  const confirmadosFiltrados = useMemo(() => historial
    .filter((h) => !confTipo || String(h.tipo_pago || '').toLowerCase() === confTipo)
    .filter((h) => !confSala || String(h.branch_id) === confSala), [historial, confTipo, confSala]);
  const confVisibles = confirmadosFiltrados.slice(0, confPaginas * PAGINA_CONF);

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
                      {foto?.ext === 'pdf' ? <Pildora texto={`PDF · ${foto.nombre}`} color={MARCA.azulClaro} />
                        : foto ? <Image source={{ uri: foto.uri }} style={{ width: 96, height: 96, borderRadius: 12 }} /> : null}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}><BotonGrande texto="Foto" borde color={MARCA.azulClaro} onPress={async () => { const f = await elegirFoto(true); if (f) setFoto(f); }} /></View>
                        <View style={{ flex: 1 }}><BotonGrande texto="Galería" borde color={MARCA.azulClaro} onPress={async () => { const f = await elegirFoto(false); if (f) setFoto(f); }} /></View>
                        <View style={{ flex: 1 }}><BotonGrande texto="PDF" borde color={MARCA.azulClaro} onPress={async () => { const f = await elegirPdf().catch(() => null); if (f) setFoto(f); }} /></View>
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

      {historial.length ? (
        <View style={{ marginHorizontal: 16, gap: 8, marginTop: 8 }}>
          <Tocable onPress={() => setVerConfirmados((v) => !v)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
              {`${verConfirmados ? '▾' : '▸'} ${historial.length} confirmado${historial.length === 1 ? '' : 's'}`}
            </Text>
          </Tocable>
          {verConfirmados ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Tocable onPress={() => elegirUna('Forma de pago', [{ id: '', label: 'Todas las formas' }, ...NON_CASH_TYPES.map((t) => ({ id: t, label: ROTULO[t] ?? t }))], setConfTipo)}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Pildora texto={`${confTipo ? ROTULO[confTipo] ?? confTipo : 'Todas las formas'} ▾`} color={confTipo ? MARCA.azulClaro : colorSistema.texto2} />
                </Tocable>
                <Tocable onPress={() => elegirUna('Sala', [{ id: '', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))], setConfSala)}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Pildora texto={`${confSala ? nombreSala(confSala) : 'Todas las salas'} ▾`} color={confSala ? MARCA.azulClaro : colorSistema.texto2} />
                </Tocable>
                {confTipo || confSala ? (
                  <Tocable onPress={() => { setConfTipo(''); setConfSala(''); }} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Limpiar</Text>
                  </Tocable>
                ) : null}
              </View>
              {confTipo || confSala ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${confirmadosFiltrados.length} de ${historial.length}`}</Text> : null}
              {facturasConf == null ? <ActivityIndicator /> : confVisibles.map((h) => {
                const f = facturasConf[h.invoice_id];
                const t = String(h.tipo_pago || '').toLowerCase();
                return (
                  <Vidrio key={h.id} radio={16}>
                    <View style={{ padding: 12, gap: 4 }}>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${f?.tipo_documento ?? ''} ${f?.correlativo ?? '—'}`}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{verMontos && f ? formatMoney(f.total) : '—'}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[f?.cliente || 'Sin cliente', nombreSala(h.branch_id), f?.fecha ? fechaTexto(f.fecha, { day: 'numeric', month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ')}</Text>
                      <Pildora texto={ROTULO[t] ?? h.tipo_pago ?? '—'} color={MARCA.azulClaro} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <Avatar empleado={{ name: h.confirmed_by, photo: h.confirmed_by_photo }} tamano={26} />
                        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12 }}>
                          {`${h.confirmed_by ? shortEmployeeName({ name: h.confirmed_by }) : '—'}${h.confirmed_at ? ` · ${fechaHora12(h.confirmed_at, { month: 'short', day: '2-digit' })}` : ''}`}
                        </Text>
                      </View>
                      {h.notes ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`«${h.notes}»`}</Text> : null}
                      {h.proof_url ? (
                        <Tocable onPress={() => Promise.resolve(openStoredFile(h.proof_url)).catch((e) => fallo('No se pudo abrir el comprobante', e?.message ?? String(e)))}
                          style={{ minHeight: 44, justifyContent: 'center' }}>
                          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Ver el comprobante ›</Text>
                        </Tocable>
                      ) : <Text style={{ color: colorSistema.texto2, fontSize: 12, fontStyle: 'italic' }}>Sin comprobante</Text>}
                    </View>
                  </Vidrio>
                );
              })}
              {facturasConf && confirmadosFiltrados.length > confVisibles.length ? (
                <BotonGrande texto={`Ver más · quedan ${confirmadosFiltrados.length - confVisibles.length}`} borde color={MARCA.azulClaro} onPress={() => setConfPaginas((p) => p + 1)} />
              ) : null}
              {facturasConf && !confirmadosFiltrados.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin pagos confirmados con ese filtro.</Text> : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
