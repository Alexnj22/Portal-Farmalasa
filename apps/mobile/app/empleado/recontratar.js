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
  CONTRATOS_DE_RECONTRATACION, TEMPORAL_LEGAL_BASIS_OPTIONS, datosDeRecontratacion, faltaParaRecontratar, horasAlCambiarContrato, recontratacionCompleta, recontratacionInicial, sucursalesPorArea,
  contratoVencido, contratoNuevoInicial, avisoDeContratoNuevo,
} from '@nucleo/utils/reingresoYRecontratacion';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { contratoConPlazo } from '@nucleo/utils/contrato';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion, PantallaSinDato } from '../../componentes/formulario/Piezas';
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
  // Activa con el contrato vencido: el mismo contrato, sucursal y cargo (2026-11-20).
  const [f, setF] = useState(() => (contratoVencido(emp) ? contratoNuevoInicial(emp, hoySV()) : recontratacionInicial(hoySV())));
  const [busca, setBusca] = useState('');
  const [enviando, setEnviando] = useState(false);
  const pon = (c) => setF((p) => ({ ...p, ...c }));
  const { recuperado, descartar } = useBorrador(emp ? `recontratacion_${emp.id}` : null, f);
  const [repuesto, setRepuesto] = useState(false);
  if (recuperado && !repuesto) { setRepuesto(true); setF((p) => ({ ...p, ...recuperado })); }
  if (!emp) return <PantallaSinDato texto="No se encontró a esta persona." />;
  const vencio = contratoVencido(emp);
  const aviso = avisoDeContratoNuevo(emp, f.rehire_hire_date);
  const completa = recontratacionCompleta(f, emp);

  const grupos = sucursalesPorArea(sucursales || []);
  const cargos = [...(roles || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
    .filter((c) => !busca.trim() || tokenMatch(busca.trim(), c.name));

  const desde = fechaTexto(f.rehire_hire_date, { day: 'numeric', month: 'long', year: 'numeric' });
  const guardar = () => Alert.alert(vencio ? '¿Registrar el contrato nuevo?' : '¿Recontratar?', vencio
    ? `Se cierra el contrato que venció y ${shortEmployeeName(emp)} sigue con el nuevo desde el ${desde}.`
    : `${shortEmployeeName(emp)} vuelve a estar activa desde el ${desde}, con su historial.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: vencio ? 'Registrar' : 'Recontratar', onPress: async () => {
      setEnviando(true); trabajando(vencio ? 'Registrando…' : 'Recontratando…');
      try {
        await recontratar(emp.id, datosDeRecontratacion(f));
        descartar();
        listo(vencio ? 'Contrato nuevo registrado' : 'Recontratación registrada', vencio ? `Se cerró el contrato anterior de ${shortEmployeeName(emp)} y empezó el nuevo.` : `${shortEmployeeName(emp)} ha sido recontratado/a.`);
        volver(`/empleado/${emp.id}`);
      } catch (e) { fallo('No se recontrató', mensajeAmigable(e, 'Error al procesar la recontratación.')); }
      finally { setEnviando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: vencio ? 'Contrato nuevo' : 'Recontratación', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <Avatar empleado={emp} tamano={64} />
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }}>{emp.name}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${vencio ? 'Su contrato venció el' : 'Última salida:'} ${emp.contract_end_date ? fechaTexto(emp.contract_end_date, { day: '2-digit', month: 'long', year: 'numeric' }) : 'No registrada'}`}</Text>
          {aviso ? <Aviso tono="nota" texto={aviso} /> : null}
          <Seccion titulo="Ingreso y contrato">
            <Fecha valor={f.rehire_hire_date} onCambiar={(v) => pon({ rehire_hire_date: v })} />
            <Opciones valor={f.rehire_contract_type} onCambiar={(v) => pon({ rehire_contract_type: v, rehire_weekly_hours: horasAlCambiarContrato(v, f.rehire_weekly_hours) })}
              opciones={CONTRATOS_DE_RECONTRATACION.map((c) => ({ id: c.value, label: c.label }))} />
          </Seccion>
          {/* Un contrato a plazo sin fecha de fin, base legal y motivo es el
              que el Art. 25 presume indefinido: se piden acá, como en el alta. */}
          {contratoConPlazo(f.rehire_contract_type) ? (
            <Seccion titulo="Fecha de fin del contrato">
              <Fecha valor={f.rehire_contract_end_date} onCambiar={(v) => pon({ rehire_contract_end_date: v })} />
            </Seccion>
          ) : null}
          {f.rehire_contract_type === 'TEMPORAL' ? (
            <Seccion titulo="Contrato a plazo (Art. 25)">
              <Opciones valor={f.rehire_temporal_legal_basis || ''} onCambiar={(v) => pon({ rehire_temporal_legal_basis: v })}
                opciones={TEMPORAL_LEGAL_BASIS_OPTIONS.map((o) => ({ id: o.value, label: o.label }))} />
              <Campo value={f.rehire_temporal_reason || ''} onChangeText={(t) => pon({ rehire_temporal_reason: t })} placeholder="Motivo concreto (ej.: cobertura de la incapacidad de la titular)" />
            </Seccion>
          ) : null}
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
          {!completa ? <Aviso tono="cuidado" texto={faltaParaRecontratar(f, emp)} /> : null}
          <BotonGrande texto={enviando ? (vencio ? 'Registrando…' : 'Recontratando…') : (vencio ? 'Registrar el contrato nuevo' : 'Recontratar')} color={MARCA.verde} deshabilitado={!completa || enviando} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
