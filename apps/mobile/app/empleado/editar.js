// Alta y edición de un EMPLEADO, NATIVO — los campos de captura simple del
// formulario del portal (`EmployeeFormModal`): nombre, código, cargos, sala,
// contacto, contrato y fechas. Lo demás (expediente, estudios, dependientes,
// banco, foto, enlazar con una ficha existente) sigue en el portal.
//
// Se guarda con `addEmployee` / `updateEmployee` del store, los MISMOS del
// portal: ahí viven las reglas que importan —el código sólo números y único
// (lo contesta el servidor), el DUI con su dígito, el cupo del cargo, el
// usuario como CREDENCIAL (al editar se renombra con la cuenta, nunca a secas)
// y los datos con llave propia (salario, identidad) por su RPC—.
//
// Al EDITAR se manda sólo lo que cambió: `updateEmployee` acepta una ficha
// parcial, y mandar el formulario entero reescribiría campos que esta pantalla
// ni muestra.
//
// Los cargos y las salas salen de sus tablas (store), nunca de una lista
// escrita a mano: el valor es el id de la fila.
//
// Salario e identidad: igual que el portal. El salario se fija en el alta (con
// la llave `staff_salary`); en la edición se ve bloqueado —un cambio de sueldo
// es otro trámite—. El DUI se muestra y se edita sólo si esta sesión tiene la
// llave de identidad (`identidad_conocida`).
//
// El alta guarda borrador (la sesión de sala se cierra sola a los 5 minutos).
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { usuarioDesdeNombre } from '@nucleo/utils/nameUtils';
import { isValidDUIAlgorithm } from '@nucleo/utils/duiUtils';
import { TIPOS_DE_CONTRATO, contratoConPlazo } from '@nucleo/utils/contrato';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { CampoConRotulo, CampoFecha, Elegir } from '../../componentes/personas/Formulario';
import { fallo, listo } from '../../componentes/Progreso';

const CAMPOS = ['first_names', 'last_names', 'code', 'role_id', 'secondary_role_id', 'branch_id', 'phone', 'email',
  'birth_date', 'gender', 'dui', 'contract_type', 'contract_start_date', 'contract_end_date', 'hire_date', 'weekly_contracted_hours', 'base_salary'];

const GENEROS = [{ id: 'M', label: 'Masculino' }, { id: 'F', label: 'Femenino' }];

function formularioDe(emp) {
  if (!emp) {
    const hoy = hoySV();
    return { first_names: '', last_names: '', code: '', role_id: '', secondary_role_id: '', branch_id: '', phone: '', email: '',
      birth_date: '', gender: '', dui: '', contract_type: 'INDEFINIDO', contract_start_date: hoy, contract_end_date: '', hire_date: hoy,
      weekly_contracted_hours: '44', base_salary: '' };
  }
  const s = (v) => (v == null ? '' : String(v));
  return {
    first_names: s(emp.first_names), last_names: s(emp.last_names), code: s(emp.code),
    role_id: s(emp.role_id), secondary_role_id: s(emp.secondary_role_id), branch_id: s(emp.branch_id ?? emp.branchId),
    phone: s(emp.phone), email: s(emp.email), birth_date: s(emp.birth_date ?? emp.birthDate), gender: s(emp.gender), dui: s(emp.dui),
    contract_type: emp.contract_type || 'INDEFINIDO', contract_start_date: s(emp.contract_start_date), contract_end_date: s(emp.contract_end_date),
    hire_date: s(emp.hire_date ?? emp.hireDate), weekly_contracted_hours: s(emp.weekly_contracted_hours || 44), base_salary: s(emp.base_salary),
  };
}

export default function EditarEmpleado() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('staff_list', 'can_edit');
  const veSalario = hasPermission('staff_salary', 'can_view');
  const employees = useStaffStore((s) => s.employees);
  const roles = useStaffStore((s) => s.roles);
  const branches = useStaffStore((s) => s.branches);
  const addEmployee = useStaffStore((s) => s.addEmployee);
  const updateEmployee = useStaffStore((s) => s.updateEmployee);
  const emp = useMemo(() => (id ? (employees || []).find((e) => String(e.id) === String(id)) : null), [employees, id]);
  const esAlta = !id;
  const [inicial] = useState(() => formularioDe(emp));
  const [form, setForm] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);

  // Borrador sólo del alta. Sin el salario ni el DUI: son datos con llave y un
  // borrador vive en el teléfono sin cifrar.
  const sinSensibles = useMemo(() => { const { base_salary: _s, dui: _d, ...r } = form; return r; }, [form]);
  const { recuperado, descartar } = useBorrador('alta_empleado_app', sinSensibles, { activo: esAlta });
  const [repuesto, setRepuesto] = useState(false);
  if (esAlta && recuperado && !repuesto) { setRepuesto(true); setForm((f) => ({ ...f, ...recuperado })); }

  const cambiar = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const opcionesCargo = useMemo(() => (roles || []).map((r) => ({ id: String(r.id), label: r.name })).sort((a, b) => a.label.localeCompare(b.label)), [roles]);
  const opcionesSala = useMemo(() => (branches || []).map((b) => ({ id: String(b.id), label: b.name })), [branches]);
  const veIdentidad = esAlta || !!emp?.identidad_conocida;
  const usuario = esAlta ? usuarioDesdeNombre(form.first_names, form.last_names) : (emp?.username || '');

  const problemas = {
    first_names: !form.first_names.trim() ? 'Escribe los nombres' : null,
    last_names: !form.last_names.trim() ? 'Escribe los apellidos' : null,
    code: form.code && !/^\d+$/.test(form.code.trim()) ? 'El código lleva sólo números' : null,
    role_id: !form.role_id ? 'Elige el cargo' : null,
    branch_id: !form.branch_id ? 'Elige la sala' : null,
    dui: veIdentidad && form.dui && !isValidDUIAlgorithm(form.dui) ? 'DUI inválido' : null,
    contract_end_date: contratoConPlazo(form.contract_type) && form.contract_end_date && form.contract_start_date && form.contract_end_date <= form.contract_start_date
      ? 'El fin tiene que ser después del inicio' : null,
    base_salary: esAlta && veSalario && form.base_salary !== '' && !(Number(form.base_salary) > 0) ? 'Tiene que ser mayor a 0' : null,
  };
  const valido = !Object.values(problemas).some(Boolean);
  const err = (k) => (intento || (form[k] && k !== 'first_names') ? problemas[k] : null);

  // Lo que se manda: en el alta, todo lo de esta pantalla; al editar, sólo lo
  // que cambió (y nunca el salario ni, sin la llave, el DUI).
  const datos = () => {
    const d = { ...form, username: esAlta ? usuario : undefined };
    if (!contratoConPlazo(d.contract_type)) d.contract_end_date = '';
    if (esAlta) {
      if (!veSalario) delete d.base_salary;
      return d;
    }
    const cambios = {};
    for (const k of CAMPOS) {
      if (k === 'base_salary') continue;
      if (k === 'dui' && !veIdentidad) continue;
      if (String(d[k] ?? '') !== String(inicial[k] ?? '')) cambios[k] = d[k] === '' ? null : d[k];
    }
    return cambios;
  };

  const guardar = async () => {
    setIntento(true);
    if (!valido) { fallo('Faltan datos', 'Revisa los campos marcados.'); return; }
    const d = datos();
    if (!esAlta && !Object.keys(d).length) { router.back(); return; }
    const hacer = async () => {
      setGuardando(true);
      try {
        if (esAlta) await addEmployee(d);
        else await updateEmployee(emp.id, d);
        descartar();
        listo(esAlta ? 'Empleado registrado' : 'Ficha guardada', `${form.first_names} ${form.last_names}`.trim());
        router.back();
      } catch (e) {
        fallo('No se pudo guardar', mensajeAmigable(e));
      } finally {
        setGuardando(false);
      }
    };
    // Cambiar de sala o de cargo mueve a la persona de equipo: se confirma.
    if (!esAlta && (d.branch_id !== undefined || d.role_id !== undefined)) {
      Alert.alert('¿Guardar el cambio?', 'Cambiar la sala o el cargo mueve a esta persona de equipo y de quién la aprueba.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: hacer },
      ]);
      return;
    }
    hacer();
  };

  if (!puedeEditar) return <Aviso tono="freno" texto="Tu cargo no puede dar de alta ni editar fichas." />;
  if (!esAlta && !emp) return <Aviso tono="freno" texto="No se encontró la ficha." />;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: esAlta ? 'Nuevo empleado' : 'Editar ficha', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          {esAlta && recuperado ? <Aviso texto="Se recuperó lo que habías escrito antes (sin salario ni DUI)." /> : null}
          <Seccion titulo="La persona">
            <CampoConRotulo rotulo="Nombres" requerido value={form.first_names} onChangeText={(t) => cambiar('first_names')(t.toUpperCase())} autoCapitalize="characters" error={err('first_names')} />
            <CampoConRotulo rotulo="Apellidos" requerido value={form.last_names} onChangeText={(t) => cambiar('last_names')(t.toUpperCase())} autoCapitalize="characters" error={err('last_names')} />
            <CampoFecha rotulo="Fecha de nacimiento" valor={form.birth_date} onCambiar={cambiar('birth_date')} />
            <Elegir rotulo="Género" valor={form.gender} opciones={GENEROS} onCambiar={cambiar('gender')} vacio="Sin indicar" />
            {veIdentidad ? (
              <CampoConRotulo rotulo="DUI" value={form.dui} onChangeText={cambiar('dui')} keyboardType="number-pad" placeholder="00000000-0" error={err('dui')} />
            ) : null}
          </Seccion>

          <Seccion titulo="En la empresa" pie={esAlta ? `Entrará al portal como «${usuario || '…'}».` : `Usuario: ${usuario || '—'} (se cambia desde el portal: es la credencial con la que entra).`}>
            <CampoConRotulo rotulo="Código (carné)" value={form.code} onChangeText={(t) => cambiar('code')(t.replace(/\D/g, ''))} keyboardType="number-pad" error={err('code')} />
            <Elegir rotulo="Cargo principal" requerido valor={form.role_id} opciones={opcionesCargo} onCambiar={cambiar('role_id')} error={err('role_id')} />
            <Elegir rotulo="Cargo secundario" valor={form.secondary_role_id} opciones={opcionesCargo.filter((o) => o.id !== form.role_id)} onCambiar={cambiar('secondary_role_id')} vacio="Ninguno" />
            <Elegir rotulo="Sala" requerido valor={form.branch_id} opciones={opcionesSala} onCambiar={cambiar('branch_id')} error={err('branch_id')} />
            <CampoFecha rotulo="Fecha de ingreso" valor={form.hire_date} onCambiar={cambiar('hire_date')} />
          </Seccion>

          <Seccion titulo="Contacto">
            <CampoConRotulo rotulo="Teléfono" value={form.phone} onChangeText={cambiar('phone')} keyboardType="phone-pad" placeholder="0000-0000" />
            <CampoConRotulo rotulo="Correo" value={form.email} onChangeText={(t) => cambiar('email')(t.trim().toLowerCase())} keyboardType="email-address" autoCapitalize="none" />
          </Seccion>

          <Seccion titulo="Contrato">
            <Elegir rotulo="Tipo de contrato" valor={form.contract_type} opciones={TIPOS_DE_CONTRATO.map((t) => ({ id: t.value, label: t.label }))} onCambiar={cambiar('contract_type')} />
            <CampoFecha rotulo="Inicio del contrato" valor={form.contract_start_date} onCambiar={cambiar('contract_start_date')} />
            {contratoConPlazo(form.contract_type) ? (
              <CampoFecha rotulo="Fin del contrato" valor={form.contract_end_date} onCambiar={cambiar('contract_end_date')} desde={form.contract_start_date || undefined} error={err('contract_end_date')} />
            ) : null}
            <Elegir rotulo="Horas semanales" valor={['44', '22'].includes(String(form.weekly_contracted_hours)) ? String(form.weekly_contracted_hours) : String(form.weekly_contracted_hours)}
              opciones={[{ id: '44', label: 'Tiempo completo 44h' }, { id: '22', label: 'Medio tiempo 22h' },
                ...(!['44', '22'].includes(String(form.weekly_contracted_hours)) && form.weekly_contracted_hours ? [{ id: String(form.weekly_contracted_hours), label: `${form.weekly_contracted_hours}h` }] : [])]}
              onCambiar={cambiar('weekly_contracted_hours')} />
            {esAlta && veSalario ? (
              <CampoConRotulo rotulo={form.contract_type === 'SERVICIOS' ? 'Honorario' : 'Salario base'} value={form.base_salary} onChangeText={(t) => cambiar('base_salary')(t.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad" placeholder="0.00" error={err('base_salary')} />
            ) : null}
            {!esAlta && emp?.salario_conocido ? <Dato rotulo={form.contract_type === 'SERVICIOS' ? 'Honorario' : 'Salario base'} valor={emp.base_salary ? formatMoney(emp.base_salary) : '—'} /> : null}
          </Seccion>

          <BotonGrande texto={guardando ? 'Guardando…' : esAlta ? 'Dar de alta' : 'Guardar cambios'} onPress={guardar} deshabilitado={guardando} />
          <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>
            Expediente, estudios, dependientes, banco y foto se completan en el portal.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
