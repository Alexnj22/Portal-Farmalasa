// El expediente de una persona, NATIVO — lo que del expediente del portal
// (`EmployeeFormModal`) es de captura simple desde el teléfono:
//
//  · Foto: tomarla o elegirla; se sube al bucket privado `empleados` (la ruta
//    que usa el portal) y se guarda la URL formato-public.
//  · Documentos, por las MISMAS secciones del portal (`SECCIONES_DE_DOCUMENTOS`,
//    núcleo): abrir el archivo (firmado), subir o reemplazar con una foto, y la
//    fecha de vencimiento. Reemplazar deja la traza y, en los documentos que lo
//    piden, el archivo anterior (`documentoReemplazado`, núcleo: la regla del
//    portal).
//  · Estudios: nivel, especialidad / título y si estudia ahora (los niveles y
//    qué pide cada uno salen del núcleo).
//  · Banco: sólo con la llave de salarios (`salario_conocido`), como el portal.
//
// Todo se guarda con `updateEmployee`, la misma función del portal (que manda
// el banco por la función protegida y deja la bitácora). Lo que no es de
// captura simple —las dos caras del DUI con su lector, las hojas de un
// currículum, los datos del contrato del Art. 23— sigue en el portal.
import { useMemo, useState } from 'react';
import { Alert, ActionSheetIOS, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { EDUCATION_OPTIONS, LEVELS_WITH_PROFESSION, LEVELS_WITH_SPECIALTY, LEVELS_WITH_STUDY_TOGGLE, SECCIONES_DE_DOCUMENTOS,
  documentoReemplazado, rotuloDelDocumento } from '@nucleo/utils/documentosDelExpediente';
import { openStoredFile, subirArchivo } from '@nucleo/utils/storageFiles';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const TIPOS_DE_CUENTA = [{ id: 'AHORRO', label: 'Ahorro' }, { id: 'CORRIENTE', label: 'Corriente' }];
const azar = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

async function elegirFoto(camara) {
  const permiso = camara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) { Alert.alert('Sin permiso', camara ? 'La app necesita la cámara.' : 'La app necesita tus fotos.'); return null; }
  const op = { mediaTypes: ['images'], quality: 0.7 };
  const r = camara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  return { uri: a.uri, tipo: a.mimeType || 'image/jpeg', ext: (a.fileName?.split('.').pop() || 'jpg').toLowerCase() };
}
const preguntarFoto = () => new Promise((resolve) => ActionSheetIOS.showActionSheetWithOptions(
  { options: ['Tomar foto', 'Elegir de la galería', 'Cancelar'], cancelButtonIndex: 2 },
  async (i) => resolve(i === 2 ? null : await elegirFoto(i === 0)),
));
const bytes = async (uri) => (await fetch(uri)).arrayBuffer();

export default function Expediente() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const actualizar = useStaffStore((s) => s.updateEmployee);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const puedeEditar = !!hasPermission?.('staff_list', 'can_edit');
  const [estudios, setEstudios] = useState(() => ({
    nivel: emp?.education_level || '', especialidad: emp?.education_specialty || '', profesion: emp?.profession || '', estudia: !!emp?.is_studying,
  }));
  const [banco, setBanco] = useState(() => ({ bank_name: emp?.bank_name || '', account_type: emp?.account_type || 'AHORRO', account_number: emp?.account_number || '' }));
  const [ocupado, setOcupado] = useState(false);
  if (!emp) return <Aviso tono="freno" texto="No se encontró la ficha." />;

  const docs = Array.isArray(emp.employee_documents) ? emp.employee_documents : [];
  const docDe = (cat) => docs.find((d) => d.category === cat);
  const guardar = async (patch, titulo) => {
    setOcupado(true);
    trabajando('Guardando…');
    try {
      await actualizar(emp.id, patch);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(titulo, shortEmployeeName(emp));
      return true;
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'));
      return false;
    } finally { setOcupado(false); }
  };

  const cambiarFoto = async () => {
    const f = await preguntarFoto();
    if (!f) return;
    try {
      trabajando('Subiendo la foto…');
      const url = await subirArchivo('empleados', `${emp.id}/foto_perfil/${azar()}.${f.ext}`, await bytes(f.uri), { contentType: f.tipo });
      await guardar({ photo_url: url }, 'Foto actualizada');
    } catch (e) { fallo('No se pudo subir la foto', e?.message || ''); }
  };

  // Un documento: el archivo nuevo va al bucket `documents` en la carpeta del
  // portal, y la lista entera se guarda con la traza del reemplazo.
  const subirDocumento = async (cat) => {
    const f = await preguntarFoto();
    if (!f) return;
    try {
      trabajando('Subiendo el documento…');
      const url = await subirArchivo('documents', `employees/${emp.id}/documents/${azar()}.${f.ext}`, await bytes(f.uri), { contentType: f.tipo });
      const lista = documentoReemplazado(docs, cat, { url, file_name: `${rotuloDelDocumento(cat)}.${f.ext}` }, { quien: user?.name || '', hoy: hoySV() });
      await guardar({ employee_documents: lista }, 'Documento guardado');
    } catch (e) { fallo('No se pudo subir el documento', e?.message || ''); }
  };
  const cambiarVencimiento = (cat, fecha) => guardar({ employee_documents: documentoReemplazado(docs, cat, { expiry_date: fecha }, { quien: user?.name || '', hoy: hoySV() }) }, 'Vencimiento guardado');
  const abrir = async (url) => { try { await openStoredFile(url); } catch (e) { fallo('No se pudo abrir', e?.message || ''); } };

  const nivel = estudios.nivel;
  const guardarEstudios = () => Alert.alert('Guardar estudios', '¿Guardar los estudios de esta persona?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: () => guardar({
      education_level: nivel || null,
      education_specialty: LEVELS_WITH_SPECIALTY.includes(nivel) ? estudios.especialidad : null,
      profession: LEVELS_WITH_PROFESSION.includes(nivel) ? estudios.profesion : (emp.profession ?? null),
      is_studying: LEVELS_WITH_STUDY_TOGGLE.includes(nivel) ? estudios.estudia : false,
    }, 'Estudios guardados') },
  ]);
  const guardarBanco = () => Alert.alert('Guardar la cuenta', `${banco.bank_name || 'Sin banco'} · ${banco.account_number || 'sin número'}. Es la cuenta a la que se paga la planilla.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: () => guardar({ bank_name: banco.bank_name.trim() || null, account_type: banco.account_type, account_number: banco.account_number.trim() || null }, 'Cuenta guardada') },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Expediente', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Avatar empleado={emp} tamano={96} />
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{shortEmployeeName(emp)}</Text>
            {puedeEditar ? (
              <Pressable onPress={cambiarFoto} disabled={ocupado} hitSlop={8}>
                <Text style={{ color: colorSistema.acento, fontSize: 16, fontWeight: '600' }}>{emp.photo_url ? 'Cambiar foto' : 'Poner foto'}</Text>
              </Pressable>
            ) : null}
          </View>

          {SECCIONES_DE_DOCUMENTOS.map((sec) => (
            <Seccion key={sec.id} titulo={sec.titulo} pie={sec.bajada}>
              {sec.claves.map((cat, i) => {
                const d = docDe(cat);
                const vencido = d?.expiry_date && d.expiry_date < hoySV();
                return (
                  <View key={cat} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{d?.title || rotuloDelDocumento(cat)}</Text>
                      {d?.url ? <Pildora texto={vencido ? 'Vencido' : 'Cargado'} color={vencido ? MARCA.rojo : MARCA.verde} /> : <Pildora texto="Falta" color={MARCA.ambar} />}
                    </View>
                    {d?.historial?.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Reemplazado ${d.historial.length} vez${d.historial.length === 1 ? '' : 'es'} · último ${fechaTexto(d.historial[0].reemplazado_el, { day: 'numeric', month: 'short', year: 'numeric' })}`}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                      {d?.url ? <Pressable onPress={() => abrir(d.url)} hitSlop={6}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Ver</Text></Pressable> : null}
                      {puedeEditar ? <Pressable onPress={() => subirDocumento(cat)} disabled={ocupado} hitSlop={6}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>{d?.url ? 'Reemplazar' : 'Subir foto'}</Text></Pressable> : null}
                      {d?.url && puedeEditar ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Vence</Text>
                          <Fecha valor={d.expiry_date || hoySV()} onCambiar={(v) => cambiarVencimiento(cat, v)} />
                        </View>
                      ) : d?.expiry_date ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 'auto' }}>{`Vence ${fechaTexto(d.expiry_date, { day: 'numeric', month: 'short', year: 'numeric' })}`}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </Seccion>
          ))}

          <Seccion titulo="Estudios">
            {EDUCATION_OPTIONS.map((o, i) => (
              <Pressable key={o.value} disabled={!puedeEditar} onPress={() => { Haptics.selectionAsync().catch(() => {}); setEstudios((x) => ({ ...x, nivel: o.value })); }}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{o.label}</Text>
                {nivel === o.value ? <Text style={{ color: colorSistema.acento, fontSize: 18, fontWeight: '700' }}>✓</Text> : null}
              </Pressable>
            ))}
            {LEVELS_WITH_SPECIALTY.includes(nivel) ? <Campo multiline={false} editable={puedeEditar} value={estudios.especialidad} onChangeText={(v) => setEstudios((x) => ({ ...x, especialidad: v }))} placeholder="Especialidad" /> : null}
            {LEVELS_WITH_PROFESSION.includes(nivel) ? <Campo multiline={false} editable={puedeEditar} value={estudios.profesion} onChangeText={(v) => setEstudios((x) => ({ ...x, profesion: v }))} placeholder="Profesión o título" /> : null}
            {LEVELS_WITH_STUDY_TOGGLE.includes(nivel) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Estudia actualmente</Text>
                <Switch disabled={!puedeEditar} value={estudios.estudia} onValueChange={(v) => setEstudios((x) => ({ ...x, estudia: v }))} />
              </View>
            ) : null}
            {puedeEditar ? <BotonGrande texto="Guardar estudios" borde color={MARCA.azulClaro} onPress={guardarEstudios} deshabilitado={ocupado} /> : null}
          </Seccion>

          {emp.salario_conocido ? (
            <Seccion titulo="Cuenta para la planilla">
              <Campo multiline={false} editable={puedeEditar} value={banco.bank_name} onChangeText={(v) => setBanco((x) => ({ ...x, bank_name: v }))} placeholder="Banco" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TIPOS_DE_CUENTA.map((t) => (
                  <Pressable key={t.id} disabled={!puedeEditar} onPress={() => setBanco((x) => ({ ...x, account_type: t.id }))}
                    style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: banco.account_type === t.id ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
                    <Text style={{ color: banco.account_type === t.id ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Campo multiline={false} editable={puedeEditar} keyboardType="number-pad" value={banco.account_number} onChangeText={(v) => setBanco((x) => ({ ...x, account_number: v.replace(/[^0-9-]/g, '') }))} placeholder="Número de cuenta" />
              {puedeEditar ? <BotonGrande texto="Guardar la cuenta" borde color={MARCA.azulClaro} onPress={guardarBanco} deshabilitado={ocupado} /> : null}
            </Seccion>
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
