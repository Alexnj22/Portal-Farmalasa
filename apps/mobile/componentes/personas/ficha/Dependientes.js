// «Personas que dependen económicamente», como en el alta del portal: nombre,
// fecha de nacimiento —o sólo la edad, cuando no se sabe la fecha (los
// criterios viven en `economicDependents`, núcleo, los mismos que aplica el
// store al guardar)—, parentesco y dirección, que se puede copiar de la del
// empleado o de otro dependiente del mismo hogar.
import { View } from 'react-native';
import { EL_SALVADOR_GEO } from '@nucleo/data/elSalvadorGeo';
import { PARENTESCO_OPTIONS } from '@nucleo/utils/fichaDelEmpleado';
import { MAX_DEPENDENT_AGE, MIN_DEPENDENT_AGE, getDependentAge, isDependentAgeInvalid, isDependentAgeOnly } from '@nucleo/utils/economicDependents';
import { calcAge } from '@nucleo/utils/ageUtils';
import { Seccion } from '../../formulario/Piezas';
import { CampoFecha } from '../Formulario';
import { CampoConRotulo, Elegir, Enlace, Nota, Subtarjeta, op } from './Piezas';

const DEPARTAMENTOS = Object.keys(EL_SALVADOR_GEO).map((d) => ({ id: d, label: d }));
const municipios = (dep) => (EL_SALVADOR_GEO[dep] || []).map((m) => ({ id: m, label: m }));

export default function Dependientes({ form, setForm }) {
  const lista = form.economic_dependents || [];
  const poner = (idx, campo, valor) => setForm((prev) => {
    const arr = [...(prev.economic_dependents || [])];
    const v = (campo === 'name' || campo === 'address') ? valor.toUpperCase() : valor;
    const entry = { ...(arr[idx] || {}), [campo]: v };
    if (campo === 'department') entry.municipality = '';
    arr[idx] = entry;
    return { ...prev, economic_dependents: arr };
  });
  const cambiarModo = (idx) => setForm((prev) => {
    const arr = [...(prev.economic_dependents || [])];
    const cur = arr[idx];
    const soloEdad = !isDependentAgeOnly(cur);
    arr[idx] = { ...cur, age_only: soloEdad, birth_date: soloEdad ? '' : cur.birth_date, age: soloEdad ? cur.age : '' };
    return { ...prev, economic_dependents: arr };
  });
  const copiarDireccion = (idx, origen) => setForm((prev) => {
    const arr = [...(prev.economic_dependents || [])];
    const src = origen === 'employee' ? prev : arr[Number(String(origen).slice(4))];
    if (!src || !arr[idx]) return prev;
    arr[idx] = { ...arr[idx], address: src.address || '', department: src.department || '', municipality: src.municipality || '' };
    return { ...prev, economic_dependents: arr };
  });

  return (
    <Seccion titulo="Personas que dependen económicamente">
      {!lista.length ? <Nota texto="Nadie registrado." /> : null}
      {lista.map((d, i) => {
        const soloEdad = isDependentAgeOnly(d);
        const edad = soloEdad ? getDependentAge(d) : calcAge(d.birth_date);
        const copias = [{ id: 'employee', label: 'Mi dirección (empleado)' },
          ...lista.map((x, k) => ({ x, k })).filter(({ x, k }) => k !== i && (x.address || x.department))
            .map(({ x, k }) => ({ id: `dep-${k}`, label: `Igual que ${x.name || `Persona ${k + 1}`}` }))];
        return (
          <Subtarjeta key={i} titulo={`Persona ${i + 1}`} onQuitar={() => setForm((f) => ({ ...f, economic_dependents: (f.economic_dependents || []).filter((_, k) => k !== i) }))}>
            <CampoConRotulo rotulo="Nombre" value={d.name || ''} onChangeText={(t) => poner(i, 'name', t)} autoCapitalize="characters" placeholder="Nombre completo" />
            {soloEdad ? (
              <CampoConRotulo rotulo="Edad" value={d.age == null ? '' : String(d.age)} keyboardType="number-pad" placeholder="Edad en años"
                onChangeText={(t) => poner(i, 'age', t.replace(/\D/g, ''))}
                error={isDependentAgeInvalid(d) ? `Entre ${MIN_DEPENDENT_AGE} y ${MAX_DEPENDENT_AGE} años` : null} />
            ) : (
              <CampoFecha rotulo="Fecha de nacimiento" valor={d.birth_date || ''} onCambiar={(v) => poner(i, 'birth_date', v)} />
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Nota texto={!soloEdad && edad != null ? `${edad} años` : ' '} />
              <Enlace texto={soloEdad ? 'Sé la fecha' : 'No sé la fecha'} onPress={() => cambiarModo(i)} />
            </View>
            <Elegir rotulo="Parentesco" valor={d.relationship || ''} opciones={op(PARENTESCO_OPTIONS)} onCambiar={(v) => poner(i, 'relationship', v)} vacio="Sin indicar" />
            <Elegir rotulo="Copiar dirección de…" valor="" opciones={copias} onCambiar={(v) => v && copiarDireccion(i, v)} vacio="—" />
            <Elegir rotulo="Departamento" valor={d.department || ''} opciones={DEPARTAMENTOS} onCambiar={(v) => poner(i, 'department', v)} vacio="Sin indicar" />
            <Elegir rotulo="Municipio" valor={d.municipality || ''} opciones={municipios(d.department)} deshabilitado={!d.department}
              onCambiar={(v) => poner(i, 'municipality', v)} vacio={d.department ? 'Sin indicar' : 'Elige el departamento'} />
            <CampoConRotulo rotulo="Dirección detallada" value={d.address || ''} onChangeText={(t) => poner(i, 'address', t)} autoCapitalize="characters" />
          </Subtarjeta>
        );
      })}
      <View><Enlace texto="Agregar persona" onPress={() => setForm((f) => ({ ...f, economic_dependents: [...(f.economic_dependents || []),
        { name: '', birth_date: '', age: '', age_only: false, relationship: '', address: '', department: '', municipality: '' }] }))} /></View>
    </Seccion>
  );
}
