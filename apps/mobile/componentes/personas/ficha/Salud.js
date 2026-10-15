// «Salud y a quién avisar», como en el alta del portal: tipo de sangre,
// enfermedades crónicas (varias; catálogo abierto `ENFERMEDAD_CRONICA`),
// discapacidad (tipo de catálogo abierto, grado de la escala fija del ISRI y
// si tiene certificación) y los contactos de emergencia.
//
// El contacto principal sigue en sus columnas —las lee el resto del portal—
// con sus teléfonos extra; los demás contactos viajan en `contactos_extra` y el
// store guarda la lista completa (principal primero) en `emergency_contacts`.
// Mientras nadie los toque, se leen de `emergency_contacts` sin el primero,
// igual que el portal.
import { View } from 'react-native';
import { BLOOD_TYPE_OPTIONS, DISABILITY_GRADE_OPTIONS, PARENTESCO_OPTIONS, isValidSVPhone, mascaraTelefono } from '@nucleo/utils/fichaDelEmpleado';
import { OTRA_ESPECIALIDAD } from '@nucleo/utils/educationCatalogs';
import { Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Interruptor } from '../Formulario';
import { CampoConRotulo, Elegir, ElegirConOtro, Enlace, ListaDeTextos, Nota, Subtarjeta, Subtitulo, op } from './Piezas';

const telMal = (t) => !!t && t.replace(/\D/g, '').length > 0 && !isValidSVPhone(t);

/** Los contactos de emergencia además del principal, como los lee el portal. */
export const contactosExtraDe = (form) => form.contactos_extra ?? (form.emergency_contacts || []).slice(1);

export default function Salud({ form, setForm, cambiar, catalogos }) {
  const cronicas = form.chronic_conditions || [];
  const ponerCronica = (i, v) => setForm((f) => ({ ...f, chronic_conditions: (f.chronic_conditions || []).map((c, k) => (k === i ? v : c)) }));
  const extras = contactosExtraDe(form);
  const ponerContacto = (i, patch) => setForm((f) => ({ ...f, contactos_extra: contactosExtraDe(f).map((c, k) => (k === i ? { ...c, ...patch, telefono: undefined } : c)) }));
  const telefonosDe = (c) => (Array.isArray(c.telefonos) ? c.telefonos : c.telefono ? [c.telefono] : ['']);

  return (
    <Seccion titulo="Salud y a quién avisar">
      <Elegir rotulo="Tipo de sangre" valor={form.blood_type} opciones={op(BLOOD_TYPE_OPTIONS)} onCambiar={cambiar('blood_type')} vacio="Sin indicar" />

      <Subtitulo texto="Enfermedad crónica / condición médica" />
      {cronicas.map((c, i) => (
        <View key={i} style={{ gap: 6 }}>
          <ElegirConOtro rotulo={`Condición ${i + 1}`} valor={c} opciones={catalogos.cronicas} onCambiar={(v) => ponerCronica(i, v)} placeholderOtro="Especifica la enfermedad/condición" />
          <Enlace texto="Quitar condición" color={MARCA.rojo} onPress={() => setForm((f) => ({ ...f, chronic_conditions: (f.chronic_conditions || []).filter((_, k) => k !== i) }))} />
        </View>
      ))}
      <View><Enlace texto="Agregar condición" onPress={() => setForm((f) => ({ ...f, chronic_conditions: [...(f.chronic_conditions || []), ''] }))} /></View>

      <Subtitulo texto="Discapacidad" />
      <Interruptor primero titulo="¿Tiene alguna discapacidad?" valor={!!form.has_disability} onCambiar={cambiar('has_disability')} />
      {form.has_disability ? (
        <>
          <ElegirConOtro rotulo="Tipo de discapacidad" valor={form.disability_type} opciones={catalogos.discapacidades} onCambiar={cambiar('disability_type')} placeholderOtro="Especifica el tipo de discapacidad" />
          {form.disability_type === OTRA_ESPECIALIDAD || !form.disability_type ? <Nota tono="cuidado" texto="Falta el tipo." /> : null}
          <Elegir rotulo="Grado" valor={form.disability_grade} opciones={op(DISABILITY_GRADE_OPTIONS)} onCambiar={cambiar('disability_grade')} vacio="Sin indicar"
            error={!form.disability_grade ? 'Falta el grado' : null} />
          <Interruptor titulo="Cuenta con certificación (ISRI / CONAIPD)" detalle={form.disability_has_certification ? 'El documento se sube en el expediente.' : null}
            valor={!!form.disability_has_certification} onCambiar={cambiar('disability_has_certification')} />
        </>
      ) : null}

      <Subtitulo texto="Contacto de emergencia" />
      <CampoConRotulo rotulo="Avisar a" value={form.emergency_contact_name} onChangeText={(t) => cambiar('emergency_contact_name')(t.toUpperCase())} autoCapitalize="characters" placeholder="Nombre" />
      <Elegir rotulo="Parentesco" valor={form.emergency_contact_relationship} opciones={op(PARENTESCO_OPTIONS)} onCambiar={cambiar('emergency_contact_relationship')} vacio="Sin indicar" />
      <CampoConRotulo rotulo="Teléfono" value={form.emergency_contact_phone} onChangeText={(t) => cambiar('emergency_contact_phone')(mascaraTelefono(t))} keyboardType="phone-pad"
        placeholder="0000-0000" error={telMal(form.emergency_contact_phone) ? 'Teléfono inválido' : null} />
      <ListaDeTextos rotulo="Teléfono" valores={form.emergency_contact_extra_phones || []} onCambiar={cambiar('emergency_contact_extra_phones')} placeholder="0000-0000"
        keyboardType="phone-pad" formatear={mascaraTelefono} invalido={telMal} />

      <Subtitulo texto="Otros contactos" />
      {!extras.length ? <Nota texto="Sólo hay un contacto de emergencia." /> : null}
      {extras.map((c, i) => {
        const tels = telefonosDe(c);
        return (
          <Subtarjeta key={i} titulo={`Contacto ${i + 2}`} onQuitar={() => setForm((f) => ({ ...f, contactos_extra: contactosExtraDe(f).filter((_, k) => k !== i) }))}>
            <CampoConRotulo rotulo="Nombre" value={c.nombre || ''} onChangeText={(t) => ponerContacto(i, { nombre: t.toUpperCase() })} autoCapitalize="characters" />
            <Elegir rotulo="Parentesco" valor={c.parentesco || ''} opciones={op(PARENTESCO_OPTIONS)} onCambiar={(v) => ponerContacto(i, { parentesco: v })} vacio="Sin indicar" />
            <CampoConRotulo rotulo="Teléfono" value={tels[0] || ''} keyboardType="phone-pad" placeholder="0000-0000"
              onChangeText={(t) => ponerContacto(i, { telefonos: [mascaraTelefono(t), ...tels.slice(1)] })} />
            <ListaDeTextos rotulo="Teléfono" valores={tels.slice(1)} onCambiar={(resto) => ponerContacto(i, { telefonos: [tels[0] || '', ...resto] })}
              placeholder="0000-0000" keyboardType="phone-pad" formatear={mascaraTelefono} invalido={telMal} />
          </Subtarjeta>
        );
      })}
      <View><Enlace texto="Agregar contacto" onPress={() => setForm((f) => ({ ...f, contactos_extra: [...contactosExtraDe(f), { nombre: '', parentesco: '', telefonos: [''] }] }))} /></View>
    </Seccion>
  );
}
