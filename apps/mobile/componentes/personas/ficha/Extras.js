// Lo demás de la ficha del portal, en tres secciones:
//
//  · Cursos y habilidades (`additional_skills`): curso y la institución, los
//    dos de catálogo abierto (`CURSO_HABILIDAD`, `INSTITUCION_CAPACITACION`),
//    más las horas.
//  · Vehículos y licencias: cuatro casillas; la licencia se sube al expediente.
//  · Herramientas y materiales entregados (Art. 23 nº10): cantidad, qué y en
//    qué estado — los tres, porque sin el estado de entrega no hay con qué
//    comparar el día que se devuelve.
import { View } from 'react-native';
import { ESTADO_HERRAMIENTA_OPTIONS } from '@nucleo/utils/fichaDelEmpleado';
import { Seccion } from '../../formulario/Piezas';
import { Interruptor } from '../Formulario';
import { CampoConRotulo, ElegirConOtro, Enlace, Fichas, Nota, Subtarjeta } from './Piezas';

export function Habilidades({ form, setForm, catalogos }) {
  const lista = form.additional_skills || [];
  const poner = (i, campo, v) => setForm((f) => ({ ...f, additional_skills: (f.additional_skills || []).map((s, k) => (k === i ? { ...s, [campo]: v } : s)) }));
  return (
    <Seccion titulo="Cursos y habilidades">
      {!lista.length ? <Nota texto="Ninguno registrado." /> : null}
      {lista.map((s, i) => (
        <Subtarjeta key={i} titulo={`Curso ${i + 1}`} onQuitar={() => setForm((f) => ({ ...f, additional_skills: (f.additional_skills || []).filter((_, k) => k !== i) }))}>
          <ElegirConOtro rotulo="Curso / habilidad" valor={s.skill || ''} opciones={catalogos.cursos} onCambiar={(v) => poner(i, 'skill', v)} vacio="Sin indicar" />
          <ElegirConOtro rotulo="Institución" valor={s.institution || ''} opciones={catalogos.instituciones} onCambiar={(v) => poner(i, 'institution', v)} vacio="Sin indicar" />
          <CampoConRotulo rotulo="Horas" value={s.hours == null ? '' : String(s.hours)} keyboardType="decimal-pad" onChangeText={(t) => poner(i, 'hours', t.replace(/[^0-9.]/g, ''))} />
        </Subtarjeta>
      ))}
      <View><Enlace texto="Agregar curso / habilidad" onPress={() => setForm((f) => ({ ...f, additional_skills: [...(f.additional_skills || []), { skill: '', institution: '', hours: '' }] }))} /></View>
    </Seccion>
  );
}

export function Vehiculos({ form, cambiar }) {
  return (
    <Seccion titulo="Vehículos y licencias" pie={form.has_motorcycle_license || form.has_car_license ? 'La licencia se sube en el expediente.' : null}>
      <Interruptor primero titulo="Posee moto" valor={!!form.has_motorcycle} onCambiar={cambiar('has_motorcycle')} />
      <Interruptor titulo="Posee carro" valor={!!form.has_car} onCambiar={cambiar('has_car')} />
      <Interruptor titulo="Licencia de motocicleta" valor={!!form.has_motorcycle_license} onCambiar={cambiar('has_motorcycle_license')} />
      <Interruptor titulo="Licencia de automóvil" valor={!!form.has_car_license} onCambiar={cambiar('has_car_license')} />
    </Seccion>
  );
}

export function Herramientas({ form, setForm }) {
  const lista = form.herramientas_entregadas || [];
  const poner = (i, patch) => setForm((f) => ({ ...f, herramientas_entregadas: (f.herramientas_entregadas || []).map((h, k) => (k === i ? { ...h, ...patch } : h)) }));
  return (
    <Seccion titulo="Herramientas y materiales entregados" pie="Lo que la empresa le entrega y tiene que devolver: gabacha, llaves, teléfono, lector. Anota en qué estado se entregó.">
      {!lista.length ? <Nota texto="No se le entregó nada todavía." /> : null}
      {lista.map((h, i) => {
        const incompleto = !h.descripcion || h.cantidad === '' || h.cantidad == null || !h.estado;
        return (
          <Subtarjeta key={i} titulo={`Entrega ${i + 1}`} onQuitar={() => setForm((f) => ({ ...f, herramientas_entregadas: (f.herramientas_entregadas || []).filter((_, k) => k !== i) }))}>
            <CampoConRotulo rotulo="Cantidad" value={h.cantidad == null ? '' : String(h.cantidad)} keyboardType="number-pad" placeholder="1"
              onChangeText={(t) => poner(i, { cantidad: t.replace(/\D/g, '') })} />
            <CampoConRotulo rotulo="Qué se entregó" value={h.descripcion || ''} autoCapitalize="characters" onChangeText={(t) => poner(i, { descripcion: t.toUpperCase() })} />
            <Fichas opciones={ESTADO_HERRAMIENTA_OPTIONS} valor={h.estado} onCambiar={(v) => poner(i, { estado: v })} />
            {incompleto ? <Nota tono="cuidado" texto="Falta la cantidad, la descripción o el estado. Sin el estado de entrega no hay con qué comparar el día que se devuelve." /> : null}
          </Subtarjeta>
        );
      })}
      {lista.length ? <Nota texto={`${lista.length} entrega${lista.length === 1 ? '' : 's'} registrada${lista.length === 1 ? '' : 's'}`} /> : null}
      <View><Enlace texto="Agregar entrega" onPress={() => setForm((f) => ({ ...f, herramientas_entregadas: [...(f.herramientas_entregadas || []), { descripcion: '', cantidad: '', estado: '' }] }))} /></View>
    </Seccion>
  );
}
