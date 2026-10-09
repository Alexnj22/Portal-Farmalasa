// La cola de revisión de facturas de compra, NATIVA — la pestaña «Revisión» de
// `FacturasCompraView`: lo que llegó por correo y no se pudo emparejar solo
// (un PDF sin su JSON, un JSON inválido, un ZIP sin abrir, un aviso de
// invalidación). Por cada uno, lo mismo que el portal:
//   · ver el archivo (`facturas_compra_abrir`);
//   · emparejarlo con un documento existente (buscado en los últimos 90 días);
//   · clasificarlo (aviso de anulación u otro relacionado) y vincularlo;
//   · confirmar un PDF aunque nunca llegue su JSON, o descartarlo.
// Arriba, «Buscar correos» trae lo nuevo del buzón (`buscarCorreosDeCompras`).
//
// La detección del código dentro del PDF (leerlo con el lector del navegador)
// sigue en el portal; acá se empareja eligiendo el documento.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { buscarCorreosDeCompras, classifyPurchaseDteReview, fetchPurchaseDteDocuments, fetchPurchaseDteReviewQueue, resolvePurchaseDteReview } from '@nucleo/data/facturasCompra';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../../componentes/Progreso';

const TIPO = { orphan_pdf: ['PDF sin JSON', MARCA.azulClaro], invalidacion_pendiente: ['Invalidación pendiente', MARCA.violetaClaro], orphan_zip: ['ZIP sin abrir', MARCA.ambar] };
const CLASIFICAR = [{ id: 'anulacion', label: 'Aviso de anulación — marca el DTE como invalidado' }, { id: 'otro', label: 'Otro documento relacionado — sólo vincula' }];
const isoHaceDias = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };

function Accion({ texto, color = MARCA.azulClaro, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

// Elegir el documento al que corresponde el archivo.
function ElegirDocumento({ documentos, sugerido, onElegir, onCancelar }) {
  const [q, setQ] = useState(sugerido ?? '');
  const lista = useMemo(() => (q.trim().length >= 2 ? documentos.filter((d) => tokenMatch(q, d.supplier_nombre, d.emisor_nombre, d.codigo_generacion, d.numero_control)) : []).slice(0, 8), [q, documentos]);
  return (
    <View style={{ gap: 6 }}>
      <Campo multiline={false} value={q} onChangeText={setQ} placeholder="Proveedor o código de generación" autoFocus />
      {documentos.length === 0 ? <ActivityIndicator /> : lista.map((d) => (
        <Pressable key={d.id} onPress={() => onElegir(d)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${d.supplier_nombre || d.emisor_nombre || '—'} · ${formatMoney(d.monto_total)}`}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${fechaNumerica(d.fecha_emision, { anio: 'corto' })} · ${d.codigo_generacion ?? 'sin código'}`}</Text>
        </Pressable>
      ))}
      <Accion texto="Cancelar" color={colorSistema.texto2} onPress={onCancelar} />
    </View>
  );
}

export default function RevisionDeFacturas() {
  const { hasPermission } = useAuth();
  const puede = hasPermission('facturas_compra', 'can_edit');
  const abrir = hasPermission('facturas_compra_abrir');
  const [filas, setFilas] = useState(null);
  const [documentos, setDocumentos] = useState([]);
  const [busca, setBusca] = useState('');
  const [abierta, setAbierta] = useState(null);   // { id, modo: 'emparejar' | 'clasificar', tipo }
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setFilas(await fetchPurchaseDteReviewQueue('pendiente')); } catch (e) { fallo('No se pudo cargar la cola', mensajeAmigable(e)); setFilas((f) => f ?? []); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => {
    if (!abierta || documentos.length) return;
    Promise.resolve(fetchPurchaseDteDocuments(isoHaceDias(90), isoHaceDias(-1))).then(setDocumentos).catch((e) => fallo('No se pudieron traer los documentos', mensajeAmigable(e)));
  }, [abierta, documentos.length]);

  const visibles = useMemo(() => (busca.trim() ? (filas ?? []).filter((r) => tokenMatch(busca, r.from_email, r.subject, r.filename, r.reason)) : (filas ?? [])), [filas, busca]);

  const hacer = async (fn, titulo) => {
    try { await fn(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); listo(titulo, ''); setAbierta(null); await cargar(); }
    catch (e) { fallo('No se pudo', mensajeAmigable(e)); }
  };
  const confirmar = (titulo, texto, accion, fn) => Alert.alert(titulo, texto, [{ text: 'Cancelar', style: 'cancel' }, { text: accion, onPress: () => hacer(fn, titulo) }]);

  const buscarCorreos = async () => {
    trabajando('Buscando en el buzón…');
    try {
      const { insertados, quedaMas } = await buscarCorreosDeCompras({ maxTandas: 10, onTanda: (n) => { if (n > 1) trabajando(`Buscando… tanda ${n}`); } });
      cerrarProgreso();
      listo('Búsqueda completa', `${insertados} documento${insertados === 1 ? '' : 's'} nuevo${insertados === 1 ? '' : 's'}${quedaMas ? ' (quedó más: corre de nuevo)' : ''}.`);
      await cargar();
    } catch (e) { fallo('No se pudo buscar', mensajeAmigable(e)); }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Revisión', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Correo, asunto o archivo', onChangeText: (e) => setBusca(e.nativeEvent.text) } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {puede ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Buscar correos nuevos" borde onPress={buscarCorreos} /></View> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{filas == null ? 'Cargando…' : `${visibles.length} pendiente${visibles.length === 1 ? '' : 's'} de revisión`}</Text>
        {filas == null ? <ActivityIndicator /> : !visibles.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sin pendientes de revisión." /></View> : visibles.map((r) => {
          const [rot, color] = TIPO[r.kind] ?? ['JSON inválido', MARCA.ambar];
          const sugerido = r.ai_suggested?.invalida_codigo_generacion ?? r.ai_suggested?.detected_codigo_generacion ?? null;
          const esta = abierta?.id === r.id ? abierta : null;
          return (
            <View key={r.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.filename}</Text>
                    <Pildora texto={rot} color={color} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[r.received_at ? `${fechaTexto(r.received_at, { day: 'numeric', month: 'short' })} ${hora12(r.received_at)}` : null, r.from_email].filter(Boolean).join(' · ')}</Text>
                  {r.reason ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.reason}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                    {abrir && r.file_path ? <Accion texto="Ver archivo" onPress={() => Promise.resolve(openStoredFile(r.file_path)).catch(() => {})} /> : null}
                    {puede && r.kind === 'orphan_pdf' ? <Accion texto="Emparejar" onPress={() => setAbierta({ id: r.id, modo: 'emparejar' })} /> : null}
                    {puede && (r.kind === 'orphan_pdf' || r.kind === 'invalidacion_pendiente') ? <Accion texto="Clasificar" color={MARCA.violetaClaro} onPress={() => setAbierta({ id: r.id, modo: 'clasificar', tipo: 'anulacion' })} /> : null}
                    {puede && r.kind === 'orphan_pdf' ? <Accion texto="Confirmar sin JSON" color={MARCA.verde}
                      onPress={() => confirmar('Confirmar sin JSON', 'Crea el documento aunque nunca llegue su JSON (queda con la insignia «Sin JSON»).', 'Confirmar', () => resolvePurchaseDteReview(r.id, 'confirmado', null, { kind: r.kind, filename: r.filename, desde: 'app' }))} /> : null}
                    {puede ? <Accion texto="Descartar" color={MARCA.rojo}
                      onPress={() => confirmar('Descartar', r.filename, 'Descartar', () => resolvePurchaseDteReview(r.id, 'descartado', null, { kind: r.kind, filename: r.filename, desde: 'app' }))} /> : null}
                  </View>
                  {esta?.modo === 'clasificar' ? (
                    <View style={{ gap: 6 }}>
                      {CLASIFICAR.map((c) => (
                        <Pressable key={c.id} onPress={() => setAbierta({ ...esta, tipo: c.id })} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 18, color: esta.tipo === c.id ? MARCA.violetaClaro : colorSistema.texto2 }}>{esta.tipo === c.id ? '●' : '○'}</Text>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13 }}>{c.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {esta ? (
                    <ElegirDocumento documentos={documentos} sugerido={sugerido} onCancelar={() => setAbierta(null)}
                      onElegir={(d) => (esta.modo === 'emparejar'
                        ? confirmar('Emparejar', `${r.filename} → ${d.supplier_nombre || d.emisor_nombre} · ${formatMoney(d.monto_total)}`, 'Emparejar', () => resolvePurchaseDteReview(r.id, 'emparejado', d.id, { filename: r.filename, desde: 'app' }))
                        : confirmar('Clasificar', `${CLASIFICAR.find((c) => c.id === esta.tipo)?.label} → ${d.supplier_nombre || d.emisor_nombre} · ${formatMoney(d.monto_total)}`, 'Clasificar', () => classifyPurchaseDteReview(r.id, d.id, esta.tipo, null, { filename: r.filename, desde: 'app' })))} />
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}
