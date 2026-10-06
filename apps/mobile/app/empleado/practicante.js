// Alta y edición de un PRACTICANTE, NATIVO — el `PracticanteModal` del portal.
// Los campos, la validación (menor → documento alterno; adulto → DUI con su
// dígito; el fin después del inicio; el convenio firmado obligatorio) y la
// fila que se guarda salen del núcleo (`practicanteFormulario`), la misma regla
// del portal. Se guarda con `createPracticante` / `updatePracticante` del
// store, que anotan la bitácora.
//
// El convenio en el teléfono es una FOTO del documento firmado (cámara o
// galería): va al mismo bucket y la misma carpeta que el PDF del portal.
//
// El alta guarda borrador (son diecisiete campos y la sesión de sala se cierra
// a los 5 minutos); la edición no: ahí la fila de la base es la verdad.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { ESTADOS_DE_PRACTICANTE, filaDePracticante, formularioDePracticante, validarPracticante } from '@nucleo/utils/practicanteFormulario';
import { fetchInstitucionCatalogValues } from '@nucleo/data/practicantes';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { CampoConRotulo, CampoFecha, Elegir } from '../../componentes/personas/Formulario';
import { fallo, listo } from '../../componentes/Progreso';

export default function Practicante() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('staff_list', 'can_edit');
  const practicantes = useStaffStore((s) => s.practicantes);
  const branches = useStaffStore((s) => s.branches);
  const employees = useStaffStore((s) => s.employees);
  const createPracticante = useStaffStore((s) => s.createPracticante);
  const updatePracticante = useStaffStore((s) => s.updatePracticante);
  const deletePracticante = useStaffStore((s) => s.deletePracticante);
  const practicante = useMemo(() => (id ? (practicantes || []).find((p) => String(p.id) === String(id)) : null), [practicantes, id]);
  const esAlta = !id;

  const [form, setForm] = useState(() => formularioDePracticante(practicante));
  const [convenio, setConvenio] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [instituciones, setInstituciones] = useState([]);
  useEffect(() => { fetchInstitucionCatalogValues().then(({ data }) => setInstituciones((data || []).map((r) => r.value))).catch(() => {}); }, []);

  const { recuperado, descartar } = useBorrador('alta_practicante', form, { activo: esAlta });
  const [repuesto, setRepuesto] = useState(false);
  if (esAlta && recuperado && !repuesto) { setRepuesto(true); setForm((f) => ({ ...f, ...recuperado })); }

  const cambiar = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const v = validarPracticante(form, { tieneConvenio: !!convenio || !!practicante?.convenio_url });

  const salas = useMemo(() => (branches || []).map((b) => ({ id: String(b.id), label: b.name })), [branches]);
  const personas = useMemo(() => (employees || []).filter((e) => e.status !== 'INACTIVO').map((e) => ({ id: e.id, label: shortEmployeeName(e), detalle: e.role || '' })), [employees]);
  const opcionesInstitucion = useMemo(() => {
    const lista = [...new Set([...(instituciones || []), form.institucion_educativa].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return lista.map((x) => ({ id: x, label: x }));
  }, [instituciones, form.institucion_educativa]);

  const tomarConvenio = async (camara) => {
    const permiso = camara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) { Alert.alert('Sin permiso', camara ? 'La app necesita la cámara.' : 'La app necesita tus fotos.'); return; }
    const op = { mediaTypes: ['images'], quality: 0.7 };
    const r = camara ? await ImagePicker.launchCameraAsync(op) : await ImagePicker.launchImageLibraryAsync(op);
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    Haptics.selectionAsync().catch(() => {});
    setConvenio({ uri: a.uri, tipo: a.mimeType || 'image/jpeg' });
  };
  const pedirInstitucion = () => Alert.prompt('Otra institución', 'Escríbela como debe verse en el catálogo.', (t) => {
    const n = String(t || '').trim();
    if (n) cambiar('institucion_educativa')(n);
  }, 'plain-text', '');

  const guardar = async () => {
    setIntento(true);
    if (!v.valido) { fallo('Faltan datos', 'Revisa los campos marcados.'); return; }
    setGuardando(true);
    try {
      let convenioUrl = practicante?.convenio_url || null;
      if (convenio) {
        const ext = convenio.tipo.includes('png') ? 'png' : 'jpg';
        const carpeta = practicante?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const datos = await (await fetch(convenio.uri)).arrayBuffer();
        convenioUrl = (await subirArchivo('documents', `practicantes/${carpeta}/convenio_${Date.now()}.${ext}`, datos, { contentType: convenio.tipo })) || convenioUrl;
      }
      const fila = filaDePracticante(form, convenioUrl);
      if (esAlta) await createPracticante(fila);
      else await updatePracticante(practicante.id, fila);
      descartar();
      listo(esAlta ? 'Practicante registrado' : 'Practicante actualizado', `${fila.first_names} ${fila.last_names}`);
      router.back();
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };
  const eliminar = () => Alert.alert('Eliminar practicante', `${form.first_names} ${form.last_names} se borra del registro. No se puede deshacer.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      try { await deletePracticante(practicante.id); listo('Practicante eliminado', ''); router.back(); }
      catch (e) { fallo('No se pudo eliminar', mensajeAmigable(e)); }
    } },
  ]);

  if (!puedeEditar) return <Aviso tono="freno" texto="Tu cargo no puede registrar ni editar practicantes." />;
  if (!esAlta && !practicante) return <Aviso tono="freno" texto="No se encontró el practicante." />;
  const err = (cond, texto) => (intento && cond ? texto : null);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: esAlta ? 'Nuevo practicante' : 'Editar practicante', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {esAlta && recuperado ? <Aviso texto="Se recuperó lo que habías escrito antes." /> : null}
          <Seccion titulo="La persona">
            <CampoConRotulo rotulo="Nombres" requerido value={form.first_names} onChangeText={cambiar('first_names')} error={err(!form.first_names.trim(), 'Escribe los nombres')} />
            <CampoConRotulo rotulo="Apellidos" requerido value={form.last_names} onChangeText={cambiar('last_names')} error={err(!form.last_names.trim(), 'Escribe los apellidos')} />
            <CampoFecha rotulo="Fecha de nacimiento" valor={form.birth_date} onCambiar={cambiar('birth_date')} />
            {v.esMenor ? (
              <CampoConRotulo rotulo="Documento alterno (menor de edad)" requerido value={form.alt_identity_document} onChangeText={cambiar('alt_identity_document')}
                placeholder="Partida de nacimiento, carné de minoridad…" error={err(v.faltaDocumentoAlterno, 'Requerido para menores sin DUI')} />
            ) : (
              <CampoConRotulo rotulo="DUI" value={form.dui} onChangeText={cambiar('dui')} keyboardType="number-pad" placeholder="00000000-0" error={v.duiInvalido ? 'DUI inválido' : null} />
            )}
            <CampoConRotulo rotulo="Teléfono" value={form.phone} onChangeText={cambiar('phone')} keyboardType="phone-pad" placeholder="0000-0000" />
          </Seccion>

          <Seccion titulo="La práctica">
            <Elegir rotulo="Sala" requerido valor={form.branch_id} opciones={salas} onCambiar={cambiar('branch_id')} error={err(!form.branch_id, 'Elige la sala')} />
            <Elegir rotulo="Institución educativa" requerido valor={form.institucion_educativa} opciones={opcionesInstitucion} onCambiar={cambiar('institucion_educativa')} error={err(v.faltaInstitucion, 'Elige la institución')} />
            <Pressable onPress={pedirInstitucion} hitSlop={6}><Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>¿No está? Escribir otra institución</Text></Pressable>
            <CampoConRotulo rotulo="Tutor (institución)" requerido value={form.tutor_nombre} onChangeText={cambiar('tutor_nombre')} error={err(!form.tutor_nombre.trim(), 'Escribe el tutor')} />
            <CampoConRotulo rotulo="Teléfono del tutor" value={form.tutor_telefono} onChangeText={cambiar('tutor_telefono')} keyboardType="phone-pad" />
            <Elegir rotulo="Supervisor en la empresa" valor={form.supervisor_employee_id} opciones={personas} onCambiar={cambiar('supervisor_employee_id')} vacio="Sin supervisor" />
            <CampoFecha rotulo="Inicio" requerido valor={form.fecha_inicio} onCambiar={cambiar('fecha_inicio')} error={err(!form.fecha_inicio, 'Elige el inicio')} />
            <CampoFecha rotulo="Fin" requerido valor={form.fecha_fin} onCambiar={cambiar('fecha_fin')} desde={form.fecha_inicio || undefined}
              error={v.fechasInvalidas ? 'El fin tiene que ser después del inicio' : err(!form.fecha_fin, 'Elige el fin')} />
            <CampoConRotulo rotulo="Horas requeridas (meta)" value={form.horas_requeridas} onChangeText={cambiar('horas_requeridas')} keyboardType="number-pad" placeholder="Ej. 200" />
            {!esAlta ? <Elegir rotulo="Estado" valor={form.estado} opciones={ESTADOS_DE_PRACTICANTE.map((e) => ({ id: e.value, label: e.label }))} onCambiar={cambiar('estado')} /> : null}
            <CampoConRotulo rotulo="Notas" value={form.notas} onChangeText={cambiar('notas')} multiline style={{ minHeight: 70 }} />
          </Seccion>

          <Seccion titulo="Convenio firmado" pie={practicante?.convenio_url && !convenio ? 'Ya tiene convenio guardado; toma otra foto sólo para reemplazarlo.' : 'Obligatorio: una foto clara del convenio firmado.'}>
            {convenio ? <Image source={{ uri: convenio.uri }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }} resizeMode="cover" /> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Tomar foto" borde onPress={() => tomarConvenio(true)} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="De la galería" borde onPress={() => tomarConvenio(false)} /></View>
            </View>
            {intento && v.faltaConvenio ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>Falta el convenio firmado.</Text> : null}
          </Seccion>

          <BotonGrande texto={guardando ? 'Guardando…' : esAlta ? 'Registrar practicante' : 'Guardar cambios'} onPress={guardar} deshabilitado={guardando} />
          {!esAlta ? <BotonGrande texto="Eliminar practicante" borde color={MARCA.rojo} onPress={eliminar} deshabilitado={guardando} /> : null}
          <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>Los campos con * son obligatorios.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
