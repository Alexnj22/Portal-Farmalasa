// El contrato (Art. 23 del Código de Trabajo), como en la pestaña «Laboral»
// del alta del portal. Toda la regla vive en `utils/contrato.js` (núcleo):
//
//  · tipo e inicio, que en la EDICIÓN se ven bloqueados —se cambian con una
//    acción de personal, igual que en el portal—, y el fin si tiene plazo;
//  · a plazo (Art. 25): la base legal (catálogo cerrado) y el motivo;
//  · servicios profesionales: el aviso del Art. 20, sin horas ni Ministerio;
//  · el horario que va en el papel (`horarioParaElContrato`), horas y salario;
//  · dónde y cuándo se firmó (nº13), cómo se paga (nº9: estipulación, medio,
//    lugar y período);
//  · las prórrogas (sólo al editar: en el alta no hay nada que prorrogar), la
//    cuenta regresiva de la firma y la del ejemplar del Ministerio (Art. 18).
import { View } from 'react-native';
import { ART20_ADVERTENCIA, FORMA_ESTIPULACION_OPTIONS, LUGAR_PAGO_OPTIONS, MEDIO_PAGO_OPTIONS, PLAZO_DE_PAGO, REGLAMENTO_LUGAR_PAGO,
  TIPOS_DE_CONTRATO, TEMPORAL_LEGAL_BASIS_OPTIONS, contratoConPlazo, esContratoCivil, estadoFirmaDelContrato, estadoRemisionMtps,
  horarioParaElContrato } from '@nucleo/utils/contrato';
import { PERIODO_PAGO_OPTIONS } from '@nucleo/utils/fichaDelEmpleado';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { Dato, Seccion } from '../../formulario/Piezas';
import { CampoFecha } from '../Formulario';
import { CampoConRotulo, Elegir, Enlace, Nota, Subtarjeta, Subtitulo, op } from './Piezas';

const largo = (iso) => (iso ? fechaTexto(iso, { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

export default function Contrato({ form, setForm, cambiar, esAlta, veSalario, salarioConocido, nombreSala, errores }) {
  const civil = esContratoCivil(form.contract_type);
  const plazo = contratoConPlazo(form.contract_type);
  const horario = horarioParaElContrato(nombreSala);
  const firma = estadoFirmaDelContrato(form);
  const mtps = estadoRemisionMtps(form);
  const prorrogas = form.contrato_prorrogas || [];
  const ponerProrroga = (idx, patch) => setForm((prev) => {
    const lista = (prev.contrato_prorrogas || []).map((p, i) => (i === idx ? { ...p, ...patch } : p));
    // El fin del contrato pasa a ser el de la última prórroga con fecha.
    const ultima = [...lista].reverse().find((p) => p.hasta);
    return { ...prev, contrato_prorrogas: lista, contract_end_date: ultima?.hasta ?? prev.contract_end_date };
  });
  const horasFijas = ['44', '22'].includes(String(form.weekly_contracted_hours));
  const rotuloSalario = civil ? 'Honorario' : 'Salario base';

  return (
    <Seccion titulo="El contrato" pie={esAlta ? null : 'Tipo, inicio y salario se cambian con una acción de personal desde la ficha.'}>
      {esAlta ? (
        <>
          <Elegir rotulo="Tipo de contrato" valor={form.contract_type} opciones={op(TIPOS_DE_CONTRATO)} onCambiar={cambiar('contract_type')} />
          <CampoFecha rotulo="Fecha de contratación" valor={form.contract_start_date} onCambiar={cambiar('contract_start_date')} />
        </>
      ) : (
        <>
          <Dato primero rotulo="Tipo de contrato" valor={TIPOS_DE_CONTRATO.find((t) => t.value === form.contract_type)?.label || form.contract_type || '—'} />
          <Dato rotulo="Fecha de contratación" valor={largo(form.contract_start_date)} />
        </>
      )}
      {plazo ? (
        <CampoFecha rotulo="Fecha fin" requerido valor={form.contract_end_date} onCambiar={cambiar('contract_end_date')} desde={form.contract_start_date || undefined}
          error={errores.contract_end_date || (!form.contract_end_date ? 'Obligatoria en un contrato a plazo' : null)} />
      ) : null}
      {civil ? <Nota tono="cuidado" texto={`${ART20_ADVERTENCIA} Además: se le retiene el 10% de renta, y no lleva ISSS ni AFP a cargo de la empresa, ni aguinaldo, ni vacaciones, ni indemnización. Tampoco se remite al Ministerio de Trabajo.`} /> : null}
      {form.contract_type === 'TEMPORAL' ? (
        <>
          <Elegir rotulo="Por qué es temporal" valor={form.contract_temporal_legal_basis || ''} opciones={op(TEMPORAL_LEGAL_BASIS_OPTIONS)}
            onCambiar={cambiar('contract_temporal_legal_basis')} vacio="Sin indicar" error={!form.contract_temporal_legal_basis ? 'Requerido' : null} />
          <CampoConRotulo rotulo="Motivo" value={form.contract_temporal_reason || ''} onChangeText={cambiar('contract_temporal_reason')}
            placeholder="Ej. Cobertura de incapacidad de la titular del puesto" />
        </>
      ) : null}

      {!civil ? (
        <>
          <Subtitulo texto="Horario de trabajo" />
          <Nota texto={horario.texto} />
          <Nota texto={horario.fijo ? 'Esta área no rota, así que el contrato dice el horario completo.'
            : 'El contrato remite al reglamento en vez de fijar un horario: los turnos rotan. Quién trabaja qué día se decide en Horarios.'} />
          <Elegir rotulo="Horas semanales" valor={horasFijas ? String(form.weekly_contracted_hours) : 'OTRO'}
            opciones={[{ id: '44', label: 'Tiempo completo 44h' }, { id: '22', label: 'Medio tiempo 22h' }, { id: 'OTRO', label: 'Otro' }]}
            onCambiar={(v) => cambiar('weekly_contracted_hours')(v === 'OTRO' ? '' : v)} />
          {!horasFijas ? (
            <CampoConRotulo rotulo="Horas (otro)" value={String(form.weekly_contracted_hours || '')} keyboardType="number-pad"
              onChangeText={(t) => cambiar('weekly_contracted_hours')(t.replace(/\D/g, '').substring(0, 2))} error={errores.weekly_contracted_hours} />
          ) : null}
        </>
      ) : null}
      {esAlta && veSalario ? (
        <CampoConRotulo rotulo={rotuloSalario} value={form.base_salary} onChangeText={(t) => cambiar('base_salary')(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad" placeholder="0.00" error={errores.base_salary} />
      ) : null}
      {!esAlta && salarioConocido ? <Dato rotulo={rotuloSalario} valor={form.base_salary ? formatMoney(form.base_salary) : '—'} /> : null}

      <Subtitulo texto="Dónde y cuándo se firmó" />
      <CampoConRotulo rotulo="Lugar de la firma" value={form.contrato_lugar_celebracion || ''} autoCapitalize="characters"
        onChangeText={(t) => cambiar('contrato_lugar_celebracion')(t.toUpperCase())} placeholder="Ej. Chalatenango" />
      <CampoFecha rotulo="Fecha de la firma" valor={form.contrato_fecha_celebracion} onCambiar={cambiar('contrato_fecha_celebracion')} />

      <Subtitulo texto="Cómo se paga" />
      <Elegir rotulo="Forma de estipulación" valor={form.forma_estipulacion_salario || ''} opciones={op(FORMA_ESTIPULACION_OPTIONS)} onCambiar={cambiar('forma_estipulacion_salario')} vacio="Sin indicar" />
      {PLAZO_DE_PAGO[form.forma_estipulacion_salario] ? <Nota texto={`Se vuelve exigible: ${PLAZO_DE_PAGO[form.forma_estipulacion_salario]}`} /> : null}
      <Elegir rotulo="Medio de pago" valor={form.medio_pago || ''} opciones={op(MEDIO_PAGO_OPTIONS)} onCambiar={cambiar('medio_pago')} vacio="Sin indicar" />
      <Nota texto="El salario se paga en moneda de curso legal. No se puede pagar con vales, fichas ni cupones." />
      <Elegir rotulo="Lugar de pago" valor={form.lugar_pago || ''} opciones={op(LUGAR_PAGO_OPTIONS)} onCambiar={cambiar('lugar_pago')} vacio="Sin indicar" />
      <Nota texto={REGLAMENTO_LUGAR_PAGO} />
      <Elegir rotulo="Cada cuánto se le paga" valor={form.periodo_pago || ''} opciones={op(PERIODO_PAGO_OPTIONS)} onCambiar={cambiar('periodo_pago')} vacio="Sin indicar" />

      {plazo && !esAlta ? (
        <>
          <Subtitulo texto="Prórrogas" />
          {prorrogas.length >= 2 ? (
            <Nota tono="cuidado" texto={civil
              ? `Van ${prorrogas.length} prórrogas. Cuanto más se extiende una relación de servicios profesionales, más pesa la presunción del Art. 20: si además cumple horario y tiene jefe, la figura correcta es un contrato de trabajo.`
              : `Van ${prorrogas.length} prórrogas. La ley no las limita en número, pero el Art. 25 sólo acepta el plazo si la labor es transitoria: prorrogar no convierte en temporal un puesto permanente.`} />
          ) : null}
          {!prorrogas.length ? <Nota texto="Sin prórrogas." /> : null}
          {prorrogas.map((p, i) => (
            <Subtarjeta key={i} titulo={`Prórroga ${i + 1} · desde ${p.desde || '—'}`}
              onQuitar={() => setForm((f) => ({ ...f, contrato_prorrogas: (f.contrato_prorrogas || []).filter((_, k) => k !== i) }))}>
              <CampoFecha rotulo="Nuevo fin" valor={p.hasta || ''} onCambiar={(v) => ponerProrroga(i, { hasta: v })} />
              <CampoConRotulo rotulo="Motivo" value={p.motivo || ''} onChangeText={(t) => ponerProrroga(i, { motivo: t })} placeholder="Motivo de la prórroga" />
              <Nota texto={civil ? 'Un contrato de servicios profesionales es civil: su prórroga no se remite al Ministerio de Trabajo.'
                : 'Prorrogar vuelve a abrir los 8 días para remitir el ejemplar al Ministerio (Art. 18).'} />
            </Subtarjeta>
          ))}
          <View>
            <Enlace texto={form.contract_end_date ? 'Prorrogar' : 'Prorrogar (primero la fecha de fin)'} deshabilitado={!form.contract_end_date}
              onPress={() => setForm((f) => ({ ...f, contrato_prorrogas: [...(f.contrato_prorrogas || []), { desde: f.contract_end_date || null, hasta: null, motivo: '' }] }))} />
          </View>
        </>
      ) : null}

      {firma.aplica && !firma.firmado ? (
        <Nota tono={firma.vencido || firma.diasRestantes <= 3 ? 'freno' : 'cuidado'} texto={`${firma.vencido ? `El contrato debió firmarse el ${firma.limite}.`
          : firma.diasRestantes === 0 ? 'El contrato se firma hoy.' : `Quedan ${firma.diasRestantes} días para firmar el contrato.`} Se cuentan desde el día que empezó a trabajar. Después va el ejemplar al Ministerio, que tiene su propio plazo.`} />
      ) : null}
      <Subtitulo texto="Ejemplar del Ministerio de Trabajo" />
      {!mtps.aplica ? <Nota texto={mtps.motivo} /> : (
        <>
          {mtps.remitido ? <Nota tono="bien" texto={`Remitido el ${largo(mtps.fecha)}.`} /> : (
            <Nota tono={mtps.vencido ? 'freno' : 'cuidado'} texto={mtps.vencido
              ? `El plazo venció hace ${Math.abs(mtps.diasRestantes)} día${Math.abs(mtps.diasRestantes) === 1 ? '' : 's'}. Se remite igual: no haberlo hecho a tiempo no invalida el contrato.`
              : `Quedan ${mtps.diasRestantes} día${mtps.diasRestantes === 1 ? '' : 's'} para remitir el tercer ejemplar (hasta el ${fechaTexto(mtps.limite, { day: '2-digit', month: 'long' })}).`} />
          )}
          <CampoFecha rotulo="Fecha en que se remitió" valor={form.mtps_remitido_fecha} onCambiar={cambiar('mtps_remitido_fecha')} />
          <Nota texto="El acuse sellado se adjunta en el expediente." />
        </>
      )}
    </Seccion>
  );
}
