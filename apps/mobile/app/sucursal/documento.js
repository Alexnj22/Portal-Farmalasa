// Un documento PROPIO del expediente de la sala (los que se agregan a mano:
// pólizas, constancias, lo que no es un requisito fijo), NATIVO — el
// `FormAddCustomDocument` del portal. `?id=` la sala y `?doc=` el documento
// para editarlo; sin `doc`, uno nuevo.
//
// Mismo guardado que el portal (`UnifiedModal`, addCustomDocument): el archivo
// va a `documents` en la MISMA ruta (`rutaDelDocumentoPropio`) y en la base
// queda su URL formato-public; se le pide a la lectura de documentos que saque
// las fechas si no se escribieron; el documento se arma con `documentoPropio`
// y entra por `updateBranch` con la sucursal completa. Eliminarlo, con
// confirmación, como la papelera del portal.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { CATEGORIAS_DOCUMENTO, categoriaDeDocumento } from '@nucleo/data/constants';
import { analizarDocumento } from '@nucleo/data/ia';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { sucursalConCambios } from '@nucleo/utils/edicionDeSucursal';
import {
  ajustesConDocumentoPropio, ajustesSinDocumentoPropio, documentoPropio, problemaDelDocumentoPropio, rutaDelDocumentoPropio,
} from '@nucleo/utils/expedienteDeSucursal';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';
import { elegirOrigen, extDe, leerComoArchivo } from '../../componentes/sucursal/elegirArchivo';

const CATEGORIAS = Object.entries(CATEGORIAS_DOCUMENTO);
const VACIO = { title: '', category: CATEGORIAS[0]?.[0], hasIssueDate: false, issueDate: '', hasExpiration: false, expDate: '' };
const nuevoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function Fila({ titulo, children, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 6 }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
      {children}
    </View>
  );
}

export default function DocumentoPropio() {
  const { id, doc } = useLocalSearchParams();
  const sucursal = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(id)));
  const updateBranch = useStaffStore((s) => s.updateBranch);
  const appendAuditLog = useStaffStore((s) => s.appendAuditLog);
  const existente = useMemo(() => (doc ? (sucursal?.settings?.customDocs || []).find((d) => d.id === doc) : null), [sucursal, doc]);
  const BORRADOR = `doc_propio_sucursal_${id}`;

  const [datos, setDatos] = useState(() => (existente
    ? { ...VACIO, ...existente, category: categoriaDeDocumento(existente.category), issueDate: existente.issueDate || '', expDate: existente.expDate || '' }
    : { ...VACIO, ...(loadDraft(BORRADOR) || {}) }));
  const [origen, setOrigen] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // El borrador sólo para uno nuevo: editar parte de lo guardado.
  useEffect(() => { if (!existente) saveDraft(BORRADOR, datos); }, [datos, existente, BORRADOR]);

  const cambiar = (campo, valor) => setDatos((d) => ({ ...d, [campo]: valor }));
  const elegirCategoria = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: 'Categoría', options: [...CATEGORIAS.map(([, c]) => c.label), 'Cancelar'], cancelButtonIndex: CATEGORIAS.length },
    (i) => { if (i < CATEGORIAS.length) cambiar('category', CATEGORIAS[i][0]); },
  );

  if (!sucursal) return <Aviso texto="No se encontró la sucursal." />;

  const guardar = async () => {
    const problema = problemaDelDocumentoPropio(datos);
    if (problema) { Alert.alert('Falta un dato', problema); return; }
    setGuardando(true);
    trabajando(origen ? 'Subiendo el documento…' : 'Guardando…');
    try {
      const docId = existente?.id || nuevoId();
      let url = existente?.url || null;
      let aiSummary = existente?.aiSummary || null;
      const fechas = { ...datos };
      if (origen) {
        const archivo = await leerComoArchivo(origen, docId);
        if (!archivo) { setGuardando(false); return; }
        const ruta = rutaDelDocumentoPropio(sucursal.id, docId, extDe(archivo.name, archivo.contentType));
        url = await subirArchivo('documents', ruta, archivo.body, { upsert: true, contentType: archivo.contentType });
        // Como el portal: la lectura de documentos completa las fechas que no
        // se escribieron. Si falla, el documento se guarda igual.
        const { data: ia } = await Promise.resolve(analizarDocumento({ filePath: ruta, bucketName: 'documents' })).catch(() => ({ data: null }));
        if (ia?.success && ia.aiData) {
          aiSummary = ia.aiData.aiSummary ?? aiSummary;
          if (ia.aiData.issueDate && !fechas.issueDate) fechas.issueDate = ia.aiData.issueDate;
          if (ia.aiData.expDate && !fechas.expDate) fechas.expDate = ia.aiData.expDate;
        }
      }
      const documento = documentoPropio({ id: docId, datos: fechas, url, aiSummary });
      const base = sucursalConCambios(sucursal);
      await updateBranch(sucursal.id, { ...base, settings: ajustesConDocumentoPropio(base.settings, documento) });
      await Promise.resolve(appendAuditLog?.('DOC_AGREGADO', sucursal.id, {
        timeline_title: existente ? `Documento Actualizado: ${documento.title}` : `Nuevo Documento: ${documento.title}`,
        dimension: 'LEGAL', new_value: CATEGORIAS_DOCUMENTO[documento.category]?.label, desde: 'app',
      })).catch(() => {});
      if (!existente) clearDraft(BORRADOR);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(existente ? 'Documento actualizado' : 'Documento agregado', documento.title);
      volver(`/sucursal/${sucursal.id}`);
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  const confirmarGuardar = () => Alert.alert(existente ? 'Guardar los cambios' : 'Agregar el documento',
    `«${datos.title.trim() || 'Sin nombre'}» en el expediente de ${sucursal.name}.`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: guardar },
    ]);

  const eliminar = () => Alert.alert('Eliminar documento', `«${existente.title}» deja de estar en el expediente de ${sucursal.name}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      trabajando('Eliminando…');
      try {
        const base = sucursalConCambios(sucursal);
        await updateBranch(sucursal.id, { ...base, settings: ajustesSinDocumentoPropio(base.settings, existente.id) });
        listo('Documento eliminado', existente.title);
        volver(`/sucursal/${sucursal.id}`);
      } catch (e) { fallo('No se pudo eliminar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: existente ? 'Editar documento' : 'Nuevo documento' }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 60, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Seccion titulo="El documento">
            <Campo multiline={false} value={datos.title} onChangeText={(v) => cambiar('title', v)} placeholder="Nombre (p. ej. Póliza de seguro)" />
            <Pressable onPress={elegirCategoria} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Categoría</Text>
              <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{CATEGORIAS_DOCUMENTO[datos.category]?.label || '—'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
            </Pressable>
          </Seccion>

          <Seccion titulo="Fechas" pie="Si no las escribes y subes el archivo, se intentan leer del documento.">
            <Fila titulo="Tiene fecha de emisión" primero><Switch value={datos.hasIssueDate} onValueChange={(v) => cambiar('hasIssueDate', v)} /></Fila>
            {datos.hasIssueDate ? <Fila titulo="Emitido"><Fecha valor={datos.issueDate} onCambiar={(v) => cambiar('issueDate', v)} /></Fila> : null}
            <Fila titulo="Vence"><Switch value={datos.hasExpiration} onValueChange={(v) => cambiar('hasExpiration', v)} /></Fila>
            {datos.hasExpiration ? <Fila titulo="Fecha de vencimiento"><Fecha valor={datos.expDate} onCambiar={(v) => cambiar('expDate', v)} /></Fila> : null}
          </Seccion>

          <Seccion titulo="Archivo" pie="PDF o foto (JPG, PNG o WEBP), hasta 10 MB.">
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
              {origen ? `Elegido: ${origen.nombre}` : existente?.url ? 'Ya tiene archivo; elige otro para reemplazarlo.' : 'Sin archivo todavía.'}
            </Text>
            <BotonGrande texto={origen || existente?.url ? 'Elegir otro archivo' : 'Elegir archivo'} borde onPress={async () => { const f = await elegirOrigen(); if (f) setOrigen(f); }} />
          </Seccion>

          <View style={{ marginHorizontal: 16, gap: 10 }}>
            <BotonGrande texto={guardando ? 'Guardando…' : existente ? 'Guardar cambios' : 'Agregar al expediente'} onPress={confirmarGuardar} deshabilitado={guardando} />
            {existente ? <BotonGrande texto="Eliminar documento" borde color={MARCA.rojo} onPress={eliminar} deshabilitado={guardando} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
