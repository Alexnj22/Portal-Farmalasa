// La ficha de una factura de compra, NATIVO — todo lo que el teléfono no dejaba
// ver (reporte de sala del 2026-08-20: «no puedo ver los productos, no puedo
// ver el pdf»): quién la emitió, sus números, LOS PRODUCTOS con cantidad y
// precio leídos del JSON del documento (`renglonesDelDte`), los totales, si el
// proveedor la anuló, sus notas de crédito, y el PDF y el JSON con el visor del
// teléfono (URL firmada al momento, `openStoredFile`). Si llegó sin proveedor,
// se vincula al maestro desde aquí (`setPurchaseDteProveedor`), como el
// «Emparejar» del portal.
//
// Si llegó «Sin JSON» (se confirmó desde Revisión con sólo el PDF), las dos
// salidas del portal: «Detectar código» lee el código de generación dentro
// del PDF y, si ya hay un documento con ese código, los une; «Adjuntar JSON»
// lo une con el duplicado que sí trajo el JSON, elegido a mano entre los del
// mes (los más cercanos al correo primero). Las dos con
// `mergePurchaseDteDocuments`, la misma función del portal.
//
// Si el proveedor la invalidó y la anulación vino con su respaldo, «Ver el
// documento de la anulación» abre ese PDF (`facturas_compra_abrir`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPurchaseDteDocuments, mergePurchaseDteDocuments, setPurchaseDteProveedor } from '@nucleo/data/facturasCompra';
import { fetchProveedoresMaestro } from '@nucleo/data/proveedores';
import { useAuth } from '@nucleo/context/AuthContext';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { getSignedFileUrl, openStoredFile } from '@nucleo/utils/storageFiles';
import { renglonesDelDte, totalesDelDte } from '@nucleo/utils/dteJson';
import { dteTypeLabel } from '@nucleo/utils/dteTypes';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, rangoDelMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { documentoGuardado, guardarDocumentos } from '../../componentes/compras/documentos';
import { fallo, listo } from '../../componentes/Progreso';
import DetectarCodigo from '../../componentes/compras/DetectarCodigo';

const cant = (n) => (n == null ? '' : String(Math.round(n * 1000) / 1000));

export default function FacturaCompra() {
  const { id, fecha } = useLocalSearchParams();
  const abrirOtro = (d) => {
    if (!d?.id) return;
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/factura-compra/[id]', params: { id: String(d.id), fecha: d.fecha_emision ?? fecha } });
  };
  const [doc, setDoc] = useState(() => documentoGuardado(id));
  const [json, setJson] = useState(undefined);   // undefined = cargando · null = no se pudo
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const { hasPermission } = useAuth();
  const puedeVincular = hasPermission('facturas_compra', 'can_edit');
  const puedeAbrir = hasPermission('facturas_compra_abrir');
  const [adjuntando, setAdjuntando] = useState(false);
  const [delMes, setDelMes] = useState(null);
  const [qJson, setQJson] = useState('');
  const [vinculando, setVinculando] = useState(false);
  const [maestro, setMaestro] = useState([]);
  const [qProv, setQProv] = useState('');
  useEffect(() => {
    if (!vinculando || maestro.length) return;
    Promise.resolve(fetchProveedoresMaestro()).then((l) => setMaestro(l ?? [])).catch((e) => fallo('No se pudo traer el directorio', mensajeAmigable(e)));
  }, [vinculando, maestro.length]);
  const candidatos = useMemo(() => (qProv.trim().length >= 2 ? maestro.filter((p) => tokenMatch(qProv, p.nombre, p.alias, p.nit)).slice(0, 8) : []), [qProv, maestro]);
  const vincular = (p) => Alert.alert('Vincular la factura', `${doc.emisor_nombre || 'Esta factura'} → ${p.nombre}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Vincular', onPress: async () => {
      try {
        await setPurchaseDteProveedor(doc.id, p.id, { codigo_generacion: doc.codigo_generacion, desde: 'app' });
        setDoc((d) => ({ ...d, proveedor_id: p.id, proveedor_nombre: p.nombre }));
        setVinculando(false);
        listo('Vinculada', p.nombre);
      } catch (e) { fallo('No se pudo vincular', mensajeAmigable(e)); }
    } },
  ]);

  // Los documentos del mes que SÍ traen JSON: los candidatos a duplicado.
  // Lista amplia a propósito, como el portal (un reenvío con PDF+JSON también
  // vale), ordenada por cercanía al correo de éste.
  useEffect(() => {
    if (!adjuntando || delMes) return;
    const [desde, hasta] = rangoDelMes(String(doc?.fecha_emision || fecha || '').slice(0, 7));
    Promise.resolve(fetchPurchaseDteDocuments(desde, hasta)).then((l) => setDelMes(l || [])).catch((e) => { setDelMes([]); fallo('No se pudieron traer los documentos', mensajeAmigable(e)); });
  }, [adjuntando, delMes, doc?.fecha_emision, fecha]);
  const candidatosJson = useMemo(() => {
    const ancla = doc?.received_at ? new Date(doc.received_at).getTime() : null;
    const lista = (delMes || []).filter((d) => d.json_path && d.id !== doc?.id)
      .filter((d) => !qJson.trim() || tokenMatch(qJson, d.proveedor_nombre, d.supplier_nombre, d.emisor_nombre, d.codigo_generacion, d.numero_control));
    if (ancla != null) lista.sort((a, b) => (a.received_at ? Math.abs(new Date(a.received_at).getTime() - ancla) : Infinity) - (b.received_at ? Math.abs(new Date(b.received_at).getTime() - ancla) : Infinity));
    return lista.slice(0, 12);
  }, [delMes, qJson, doc?.received_at, doc?.id]);

  // Después de unir, el documento cambia (trae el JSON): se relee del mes.
  const releer = async () => {
    const [desde, hasta] = rangoDelMes(String(doc?.fecha_emision || fecha || '').slice(0, 7));
    const lista = await fetchPurchaseDteDocuments(desde, hasta);
    guardarDocumentos(lista);
    setDoc(documentoGuardado(id) ?? doc);
  };
  const unir = async (otro, via) => {
    await mergePurchaseDteDocuments(doc.id, otro.id, { ...(via ? { via } : {}), desde: 'app' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo('JSON adjuntado', otro.proveedor_nombre || otro.emisor_nombre || '');
    setAdjuntando(false); setDelMes(null);
    await releer().catch(() => {});
  };
  const adjuntar = (d) => Alert.alert('Adjuntar el JSON', `Une este documento con ${d.proveedor_nombre || d.supplier_nombre || d.emisor_nombre || 'el duplicado'} · ${formatMoney(d.monto_total)}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Unir', onPress: () => unir(d).catch((e) => fallo('No se pudo fusionar', mensajeAmigable(e))) },
  ]);

  const cargarDoc = useCallback(async () => {
    if (documentoGuardado(id)) { setDoc(documentoGuardado(id)); return; }
    try {
      const [desde, hasta] = rangoDelMes(String(fecha || '').slice(0, 7));
      const lista = await fetchPurchaseDteDocuments(desde, hasta);
      guardarDocumentos(lista);
      setDoc(documentoGuardado(id));
      if (!documentoGuardado(id)) setError('No se encontró la factura.');
    } catch (e) { setError(mensajeAmigable(e)); }
  }, [id, fecha]);
  useEffect(() => { cargarDoc(); }, [cargarDoc]);

  const cargarJson = useCallback(async () => {
    if (!doc?.json_path) { setJson(null); return; }
    try {
      const url = await getSignedFileUrl(doc.json_path);
      const r = await fetch(url);
      setJson(r.ok ? await r.json() : null);
    } catch { setJson(null); }
  }, [doc?.json_path]);
  useEffect(() => { if (doc) cargarJson(); }, [doc, cargarJson]);

  const abrir = async (ruta) => {
    try { await openStoredFile(ruta); } catch (e) { fallo('No se pudo abrir', mensajeAmigable(e)); }
  };

  const renglones = json ? renglonesDelDte(json) : [];
  const t = json ? totalesDelDte(json) : null;
  const proveedor = doc ? (doc.proveedor_alias || doc.proveedor_nombre || doc.supplier_nombre || doc.emisor_nombre || 'Sin proveedor') : '';

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Factura de compra', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargarJson(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!doc && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {doc ? (
          <>
            <Vidrio radio={24} tinte={doc.invalidado ? 'rgba(240,68,56,0.12)' : undefined}>
              <View style={{ padding: 18, gap: 6 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{proveedor}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[dteTypeLabel(doc.tipo_dte), fechaTexto(doc.fecha_emision, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })].join(' · ')}
                </Text>
                <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', marginTop: 4, textDecorationLine: doc.invalidado ? 'line-through' : 'none' }}>{formatMoney(doc.monto_total)}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {doc.invalidado ? <Pildora texto="Invalidado por el proveedor" color={MARCA.rojo} /> : null}
                  {!doc.proveedor_id ? <Pildora texto="Sin vincular a un proveedor" color={MARCA.ambar} /> : null}
                  {doc.total_iva != null ? <Pildora texto={`IVA ${formatMoney(doc.total_iva)}`} color={colorSistema.texto2} /> : null}
                </View>
                {doc.invalidado && doc.invalidado_motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{doc.invalidado_motivo}</Text> : null}
              </View>
            </Vidrio>
            {!doc.proveedor_id && puedeVincular ? (vinculando ? (
              <Seccion titulo="Vincular a un proveedor">
                <Campo multiline={false} autoFocus value={qProv} onChangeText={setQProv} placeholder="Nombre, alias o NIT" />
                {!maestro.length ? <ActivityIndicator /> : candidatos.map((p) => (
                  <Pressable key={p.id} onPress={() => vincular(p)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                    {p.nit ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`NIT ${p.nit}`}</Text> : null}
                  </Pressable>
                ))}
                <Pressable onPress={() => setVinculando(false)} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Cancelar</Text></Pressable>
              </Seccion>
            ) : <BotonGrande texto="Vincular a un proveedor" borde color={MARCA.ambar} onPress={() => setVinculando(true)} />) : null}

            {doc.invalidado && puedeAbrir && doc.invalidacion_source?.file_path ? (
              <BotonGrande texto="Ver el documento de la anulación" borde color={MARCA.rojo} onPress={() => abrir(doc.invalidacion_source.file_path)} />
            ) : null}

            {!doc.json_path && puedeVincular ? (
              <Seccion titulo="Sin JSON" pie="Se confirmó sólo con el PDF. Únelo con el documento que sí trae el JSON.">
                {puedeAbrir && doc.pdf_path ? <DetectarCodigo pdfPath={doc.pdf_path} accion="Unir" onEncontrado={(m) => unir(m, 'detect_code')} /> : null}
                {adjuntando ? (
                  <View style={{ gap: 6 }}>
                    <Campo multiline={false} autoFocus value={qJson} onChangeText={setQJson} placeholder="Buscar el documento duplicado" />
                    {delMes == null ? <ActivityIndicator /> : !candidatosJson.length ? (
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Ningún documento con JSON en el mes.</Text>
                    ) : candidatosJson.map((d) => (
                      <Pressable key={d.id} onPress={() => adjuntar(d)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${d.proveedor_nombre || d.supplier_nombre || d.emisor_nombre || '—'} · ${formatMoney(d.monto_total)}`}</Text>
                        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaTexto(d.fecha_emision, { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.codigo_generacion ?? 'sin código'}`}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => { setAdjuntando(false); setQJson(''); }} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Cancelar</Text></Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setAdjuntando(true)} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Adjuntar JSON</Text>
                  </Pressable>
                )}
              </Seccion>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              {doc.pdf_path ? <View style={{ flex: 1 }}><BotonGrande texto="Ver el PDF" color={MARCA.azul} onPress={() => abrir(doc.pdf_path)} /></View> : null}
              {doc.json_path ? <View style={{ flex: 1 }}><BotonGrande texto="Ver el JSON" borde color={MARCA.azulClaro} onPress={() => abrir(doc.json_path)} /></View> : null}
            </View>
            {!doc.pdf_path ? <Aviso tono="nota" texto="Esta factura llegó sin PDF." /> : null}

            <Seccion titulo={json === undefined ? 'Productos' : `Productos · ${renglones.length}`}>
              {json === undefined ? <ActivityIndicator /> : !renglones.length ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{doc.items_text || 'No se pudo leer el detalle del documento.'}</Text>
              ) : renglones.map((r, i) => (
                <View key={`${r.numero}-${i}`} style={{ flexDirection: 'row', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 9 : 0 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{r.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {[r.cantidad != null ? `${cant(r.cantidad)} × ${r.precio != null ? formatMoney(r.precio) : '—'}` : null, r.descuento ? `desc. ${formatMoney(r.descuento)}` : null, r.codigo ? `cód. ${r.codigo}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(r.total)}</Text>
                </View>
              ))}
            </Seccion>

            {t ? (
              <Seccion titulo="Totales">
                {[['Gravado', t.gravado], ['Exento', t.exento], ['No sujeto', t.noSujeto], ['Descuentos', t.descuento], ['IVA', t.iva], ['Retención', t.retencion], ['Percepción', t.percepcion]]
                  .filter(([, v]) => v)
                  .map(([r, v], i) => <Dato key={r} primero={i === 0} rotulo={r} valor={formatMoney(v)} />)}
                <Dato rotulo="Total a pagar" valor={formatMoney(t.total ?? doc.monto_total)} fuerte />
              </Seccion>
            ) : null}

            <Seccion titulo="El documento">
              <Dato primero rotulo="Número de control" valor={doc.numero_control || '—'} />
              <Dato rotulo="Código de generación" valor={doc.codigo_generacion || '—'} />
              <Dato rotulo="NIT del emisor" valor={doc.emisor_nit || '—'} />
              {doc.emisor_nrc ? <Dato rotulo="NRC del emisor" valor={doc.emisor_nrc} /> : null}
              {doc.received_at ? <Dato rotulo="Llegó" valor={fechaTexto(doc.received_at, { day: 'numeric', month: 'short', year: 'numeric' })} /> : null}
            </Seccion>

            {/* Las notas de crédito y el documento que una nota corrige se abren
                al tocarlos, como «Ver original» del portal. */}
            {doc.documento_relacionado ? (
              <Seccion titulo="Corrige a">
                <Pressable onPress={() => abrirOtro(doc.documento_relacionado)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Dato primero rotulo={dteTypeLabel(doc.documento_relacionado.tipo_dte)} valor={`${doc.documento_relacionado.codigo_generacion ? `…${String(doc.documento_relacionado.codigo_generacion).slice(-8)}` : 'Ver'}  ›`} />
                </Pressable>
              </Seccion>
            ) : null}
            {(doc.notas_credito || []).length ? (
              <Seccion titulo="Notas de crédito">
                {doc.notas_credito.map((n, i) => (
                  <Pressable key={n.id ?? i} disabled={!n.id} onPress={() => abrirOtro(n)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <Dato primero={i === 0} rotulo={n.numero_control ? `…${String(n.numero_control).slice(-8)}` : `Nota ${i + 1}`} valor={`− ${formatMoney(n.monto_total)}${n.id ? '  ›' : ''}`} />
                  </Pressable>
                ))}
              </Seccion>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
