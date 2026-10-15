// Contacto y domicilio de la ficha, como en el alta del portal: varios
// teléfonos y correos (el primero es el principal, los demás van en
// `extra_phones` / `extra_emails`), la dirección con departamento, municipio y
// distrito (el catálogo de la reestructuración de 2024, núcleo
// `elSalvadorGeo`) y las direcciones alternas.
import { View } from 'react-native';
import { EL_SALVADOR_GEO, distritosDe } from '@nucleo/data/elSalvadorGeo';
import { isValidEmail, isValidSVPhone, mascaraTelefono } from '@nucleo/utils/fichaDelEmpleado';
import { Seccion } from '../../formulario/Piezas';
import { CampoConRotulo, Elegir, Enlace, ListaDeTextos, Subtarjeta, Subtitulo } from './Piezas';

const DEPARTAMENTOS = Object.keys(EL_SALVADOR_GEO).map((d) => ({ id: d, label: d }));
const municipios = (dep) => (EL_SALVADOR_GEO[dep] || []).map((m) => ({ id: m, label: m }));
const telMal = (t) => !!t && t.replace(/\D/g, '').length > 0 && !isValidSVPhone(t);
const correoMal = (c) => !!c && c.trim() !== '' && !isValidEmail(c.trim());

export default function Contacto({ form, setForm, cambiar }) {
  const ponerDireccion = (idx, campo, valor) => setForm((prev) => {
    const arr = [...(prev.extra_addresses || [])];
    const entry = { ...(arr[idx] || {}), [campo]: campo === 'address' ? valor.toUpperCase() : valor };
    if (campo === 'department') entry.municipality = '';
    arr[idx] = entry;
    return { ...prev, extra_addresses: arr };
  });
  const extras = form.extra_addresses || [];
  return (
    <>
      <Seccion titulo="Contacto">
        <CampoConRotulo rotulo="Teléfono" value={form.phone} onChangeText={(t) => cambiar('phone')(mascaraTelefono(t))} keyboardType="phone-pad" placeholder="0000-0000"
          error={telMal(form.phone) ? 'Teléfono inválido (8 dígitos, empieza en 2, 6 o 7)' : null} />
        <ListaDeTextos rotulo="Teléfono" valores={form.extra_phones || []} onCambiar={cambiar('extra_phones')} placeholder="0000-0000" keyboardType="phone-pad"
          formatear={mascaraTelefono} invalido={telMal} />
        <CampoConRotulo rotulo="Correo" value={form.email} onChangeText={(t) => cambiar('email')(t.trim().toLowerCase())} keyboardType="email-address" autoCapitalize="none"
          placeholder="nombre@correo.com" error={correoMal(form.email) ? 'Correo inválido' : null} />
        <ListaDeTextos rotulo="Correo" valores={form.extra_emails || []} onCambiar={cambiar('extra_emails')} placeholder="otro@correo.com" keyboardType="email-address"
          autoCapitalize="none" formatear={(t) => t.trim().toLowerCase()} invalido={correoMal} />
      </Seccion>

      <Seccion titulo="Dónde vive">
        <CampoConRotulo rotulo="Dirección detallada" value={form.address} onChangeText={(t) => cambiar('address')(t.toUpperCase())} placeholder="Colonia, calle, número de casa…" autoCapitalize="characters" />
        <Elegir rotulo="Departamento" valor={form.department} opciones={DEPARTAMENTOS}
          onCambiar={(v) => setForm((f) => ({ ...f, department: v, municipality: '', distrito: '' }))} vacio="Sin indicar" />
        <Elegir rotulo="Municipio" valor={form.municipality} opciones={municipios(form.department)} deshabilitado={!form.department}
          onCambiar={(v) => setForm((f) => ({ ...f, municipality: v, distrito: '' }))} vacio={form.department ? 'Sin indicar' : 'Elige el departamento'}
          error={form.department && !form.municipality ? 'Falta el municipio' : null} />
        <Elegir rotulo="Distrito" valor={form.distrito} opciones={distritosDe(form.municipality).map((d) => ({ id: d, label: d }))} deshabilitado={!form.municipality}
          onCambiar={cambiar('distrito')} vacio={form.municipality ? 'Pendiente' : 'Elige el municipio'} />
        {extras.length ? <Subtitulo texto="Direcciones alternas" /> : null}
        {extras.map((a, i) => (
          <Subtarjeta key={i} titulo={`Dirección alterna ${i + 1}`} onQuitar={() => setForm((f) => ({ ...f, extra_addresses: (f.extra_addresses || []).filter((_, k) => k !== i) }))}>
            <Elegir rotulo="Departamento" valor={a.department} opciones={DEPARTAMENTOS} onCambiar={(v) => ponerDireccion(i, 'department', v)} vacio="Sin indicar" />
            <Elegir rotulo="Municipio" valor={a.municipality} opciones={municipios(a.department)} deshabilitado={!a.department}
              onCambiar={(v) => ponerDireccion(i, 'municipality', v)} vacio={a.department ? 'Sin indicar' : 'Elige el departamento'} />
            <CampoConRotulo rotulo="Dirección detallada" value={a.address} onChangeText={(t) => ponerDireccion(i, 'address', t)} autoCapitalize="characters" />
          </Subtarjeta>
        ))}
        <View><Enlace texto="Agregar dirección alterna" onPress={() => setForm((f) => ({ ...f, extra_addresses: [...(f.extra_addresses || []), { department: '', municipality: '', address: '' }] }))} /></View>
      </Seccion>
    </>
  );
}
