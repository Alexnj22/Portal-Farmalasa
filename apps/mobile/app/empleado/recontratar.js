// Recontratar, NATIVO — el `FormRehireEmployee` del portal: a alguien de baja
// se le da un nuevo ingreso sobre la MISMA ficha (conserva su historial). La
// fecha de ingreso, el contrato (medio tiempo pone 22 horas), la sucursal
// agrupada por área, el cargo principal y el secundario, las horas, el salario
// y una nota. Se guarda con `rehireEmployee`, la misma del portal; las reglas,
// en el núcleo (`reingresoYRecontratacion`). El borrador se guarda solo
// (`recontratacion_<id>`, la misma clave del portal).
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  CONTRATOS_DE_RECONTRATACION, datosDeRecontratacion, horasAlCambiarContrato, recontratacionCompleta, recontratacionInicial, sucursalesPorArea,
} from '@nucleo/utils/reingresoYRecontratacion';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';

export default function Recontratar() {
  const { id } = useLocalSearchParams();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const roles = useStaffStore((s) => s.roles);
  const recontratar = useStaffStore((s) => s.rehireEmployee);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const [f, setF] = useState(() => recontratacionInicial(hoySV()));
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const pon = (c) => setF((p) => ({ ...p, ...c }));
  const { recuperado, descartar } = useBorrador(emp ? `recontratacion_${emp.id}` : null, f);
  const [repuesto, setRepuesto] = useState(false);
  if (recuperado && !repuesto) { setRepuesto(true); setF((p) => ({ ...p, ...recuperado })); }
  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona." />;

  const grupos = sucursalesPorArea(sucursales || []);
  const cargos = [...(roles || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
    .filter((c) => !busca.trim() || tokenMatch(busca.trim(), c.name));

  const guardar = () => Alert.alert('¿Recontratar?', `${shortEmployeeName(emp)} vuelve a estar activa desde el ${fechaTexto(f.rehire_hire_date, { day: 'numeric', month: 'long', year: 'numeric' })}, con su historial.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Recontratar', onPress: async () => {
      setEnviando(true); trabajando('Recontratando…');
      try {
        await recontratar(emp.id, datosDeRecontratacion(f));
        descartar();
        listo('Recontratación registrada', `${shortEmployeeName(emp)} ha sido recontratado/a.`);
        volver(`/empleado/${emp.id}`);
      } catch (e) { fallo('No se recontrató', mensajeAmigable(e, 'Error al procesar la recontratación.')); }
      finally { setEnviando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Recontratación', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <Avatar empleado={emp} tamano={56} />
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{emp.name}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Última salida: ${emp.contract_end_date ? fechaTexto(emp.contract_end_date, { day: '2-digit', month: 'long', year: 'numeric' }) : 'No registrada'}`}</Text>
          <Seccion titulo="Ingreso y contrato">
            <Fecha valor={f.rehire_hire_date} onCambiar={(v) => pon({ rehire_hire_date: v })} />
            <Opciones valor={f.rehire_contract_type} onCambiar={(v) => pon({ rehire_contract_type: v, rehire_weekly_hours: horasAlCambiarContrato(v, f.rehire_weekly_hours) })}
              opciones={CONTRATOS_DE_RECONTRATACION.map((c) => ({ id: c.value, label: c.label }))} />
          </Seccion>
          {grupos.map((g) => (
            <Seccion key={g.tipo} titulo={g.rotulo}>
              <Opciones valor={f.rehire_branch_id ? String(f.rehire_branch_id) : ''} onCambiar={(v) => pon({ rehire_branch_id: v })}
                opciones={g.salas.map((b) => ({ id: String(b.id), label: b.name }))} />
            </Seccion>
          ))}
          <Seccion titulo="Cargo principal">
            <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar cargo" />
            <Opciones valor={f.rehire_role_id ? String(f.rehire_role_id) : ''} onCambiar={(v) => pon({ rehire_role_id: v })}
              opciones={cargos.map((c) => ({ id: String(c.id), label: c.name }))} />
          </Seccion>
          <Seccion titulo="Cargo secundario (opcional)">
            <Opciones valor={f.rehire_secondary_role_id ? String(f.rehire_secondary_role_id) : ''}
              onCambiar={(v) => pon({ rehire_secondary_role_id: String(f.rehire_secondary_role_id) === v ? null : v })}
              opciones={cargos.map((c) => ({ id: String(c.id), label: c.name }))} />
          </Seccion>
          <Seccion titulo="Horas y salario">
            <Campo multiline={false} keyboardType="number-pad" placeholder="Horas semanales" value={String(f.rehire_weekly_hours || '')} onChangeText={(t) => pon({ rehire_weekly_hours: t.replace(/\D/g, '') })} />
            <Campo multiline={false} keyboardType="decimal-pad" placeholder="Salario base ($)" value={String(f.rehire_base_salary || '')} onChangeText={(t) => pon({ rehire_base_salary: t.replace(/[^0-9.]/g, '') })} />
          </Seccion>
          <Seccion titulo="Notas">
            <Campo value={f.rehire_notes || ''} onChangeText={(t) => pon({ rehire_notes: t })} placeholder="Ej.: regresa tras cierre de proyecto externo, período de prueba…" />
          </Seccion>
          {!recontratacionCompleta(f) ? <Aviso tono="cuidado" texto="Fecha de ingreso, sucursal y cargo son obligatorios." /> : null}
          <BotonGrande texto={enviando ? 'Recontratando…' : 'Recontratar'} color={MARCA.verde} deshabilitado={!recontratacionCompleta(f) || enviando} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
