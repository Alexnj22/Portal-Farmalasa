// «¿Esta persona ya trabajaba aquí?» — enlazar un alta con su ficha.
//
// El mismo circuito del portal (`EmployeeFormModal`), con la lógica en el
// núcleo (`utils/fichaDelEmpleado.js`): elegir a la persona llena el
// formulario con lo que su ficha ya tenía (`aplicarFichaEnlazada`) y pide lo
// que el padrón no publica —código, DUI, sueldo, cuenta— con
// `traerLoQueFaltaDeLaFicha`. Hasta que eso vuelve, NO se guarda
// (`motivoDelEnlace`): guardar antes escribía en blanco el sueldo y la cuenta
// de la persona, y un código aleatorio encima del suyo.
//
// Al guardar, `addEmployee` escribe SOBRE esa ficha en vez de crear otra: la
// persona conserva sus solicitudes, traslados y todo su historial.
//
// Arriba va el aviso de posible duplicado (`hayHomonimo`): alguien registrado
// con el mismo nombre completo que no es la ficha enlazada.
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { aplicarFichaEnlazada, completarConLoProtegido, fichasParaEnlazar, hayHomonimo, motivoDelEnlace } from '@nucleo/utils/fichaDelEmpleado';
import { traerLoQueFaltaDeLaFicha } from '@nucleo/data/employees';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../../Formulario';
import { Seccion } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Elegir, Nota } from './Piezas';

export default function Enlazar({ form, setForm, employees, branches, roles }) {
  const opciones = useMemo(() => fichasParaEnlazar(employees, branches, roles).map((o) => ({ id: o.value, label: o.label })), [employees, branches, roles]);
  const homonimo = hayHomonimo(form, employees);
  const ficha = form.enlazar_con_id ? (employees || []).find((e) => String(e.id) === String(form.enlazar_con_id)) : null;
  const motivo = motivoDelEnlace(form);

  const elegir = (val) => {
    const elegida = (employees || []).find((e) => String(e.id) === String(val));
    // Lo que ya está en memoria entra YA; lo protegido se pide aparte.
    setForm((prev) => aplicarFichaEnlazada(prev, val, elegida));
    if (!val) return;
    traerLoQueFaltaDeLaFicha(val)
      .then((fuera) => setForm((prev) => completarConLoProtegido(prev, val, fuera)))
      .catch(() => setForm((prev) => (String(prev.enlazar_con_id) !== String(val) ? prev : { ...prev, _fichaFallo: val })));
  };

  return (
    <>
      {homonimo ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: `${MARCA.ambar}22`, gap: 4 }}>
          <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' }}>Posible duplicado</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
            Ya existe un empleado registrado con este mismo nombre completo. Si es la misma persona, enlázala abajo en vez de crear una ficha nueva. Si es otra (homónimo), sigue adelante.
          </Text>
        </View>
      ) : null}
      <Seccion titulo="¿Esta persona ya trabajaba aquí?"
        pie="Enlázala con su ficha para que conserve sus solicitudes, traslados y todo lo que ya hizo. Déjalo vacío si es alguien que entra por primera vez.">
        <Elegir rotulo="Su ficha" valor={form.enlazar_con_id || ''} opciones={opciones} onCambiar={elegir} vacio="Es alguien nuevo" />
        {ficha ? (
          <Nota tono="bien" texto={`El formulario quedó lleno con lo que la ficha de ${shortEmployeeName(ficha)} ya tenía guardado: revísalo y cambia lo que haya cambiado. Al guardar no se crea un registro nuevo — se actualiza el suyo, y conserva su historial.`} />
        ) : null}
        {motivo ? <Nota tono={form._fichaFallo ? 'freno' : 'cuidado'} texto={motivo} /> : null}
      </Seccion>
    </>
  );
}
