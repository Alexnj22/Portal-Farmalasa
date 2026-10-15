// Alta y edición de un EMPLEADO, NATIVO — el formulario completo del portal
// (`EmployeeFormModal`), en tres pestañas como allá:
//
//  · Personal: enlazar con una ficha que ya existe (recontratación o posible
//    duplicado), el DUI por caras con su lector, identidad (DUI con lugar y
//    fecha de expedición y vencimiento, o el documento alterno de un menor),
//    estado civil, nacionalidad, contacto (varios teléfonos, correos y
//    direcciones), salud y contactos de emergencia, dependientes, cursos y
//    vehículos.
//  · Laboral: el puesto (sala, cargos, salas que cubre, ingreso), el contrato
//    del Art. 23, las acreditaciones con ISSS/AFP y las herramientas
//    entregadas.
//  · Nómina y acceso: la cuenta de la planilla, el usuario, el carné y el
//    código con su PIN.
//
// Se guarda con `addEmployee` / `updateEmployee` del store, los MISMOS del
// portal: ahí viven las reglas que importan —el código sólo números y único
// (lo contesta el servidor), el DUI con su dígito, el cupo del cargo, el
// usuario como CREDENCIAL, los datos con llave propia por su RPC, el enlace que
// escribe SOBRE la ficha existente—. La lógica compartida con el portal vive en
// el núcleo (`utils/fichaDelEmpleado.js`).
//
// Al EDITAR se manda sólo lo que cambió, y lo que el portal bloquea («Acción
// RRHH»: sala, cargos, ingreso, tipo e inicio de contrato, salario) se ve sin
// poder cambiarse: se cambia con una acción de personal. Los datos de
// identidad se editan sólo con su llave (`identidad_conocida`), la cuenta con
// la de salarios (`salario_conocido`).
//
// El alta guarda borrador (la sesión de sala se cierra sola a los 5 minutos),
// SIN los datos con llave ni el código: un borrador vive en el teléfono sin
// cifrar. Un borrador de un enlace vuelve a pedir lo protegido de la ficha.
//
// La foto y el resto del expediente (estudios, documentos por hojas, otros
// documentos) están en «Expediente» de la ficha.
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { SENSITIVE_FIELDS } from '@nucleo/store/utils';
import useBorrador from '@nucleo/hooks/useBorrador';
import { shortEmployeeName, usuarioDesdeNombre } from '@nucleo/utils/nameUtils';
import { isValidDUIAlgorithm, maskDui } from '@nucleo/utils/duiUtils';
import { contratoConPlazo } from '@nucleo/utils/contrato';
import { acreditacionesDe } from '@nucleo/utils/acreditaciones';
import { calcAge, MINOR_AGE } from '@nucleo/utils/ageUtils';
import { isDependentAgeInvalid } from '@nucleo/utils/economicDependents';
import { buildCatalogOptions, OTRA_ESPECIALIDAD } from '@nucleo/utils/educationCatalogs';
import { revisarNup } from '@nucleo/utils/nupAfp';
import { NATIONALITY_OPTIONS } from '@nucleo/data/nationalities';
import { ALT_ID_DOCUMENT_TYPE_OPTIONS, GENDER_OPTIONS, MARITAL_STATUS_OPTIONS, MAX_WORK_AGE, MIN_WORK_AGE, completarConLoProtegido,
  isValidEmail, isValidPersonName, isValidSVPhone, motivoDelEnlace, proponerCodigoDeCarne } from '@nucleo/utils/fichaDelEmpleado';
import { codigoDeCarneLibre, duiDisponible, fetchCredenciales, fetchEducationCatalogEntries, traerLoQueFaltaDeLaFicha } from '@nucleo/data/employees';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { CampoConRotulo, CampoFecha, Elegir } from '../../componentes/personas/Formulario';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import Enlazar from '../../componentes/personas/ficha/Enlazar';
import DuiPorCaras from '../../componentes/personas/ficha/DuiPorCaras';
import Contacto from '../../componentes/personas/ficha/Contacto';
import Salud from '../../componentes/personas/ficha/Salud';
import Dependientes from '../../componentes/personas/ficha/Dependientes';
import Acreditaciones from '../../componentes/personas/ficha/Acreditaciones';
import Contrato from '../../componentes/personas/ficha/Contrato';
import { Habilidades, Herramientas, Vehiculos } from '../../componentes/personas/ficha/Extras';
import Acceso, { Banco } from '../../componentes/personas/ficha/Acceso';
import { ElegirConOtro, Enlace, Fichas, Nota, op } from '../../componentes/personas/ficha/Piezas';

const PESTANAS = [{ id: 'personal', label: 'Personal' }, { id: 'laboral', label: 'Laboral' }, { id: 'nomina', label: 'Nómina y acceso' }];

// Lo que el formulario maneja. Los arreglos arrancan vacíos; el resto en ''.
const LISTAS = ['extra_phones', 'extra_emails', 'extra_addresses', 'emergency_contact_extra_phones', 'economic_dependents', 'chronic_conditions',
  'additional_skills', 'herramientas_entregadas', 'contrato_prorrogas', 'employee_documents', 'assigned_branch_ids'];
const BOOLEANOS = ['has_disability', 'disability_has_certification', 'has_motorcycle', 'has_car', 'has_motorcycle_license', 'has_car_license',
  'tiene_acreditacion_dependiente', 'carne_pendiente'];
const TEXTOS = ['first_names', 'last_names', 'code', 'role_id', 'secondary_role_id', 'branch_id', 'phone', 'email', 'birth_date', 'gender',
  'marital_status', 'blood_type', 'nationality', 'dui', 'dui_lugar_expedicion', 'dui_fecha_expedicion', 'dui_fecha_vencimiento',
  'alt_identity_document', 'alt_identity_document_type', 'isss_estado', 'isss_number', 'afp_estado', 'afp_number', 'afp_institution',
  'address', 'department', 'municipality', 'distrito', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'disability_type', 'disability_grade', 'contract_type', 'contract_start_date', 'contract_end_date', 'contract_temporal_legal_basis',
  'contract_temporal_reason', 'weekly_contracted_hours', 'base_salary', 'contrato_lugar_celebracion', 'contrato_fecha_celebracion',
  'forma_estipulacion_salario', 'medio_pago', 'lugar_pago', 'periodo_pago', 'mtps_remitido_fecha', 'hire_date', 'bank_name', 'account_type',
  'account_number', 'carne_dependiente_url', 'pharmacist_license_number', 'nursing_license_number', 'medico_license_number',
  'contador_license_number', 'username'];
const OBJETOS = ['acreditaciones'];
const CAMPOS = [...TEXTOS, ...LISTAS, ...BOOLEANOS, ...OBJETOS];
// Lo que en la EDICIÓN se cambia sólo con una acción de personal (el portal lo
// pinta «Acción RRHH»), y lo que sólo existe en el alta.
const BLOQUEADOS_AL_EDITAR = new Set(['role_id', 'secondary_role_id', 'branch_id', 'hire_date', 'contract_type', 'contract_start_date', 'base_salary', 'assigned_branch_ids']);
const DE_IDENTIDAD = new Set(['dui', 'alt_identity_document', 'dui_lugar_expedicion', 'dui_fecha_expedicion', 'dui_fecha_vencimiento', 'isss_number', 'afp_number']);
const DE_BANCO = new Set(['bank_name', 'account_number']);
// Se mandan juntos: el store los normaliza como grupo.
const GRUPOS = [
  ['emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship', 'contactos_extra'],
  ['has_disability', 'disability_type', 'disability_grade', 'disability_has_certification'],
];

function formularioDe(emp) {
  const f = {};
  for (const k of TEXTOS) f[k] = emp?.[k] == null ? '' : String(emp[k]);
  for (const k of LISTAS) f[k] = Array.isArray(emp?.[k]) ? emp[k] : [];
  for (const k of BOOLEANOS) f[k] = !!emp?.[k];
  f.acreditaciones = emp?.acreditaciones && typeof emp.acreditaciones === 'object' ? emp.acreditaciones : {};
  if (!emp) {
    const hoy = hoySV();
    return { ...f, contract_type: 'INDEFINIDO', contract_start_date: hoy, hire_date: hoy, weekly_contracted_hours: '44', account_type: 'AHORRO', enlazar_con_id: '' };
  }
  return {
    ...f,
    branch_id: String(emp.branch_id ?? emp.branchId ?? ''),
    birth_date: String(emp.birth_date ?? emp.birthDate ?? ''),
    hire_date: String(emp.hire_date ?? emp.hireDate ?? ''),
    contract_type: emp.contract_type || 'INDEFINIDO',
    weekly_contracted_hours: String(emp.weekly_contracted_hours || 44),
    account_type: emp.account_type || 'AHORRO',
    assigned_branch_ids: (emp.assigned_branch_ids || []).map(String),
    // El código y el PIN no viajan con el padrón: se piden aparte.
    code: '',
  };
}

const igual = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

export default function EditarEmpleado() {
  const { id } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeEditar = hasPermission('staff_list', 'can_edit');
  const veSalario = hasPermission('staff_salary', 'can_view');
  const employees = useStaffStore((s) => s.employees);
  const roles = useStaffStore((s) => s.roles);
  const branches = useStaffStore((s) => s.branches);
  const addEmployee = useStaffStore((s) => s.addEmployee);
  const updateEmployee = useStaffStore((s) => s.updateEmployee);
  const emp = useMemo(() => (id ? (employees || []).find((e) => String(e.id) === String(id)) : null), [employees, id]);
  const esAlta = !id;
  const [inicial, setInicial] = useState(() => formularioDe(emp));
  const [form, setForm] = useState(inicial);
  const [pestana, setPestana] = useState('personal');
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [credencialesListas, setCredencialesListas] = useState(esAlta);
  const [duiRepetido, setDuiRepetido] = useState(false);
  const [catalogo, setCatalogo] = useState({});

  // Borrador sólo del alta, sin lo que tiene llave ni el código ni las marcas
  // de carga (un borrador restaurado vuelve a pedir la ficha).
  const borrador = useMemo(() => {
    if (!esAlta) return null;
    const d = {};
    for (const k of [...CAMPOS, 'enlazar_con_id', 'contactos_extra']) if (form[k] !== undefined) d[k] = form[k];
    for (const k of SENSITIVE_FIELDS) delete d[k];
    delete d.code;
    return d;
  }, [form, esAlta]);
  const { recuperado, descartar } = useBorrador('alta_empleado_app', borrador, { activo: esAlta, vale: (v) => !!(v?.first_names || v?.last_names) });
  const [repuesto, setRepuesto] = useState(false);
  if (esAlta && recuperado && !repuesto) {
    setRepuesto(true);
    setForm((f) => ({ ...f, ...recuperado, _fichaCargada: null, _fichaFallo: null }));
  }
  useEffect(() => {
    if (!repuesto || !recuperado?.enlazar_con_id) return;
    const val = recuperado.enlazar_con_id;
    traerLoQueFaltaDeLaFicha(val).then((fuera) => setForm((p) => completarConLoProtegido(p, val, fuera)))
      .catch(() => setForm((p) => (String(p.enlazar_con_id) !== String(val) ? p : { ...p, _fichaFallo: val })));
  }, [repuesto, recuperado]);

  // El código: en el alta se propone uno libre; al editar se pide el de la persona.
  useEffect(() => {
    let vivo = true;
    if (esAlta) {
      proponerCodigoDeCarne(codigoDeCarneLibre).then((c) => { if (vivo && c) setForm((f) => (f.code ? f : { ...f, code: c })); });
    } else if (emp?.id) {
      fetchCredenciales([emp.id]).then((mapa) => {
        if (!vivo) return;
        const cred = mapa.get(emp.id);
        const code = cred?.code ? String(cred.code) : '';
        setInicial((i) => ({ ...i, code }));
        setForm((f) => ({ ...f, code: f.code || code }));
        setCredencialesListas(true);
      });
    }
    return () => { vivo = false; };
  }, [esAlta, emp?.id]);

  useEffect(() => {
    let vivo = true;
    fetchEducationCatalogEntries().then(({ data }) => {
      if (!vivo || !data) return;
      const g = {};
      for (const r of data) (g[r.category] ||= []).push(r.value);
      setCatalogo(g);
    });
    return () => { vivo = false; };
  }, []);
  const catalogos = useMemo(() => ({
    cronicas: buildCatalogOptions(catalogo.ENFERMEDAD_CRONICA || [], 'Otra condición médica...'),
    discapacidades: buildCatalogOptions(catalogo.TIPO_DISCAPACIDAD || [], 'Otro tipo de discapacidad...'),
    cursos: buildCatalogOptions(catalogo.CURSO_HABILIDAD || [], 'Otro curso/habilidad...'),
    instituciones: buildCatalogOptions(catalogo.INSTITUCION_CAPACITACION || [], 'Otra institución...'),
  }), [catalogo]);

  // El DUI repetido lo contesta el servidor (el padrón ya no trae el DUI).
  useEffect(() => {
    const dui = form.dui;
    if (!dui || dui.length < 10) { setDuiRepetido(false); return undefined; }
    let vigente = true;
    const t = setTimeout(async () => {
      const libre = await duiDisponible(dui, emp?.id ?? (form.enlazar_con_id || null));
      if (vigente) setDuiRepetido(libre === false);
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
  }, [form.dui, emp?.id, form.enlazar_con_id]);

  const cambiar = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const opcionesCargo = useMemo(() => (roles || []).map((r) => ({ id: String(r.id), label: r.name })).sort((a, b) => a.label.localeCompare(b.label)), [roles]);
  const opcionesSala = useMemo(() => (branches || []).map((b) => ({ id: String(b.id), label: b.name })), [branches]);
  const veIdentidad = esAlta || !!emp?.identidad_conocida;
  const veBanco = esAlta ? veSalario : !!emp?.salario_conocido;
  const usuarioSugerido = usuarioDesdeNombre(form.first_names, form.last_names);
  const usuarioGuardado = (emp?.username || '').toLowerCase() || null;
  const edad = calcAge(form.birth_date);
  const esMenor = edad !== null && edad < MINOR_AGE;
  const sala = (branches || []).find((b) => String(b.id) === String(form.branch_id));
  const cubreVarias = esAlta && !!sala && (sala.type || 'FARMACIA') !== 'FARMACIA';
  const nombreCargo = (roles || []).find((r) => String(r.id) === String(form.role_id))?.name || '';
  const aplicables = useMemo(() => acreditacionesDe({ cargo: nombreCargo, profesion: emp?.profession || form.profession }), [nombreCargo, emp?.profession, form.profession]);
  const rotuloAlterno = !form.alt_identity_document_type || form.alt_identity_document_type === OTRA_ESPECIALIDAD ? 'Documento de identidad'
    : ALT_ID_DOCUMENT_TYPE_OPTIONS.find((o) => o.value === form.alt_identity_document_type)?.label || form.alt_identity_document_type;

  const digitos = (v) => String(v || '').replace(/\D/g, '').length;
  const telMal = (t) => !!t && digitos(t) > 0 && !isValidSVPhone(t);
  const fechaFutura = !!form.birth_date && form.birth_date > hoySV();
  const problemas = {
    enlace: motivoDelEnlace(form),
    first_names: !form.first_names.trim() ? 'Falta el nombre.' : !isValidPersonName(form.first_names) ? 'El nombre sólo puede llevar letras.' : null,
    last_names: !form.last_names.trim() ? 'Faltan los apellidos.' : !isValidPersonName(form.last_names) ? 'Los apellidos sólo pueden llevar letras.' : null,
    dui: !veIdentidad || esMenor || !form.dui ? null : duiRepetido ? 'Ese DUI ya está registrado en otra ficha.'
      : !isValidDUIAlgorithm(form.dui) ? 'El DUI no está completo o su dígito verificador no cuadra.' : null,
    alt_identity_document: veIdentidad && esMenor && !form.alt_identity_document?.trim() ? 'Falta el número del documento del menor.' : null,
    birth_date: fechaFutura ? 'La fecha de nacimiento no es válida.' : edad !== null && (edad < MIN_WORK_AGE || edad > MAX_WORK_AGE) ? `La edad debe ser ${MIN_WORK_AGE}-${MAX_WORK_AGE}.` : null,
    municipality: form.department && !form.municipality ? 'Falta el municipio de la dirección.' : null,
    phone: telMal(form.phone) || (form.extra_phones || []).some(telMal) ? 'Hay un teléfono que no cuadra.' : null,
    emergency_contact_phone: telMal(form.emergency_contact_phone) ? 'El teléfono de emergencia no cuadra.' : null,
    email: [form.email, ...(form.extra_emails || [])].some((c) => c && c.trim() && !isValidEmail(c.trim())) ? 'Hay un correo que no cuadra.' : null,
    isss_number: veIdentidad && form.isss_number && digitos(form.isss_number) !== 9 ? 'El número ISSS lleva 9 dígitos.' : null,
    afp_number: veIdentidad && !revisarNup(form.afp_number, form.dui).ok ? 'El NUP no cuadra.' : null,
    code: form.code && !/^\d+$/.test(form.code) ? 'El código lleva sólo números.' : null,
    contract_end_date: contratoConPlazo(form.contract_type) && form.contract_end_date && form.contract_start_date && form.contract_end_date <= form.contract_start_date
      ? 'El fin del contrato tiene que ser después del inicio.' : null,
    weekly_contracted_hours: form.contract_type !== 'SERVICIOS' && !(Number(form.weekly_contracted_hours) >= 1 && Number(form.weekly_contracted_hours) <= 44) ? 'Las horas van de 1 a 44.' : null,
    base_salary: esAlta && veSalario && form.base_salary !== '' && !(Number(form.base_salary) > 0) ? 'El salario tiene que ser mayor a 0.' : null,
    dependientes: (form.economic_dependents || []).some(isDependentAgeInvalid) ? 'Hay un dependiente con una edad que no cuadra.' : null,
    discapacidad: form.has_disability && (!form.disability_type || form.disability_type === OTRA_ESPECIALIDAD || !form.disability_grade) ? 'Falta el tipo o el grado de la discapacidad.' : null,
  };
  const motivo = Object.values(problemas).find(Boolean) || null;
  const err = (k) => (intento || form[k] ? problemas[k] : null);

  const datosDelAlta = () => {
    const d = {};
    for (const k of CAMPOS) d[k] = form[k];
    if (form.contactos_extra !== undefined) d.contactos_extra = form.contactos_extra;
    d.enlazar_con_id = form.enlazar_con_id || '';
    if (form.enlazar_con_id) d._fichaCargada = form._fichaCargada;
    d.username = usuarioSugerido;
    if (!contratoConPlazo(d.contract_type)) d.contract_end_date = '';
    if (!veSalario) delete d.base_salary;
    if (!cubreVarias) d.assigned_branch_ids = [];
    return d;
  };
  const cambiosDeLaEdicion = () => {
    const c = {};
    for (const k of CAMPOS) {
      if (BLOQUEADOS_AL_EDITAR.has(k)) continue;
      if (DE_IDENTIDAD.has(k) && !veIdentidad) continue;
      if (DE_BANCO.has(k) && !veBanco) continue;
      if (k === 'code' && !credencialesListas) continue;
      if (!igual(form[k], inicial[k])) c[k] = form[k] === '' ? null : form[k];
    }
    if (form.contactos_extra !== undefined) c.contactos_extra = form.contactos_extra;
    for (const grupo of GRUPOS) {
      if (grupo.some((k) => k in c)) for (const k of grupo) if (!(k in c) && form[k] !== undefined) c[k] = form[k];
    }
    if (c.username !== undefined && !c.username) delete c.username;
    return c;
  };

  const avisarAlta = (r) => {
    const partes = [];
    if (r?.enlazadoCon) partes.push(`Quedó sobre la ficha de ${shortEmployeeName(r.enlazadoCon)}, que conserva su historial.`);
    if (r?.tempPassword) {
      Clipboard.setStringAsync(r.tempPassword).catch(() => {});
      partes.push(`Usuario: ${r.username} · Contraseña temporal: ${r.tempPassword} (copiada). Anótala: no se puede volver a ver.`);
    } else if (r?.contrasenaConservada) {
      partes.push(`Entra igual que siempre, con el usuario ${r.username} y la contraseña que ya tenía.`);
    } else if (r?.accesoFallo) {
      partes.push('Todavía no tiene acceso al portal (mira el aviso).');
    }
    if (r?.avisoDeUsuario) partes.push(`El usuario no cambió: ${r.avisoDeUsuario}`);
    if (r?.avisos?.length) partes.push(`Falta algo: ${r.avisos.join(' ')}`);
    Alert.alert(r?.enlazadoCon ? 'Expediente enlazado' : 'Empleado registrado', partes.join('\n\n') || 'La ficha se guardó.', [{ text: 'Listo', onPress: () => router.back() }]);
  };

  const guardar = async () => {
    setIntento(true);
    if (motivo) { fallo('No se puede guardar todavía', motivo); return; }
    const d = esAlta ? datosDelAlta() : cambiosDeLaEdicion();
    if (!esAlta && !Object.keys(d).length) { router.back(); return; }
    setGuardando(true);
    try {
      if (esAlta) {
        const r = await addEmployee(d);
        descartar();
        avisarAlta(r);
      } else {
        await updateEmployee(emp.id, d);
        listo('Ficha guardada', shortEmployeeName(emp));
        router.back();
      }
    } catch (e) {
      fallo('No se pudo guardar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };

  if (!puedeEditar) return <Aviso tono="freno" texto="Tu cargo no puede dar de alta ni editar fichas." />;
  if (!esAlta && !emp) return <Aviso tono="freno" texto="No se encontró la ficha." />;

  const nombreDe = (lista, val) => lista.find((o) => String(o.id) === String(val))?.label || '—';

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: esAlta ? 'Nuevo empleado' : 'Editar ficha', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          {esAlta && recuperado ? <Aviso texto="Se recuperó lo que habías escrito antes (sin salario, DUI ni código)." /> : null}
          <Segmentos opciones={PESTANAS} activa={pestana} onCambiar={setPestana} margen={0} />

          {pestana === 'personal' ? (
            <>
              {esAlta ? <Enlazar form={form} setForm={setForm} employees={employees} branches={branches} roles={roles} /> : null}
              {veIdentidad ? (
                <DuiPorCaras form={form} setForm={setForm} empleadoId={emp?.id || null} esMenor={esMenor} quien={user} rotuloAlterno={rotuloAlterno} />
              ) : null}
              <Seccion titulo="Identidad">
                <CampoConRotulo rotulo="Nombres" requerido value={form.first_names} onChangeText={(t) => cambiar('first_names')(t.toUpperCase())} autoCapitalize="characters" error={err('first_names')} />
                <CampoConRotulo rotulo="Apellidos" requerido value={form.last_names} onChangeText={(t) => cambiar('last_names')(t.toUpperCase())} autoCapitalize="characters" error={err('last_names')} />
                <Elegir rotulo="Nacionalidad" valor={form.nationality} opciones={op(NATIONALITY_OPTIONS)} onCambiar={cambiar('nationality')} vacio="Sin indicar" />
                <CampoFecha rotulo={edad !== null && !problemas.birth_date ? `Fecha de nacimiento · ${edad} años${esMenor ? ' · menor de edad' : ''}` : 'Fecha de nacimiento'}
                  valor={form.birth_date} onCambiar={cambiar('birth_date')} error={err('birth_date')} />
                {esMenor ? (
                  <Nota tono="cuidado" texto="Menor de edad (16-17 años). No se le puede asignar turno nocturno, y antes de admitirlo necesita examen médico previo gratuito, que se repite cada año hasta los 18." />
                ) : null}
                {veIdentidad && !esMenor ? (
                  <CampoConRotulo rotulo="DUI" value={form.dui} onChangeText={(t) => cambiar('dui')(maskDui(t))} keyboardType="number-pad" placeholder="00000000-0" error={err('dui')} />
                ) : null}
                {veIdentidad && esMenor ? (
                  <>
                    <ElegirConOtro rotulo="Tipo de documento" valor={form.alt_identity_document_type} opciones={ALT_ID_DOCUMENT_TYPE_OPTIONS}
                      onCambiar={cambiar('alt_identity_document_type')} placeholderOtro="Ej. Carné Consular" vacio="Sin indicar" />
                    <CampoConRotulo rotulo="Número de documento" requerido value={form.alt_identity_document} onChangeText={cambiar('alt_identity_document')}
                      error={err('alt_identity_document')} />
                  </>
                ) : null}
                {veIdentidad ? (
                  <>
                    <CampoFecha rotulo="Vencimiento del documento" valor={form.dui_fecha_vencimiento} onCambiar={cambiar('dui_fecha_vencimiento')} />
                    <CampoConRotulo rotulo="Lugar de expedición del documento" value={form.dui_lugar_expedicion} autoCapitalize="characters"
                      onChangeText={(t) => cambiar('dui_lugar_expedicion')(t.toUpperCase())} placeholder="Ej. Chalatenango" />
                    <CampoFecha rotulo="Fecha de expedición" valor={form.dui_fecha_expedicion} onCambiar={cambiar('dui_fecha_expedicion')} />
                  </>
                ) : <Nota texto="El documento de identidad, el ISSS y el AFP sólo los ve quien tiene la llave del expediente." />}
                <Elegir rotulo="Género" valor={form.gender} opciones={op(GENDER_OPTIONS)} onCambiar={cambiar('gender')} vacio="Sin indicar" />
                <Elegir rotulo="Estado civil" valor={form.marital_status} opciones={op(MARITAL_STATUS_OPTIONS)} onCambiar={cambiar('marital_status')} vacio="Sin indicar" />
              </Seccion>
              <Contacto form={form} setForm={setForm} cambiar={cambiar} />
              <Salud form={form} setForm={setForm} cambiar={cambiar} catalogos={catalogos} />
              <Dependientes form={form} setForm={setForm} />
              <Habilidades form={form} setForm={setForm} catalogos={catalogos} />
              <Vehiculos form={form} cambiar={cambiar} />
            </>
          ) : null}

          {pestana === 'laboral' ? (
            <>
              <Seccion titulo="El puesto" pie={esAlta ? null : 'Sala, cargos e ingreso se cambian con una acción de personal desde la ficha.'}>
                {esAlta ? (
                  <>
                    <Elegir rotulo="Área de trabajo" valor={form.branch_id} opciones={opcionesSala} onCambiar={(v) => setForm((f) => ({ ...f, branch_id: v, assigned_branch_ids: [] }))}
                      vacio="Pendiente" />
                    {cubreVarias ? (
                      <View style={{ gap: 8 }}>
                        <Nota texto={`${sala.name} no es una sala, pero esta persona sí atiende salas. Toca las que le tocan: va a salir en el equipo de cada una.`} />
                        <Enlace texto={(form.assigned_branch_ids || []).length === opcionesSala.length ? 'Quitar todas' : 'Todas'}
                          onPress={() => setForm((f) => ({ ...f, assigned_branch_ids: (f.assigned_branch_ids || []).length === opcionesSala.length ? [] : opcionesSala.map((o) => o.id) }))} />
                        <SalasQueCubre opciones={opcionesSala} elegidas={(form.assigned_branch_ids || []).map(String)} onCambiar={cambiar('assigned_branch_ids')} />
                        {!(form.assigned_branch_ids || []).length ? <Nota texto="Sin áreas elegidas — sólo trabaja en su área de trabajo." /> : null}
                      </View>
                    ) : null}
                    <CampoFecha rotulo="Fecha de inicio de labores" valor={form.hire_date} onCambiar={cambiar('hire_date')} />
                    <Elegir rotulo="Cargo principal" valor={form.role_id} opciones={opcionesCargo} onCambiar={cambiar('role_id')} vacio="Pendiente" />
                    <Elegir rotulo="Cargo secundario (apoyo)" valor={form.secondary_role_id} opciones={opcionesCargo.filter((o) => o.id !== form.role_id)}
                      onCambiar={cambiar('secondary_role_id')} vacio="Ninguno" />
                  </>
                ) : (
                  <>
                    <Dato primero rotulo="Área de trabajo" valor={nombreDe(opcionesSala, form.branch_id)} />
                    <Dato rotulo="Cargo principal" valor={nombreDe(opcionesCargo, form.role_id)} />
                    <Dato rotulo="Cargo secundario" valor={form.secondary_role_id ? nombreDe(opcionesCargo, form.secondary_role_id) : 'Sin cargo secundario'} />
                    <Dato rotulo="Inicio de labores" valor={form.hire_date || '—'} />
                    <Enlace texto="Hacer una acción de personal" onPress={() => router.push({ pathname: '/empleado/accion', params: { id: String(emp.id) } })} />
                  </>
                )}
              </Seccion>
              <Contrato form={form} setForm={setForm} cambiar={cambiar} esAlta={esAlta} veSalario={veSalario} salarioConocido={!!emp?.salario_conocido}
                nombreSala={sala?.name} errores={{ contract_end_date: err('contract_end_date'), weekly_contracted_hours: problemas.weekly_contracted_hours, base_salary: err('base_salary') }} />
              {veIdentidad ? (
                <Acreditaciones form={form} setForm={setForm} cambiar={cambiar} aplicables={aplicables} empleadoId={emp?.id || null} quien={user} />
              ) : null}
              <Herramientas form={form} setForm={setForm} />
            </>
          ) : null}

          {pestana === 'nomina' ? (
            <>
              {veBanco ? <Banco form={form} cambiar={cambiar} /> : null}
              <Acceso form={form} setForm={setForm} cambiar={cambiar} esAlta={esAlta} usuarioSugerido={usuarioSugerido} usuarioGuardado={usuarioGuardado}
                credencialesListas={credencialesListas} />
            </>
          ) : null}

          {intento && motivo ? <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>{motivo}</Text> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : esAlta ? (form.enlazar_con_id ? 'Guardar sobre su ficha' : 'Dar de alta') : 'Guardar cambios'}
            onPress={guardar} deshabilitado={guardando} />
          <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>
            {esAlta ? 'La foto, los estudios y el resto del expediente se completan en «Expediente» de su ficha.' : 'La foto, los estudios y los documentos están en «Expediente».'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/** Las salas que cubre quien no depende de una sala: fichas que se marcan y desmarcan. */
function SalasQueCubre({ opciones, elegidas, onCambiar }) {
  return (
    <View style={{ gap: 8 }}>
      {opciones.map((o) => {
        const activa = elegidas.includes(String(o.id));
        return (
          <Fichas key={o.id} opciones={[{ value: o.id, label: `${activa ? '✓ ' : ''}${o.label}` }]} valor={activa ? o.id : ''}
            onCambiar={() => onCambiar(activa ? elegidas.filter((x) => x !== String(o.id)) : [...elegidas, String(o.id)])} />
        );
      })}
    </View>
  );
}

