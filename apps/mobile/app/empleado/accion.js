// Acción de personal (novedad), NATIVA — el «Acción RRHH» de la ficha del
// portal (`FormNovedad` dentro de `UnifiedModal`): traslado, cambio de cargo
// (con o sin cambio de sala), ajuste salarial, vacaciones, incapacidad,
// permiso por días sueltos, apoyo temporal por tramos, cambio de código,
// inducción, baja y recontratación. Mismos campos, mismos avisos (plaza
// ocupada, asueto, los días que dicta la ley, acción programada a futuro,
// desvinculación) y las MISMAS reglas: viven en el núcleo
// (`novedadDePersonal`), y el pin del carné nuevo también (`pinDeKiosco`).
//
// Se guarda con `registerEmployeeEvent` del store —el mismo que usa el
// portal— con el respaldo adjunto (obligatorio en incapacidad y baja). Con
// `?evento=<id>` corrige una existente (`editEmployeeEvent`), como el
// «Editar» del historial del portal. El borrador se guarda solo
// (`novedad_<id>`, la misma clave del portal).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { DISABILITY_TYPES, EVENT_TYPES, TERMINATION_REASONS, opcionesDeCatalogo } from '@nucleo/data/constants';
import { codigoDeCarneLibre } from '@nucleo/data/employees';
import {
  TIPOS_PROGRAMABLES, antiguedad, asuetoDelDia, avisoDeDiasDeLey, diaDeRegreso, diasDelPeriodo, finPorDias, finPorLey,
  opcionesDeNovedad, plazaOcupada, rasgosDeNovedad, respaldoObligatorio, validarNovedad,
} from '@nucleo/utils/novedadDePersonal';
import { pinDeKiosco } from '@nucleo/utils/pinDeKiosco';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { elegirArchivo } from '../../componentes/sucursal/elegirArchivo';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';

const larga = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

function Fila({ rotulo, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16, flex: 1 }}>{rotulo}</Text>
      {children}
    </View>
  );
}

export default function AccionDePersonal() {
  const { id, tipo, evento } = useLocalSearchParams();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const roles = useStaffStore((s) => s.roles);
  const asuetos = useStaffStore((s) => s.holidays);
  const registrar = useStaffStore((s) => s.registerEmployeeEvent);
  const editar = useStaffStore((s) => s.editEmployeeEvent);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const eventoAEditar = useMemo(() => (evento ? (emp?.history || []).find((ev) => String(ev.id) === String(evento)) : null), [emp, evento]);

  const [f, setF] = useState(() => {
    if (eventoAEditar) {
      const meta = typeof eventoAEditar.metadata === 'string' ? JSON.parse(eventoAEditar.metadata || '{}') : (eventoAEditar.metadata || {});
      return { ...meta, type: eventoAEditar.type, date: eventoAEditar.date, endDate: eventoAEditar.endDate ?? meta.endDate ?? null, note: eventoAEditar.note || '', manualEndDateOverride: true };
    }
    return { type: tipo || '', date: hoySV() };
  });
  const [archivo, setArchivo] = useState(null);
  const [buscaCargo, setBuscaCargo] = useState('');
  const [nuevoTramo, setNuevoTramo] = useState({ start: hoySV(), end: hoySV() });
  const [diaDePermiso, setDiaDePermiso] = useState(hoySV());
  const [enviando, setEnviando] = useState(false);
  const pon = (cambios) => setF((p) => ({ ...p, ...cambios }));

  // El borrador: sólo para una novedad NUEVA (al corregir, la fila de la base es la verdad).
  const { recuperado, descartar } = useBorrador(!eventoAEditar && emp ? `novedad_${emp.id}` : null, f);
  const [repuesto, setRepuesto] = useState(false);
  if (!eventoAEditar && recuperado && !repuesto) { setRepuesto(true); setF((p) => ({ ...p, ...recuperado })); }

  const r = rasgosDeNovedad(f.type, f);

  // El fin que pone la ley (vacaciones 15 días, maternidad 112), salvo que se haya movido a mano.
  useEffect(() => {
    if (!f.date || f.manualEndDateOverride) return;
    const fin = finPorLey(f.type, f.date, f.disabilityType);
    if (fin && f.endDate !== fin) setF((p) => ({ ...p, endDate: fin }));  
  }, [f.type, f.date, f.disabilityType, f.manualEndDateOverride, f.endDate]);
  // Incapacidad: por omisión «enfermedad común», como el portal.
  useEffect(() => {
    if (f.type === 'DISABILITY' && !f.disabilityType) setF((p) => ({ ...p, disabilityType: 'ENFERMEDAD_COMUN' }));  
  }, [f.type, f.disabilityType]);

  // El código nuevo: ¿está libre? (lo contesta el servidor; la última pregunta gana).
  const turno = useRef(0);
  const cambiarCodigo = async (texto) => {
    const limpio = texto.replace(/\D/g, '');
    pon({ newCode: limpio, newKioskPin: limpio ? pinDeKiosco(limpio) : null, hasConflict: false });
    const t = ++turno.current;
    if (!limpio) return;
    const libre = await Promise.resolve(codigoDeCarneLibre(limpio, emp?.id ?? null)).catch(() => null);
    if (t === turno.current) pon({ hasConflict: libre === false });
  };

  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona." />;

  const plaza = plazaOcupada({ type: f.type, formData: f, empleado: emp, empleados: empleados || [], roles: roles || [] });
  const asueto = asuetoDelDia(f.date, asuetos || []);
  const { ok, motivo } = validarNovedad({ formData: f, empleado: emp, empleados: empleados || [], roles: roles || [], asuetos: asuetos || [] });
  const faltaRespaldo = respaldoObligatorio(f.type) && !archivo && !eventoAEditar;
  const otrasSalas = (sucursales || []).filter((b) => String(b.id) !== String(emp.branchId || emp.branch_id));
  const cargos = [...(roles || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
    .filter((c) => !buscaCargo.trim() || tokenMatch(buscaCargo.trim(), c.name));
  const dias = diasDelPeriodo(f.date, f.endDate);
  const avisoLey = avisoDeDiasDeLey(f.type, f.disabilityType, f.date, f.endDate);
  const salarioActual = emp.base_salary || emp.salary;
  const diferencia = salarioActual && f.newSalary ? Number(f.newSalary) - Number(salarioActual) : null;

  const adjuntar = async () => {
    const a = await elegirArchivo(`respaldo_${f.type || 'accion'}`);
    if (a) setArchivo(a);
  };

  const guardar = () => {
    const titulo = EVENT_TYPES[f.type]?.label || 'Acción';
    Alert.alert(eventoAEditar ? 'Guardar los cambios' : `¿Registrar «${titulo}»?`,
      r.esBaja ? `${shortEmployeeName(emp)} pasa a INACTIVO y pierde el acceso al sistema.` : `Queda en el expediente de ${shortEmployeeName(emp)}.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: eventoAEditar ? 'Guardar' : 'Registrar', style: r.esBaja ? 'destructive' : 'default', onPress: async () => {
          setEnviando(true); trabajando('Guardando…');
          try {
            const datos = { ...f };
            delete datos.hasConflict;
            if (eventoAEditar) await editar(eventoAEditar.id, datos, emp.id);
            else await registrar(emp.id, datos, archivo);
            descartar();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            listo(eventoAEditar ? 'Acción corregida' : `${titulo} registrada`, shortEmployeeName(emp));
            volver(`/empleado/${emp.id}`);
          } catch (e) {
            fallo('No se pudo guardar', mensajeAmigable(e, 'Revisa los datos e intenta de nuevo.'));
          } finally { setEnviando(false); }
        } },
      ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: eventoAEditar ? 'Corregir acción' : 'Acción de personal', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`${shortEmployeeName(emp)} · ${emp.role || 'Sin cargo'}`}</Text>

          {eventoAEditar ? null : (
            <Seccion titulo="Tipo de acción">
              <Opciones valor={f.type} onCambiar={(v) => setF({ type: v, date: hoySV(), note: f.note || '' })}
                opciones={opcionesDeNovedad().map((o) => ({ id: o.value, label: o.label }))} />
            </Seccion>
          )}

          {f.type ? (
            <>
              {r.esBaja ? <Aviso tono="freno" texto="Alerta de desvinculación: el estado pasa a INACTIVO y se le revocan los accesos al sistema." /> : null}
              {r.esTraslado && !r.esCargo && !r.esApoyo ? <Aviso texto="Cambio de sucursal: desaparece de la planilla actual de inmediato." /> : null}
              {r.esApoyo ? <Aviso texto="Apoyo temporal: apoya en otra sucursal por un tiempo y sigue en la planilla actual." /> : null}
              {plaza ? (
                <Aviso tono="freno" texto={`Límite de organigrama: ${plaza.role} admite ${plaza.limit} por ${plaza.scope === 'GLOBAL' ? 'empresa' : 'sucursal'}. Lo ocupa: ${plaza.occupants.map((o) => shortEmployeeName(o)).join(', ')}.`} />
              ) : null}
              {TIPOS_PROGRAMABLES.includes(f.type) && f.date && f.date > hoySV() ? (
                <Aviso texto={`Acción programada: se registra hoy y el cambio se aplica solo el ${larga(f.date)} a las 5:00 a. m. Se puede cancelar antes desde el historial.`} />
              ) : null}

              {r.esIncapacidad ? (
                <Seccion titulo="Origen de la incapacidad">
                  <Opciones valor={f.disabilityType} onCambiar={(v) => pon({ disabilityType: v, disabilityDays: null, endDate: null, manualEndDateOverride: false })}
                    opciones={opcionesDeCatalogo(DISABILITY_TYPES).map((o) => ({ id: o.value, label: o.label }))} />
                </Seccion>
              ) : null}

              {r.esPermiso ? (
                <Seccion titulo={`Días de ausencia · ${(f.permissionDates || []).length}`}>
                  <Fila rotulo="Agregar el día">
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Fecha valor={diaDePermiso} onCambiar={setDiaDePermiso} />
                      <Pressable hitSlop={8} onPress={() => { const d = f.permissionDates || []; if (!d.includes(diaDePermiso)) pon({ permissionDates: [...d, diaDePermiso].sort(), date: [...d, diaDePermiso].sort()[0] }); }}
                        style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '700' }}>Agregar</Text></Pressable>
                    </View>
                  </Fila>
                  {(f.permissionDates || []).map((d) => (
                    <Fila key={d} rotulo={larga(d)}>
                      <Pressable hitSlop={8} onPress={() => { const n = (f.permissionDates || []).filter((x) => x !== d); pon({ permissionDates: n, date: n[0] || null }); }}>
                        <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                      </Pressable>
                    </Fila>
                  ))}
                  {!(f.permissionDates || []).length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No hay fechas agregadas.</Text> : null}
                </Seccion>
              ) : r.esApoyo ? (
                <Seccion titulo="Período de apoyo temporal" pie="Puede ser en tramos: cada tramo con su inicio y su fin.">
                  {(f.supportRanges || []).map((t, i) => (
                    <Fila key={`${t.start}-${i}`} rotulo={`${larga(t.start)} → ${larga(t.end)}`}>
                      <Pressable hitSlop={8} onPress={() => { const n = (f.supportRanges || []).filter((_, j) => j !== i); pon({ supportRanges: n, date: n[0]?.start || null, endDate: n[n.length - 1]?.end || null }); }}>
                        <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                      </Pressable>
                    </Fila>
                  ))}
                  <Fila rotulo="Desde"><Fecha valor={nuevoTramo.start} onCambiar={(v) => setNuevoTramo((t) => ({ start: v, end: t.end < v ? v : t.end }))} /></Fila>
                  <Fila rotulo="Hasta"><Fecha valor={nuevoTramo.end} desde={nuevoTramo.start} onCambiar={(v) => setNuevoTramo((t) => ({ ...t, end: v }))} /></Fila>
                  <BotonGrande texto="Agregar el tramo" borde color={MARCA.azulClaro} onPress={() => {
                    const n = [...(f.supportRanges || []), nuevoTramo].sort((a, b) => a.start.localeCompare(b.start));
                    pon({ supportRanges: n, date: n[0].start, endDate: n[n.length - 1].end });
                  }} />
                </Seccion>
              ) : (
                <Seccion titulo={r.esRango ? 'Período' : 'Fecha efectiva'}>
                  <Fila rotulo={r.esRango ? 'Primer día de ausencia' : 'Fecha'}>
                    <Fecha valor={f.date} onCambiar={(v) => pon({
                      date: v,
                      endDate: r.esIncapacidad && f.disabilityDays > 0 ? finPorDias(v, f.disabilityDays) : (r.esIncapacidad ? null : (f.endDate && v > f.endDate ? null : f.endDate)),
                      manualEndDateOverride: false,
                    })} />
                  </Fila>
                  {r.esRango && !(r.esIncapacidad && f.disabilityType !== 'MATERNIDAD') ? (
                    <Fila rotulo={r.esVacacion ? 'Último día' : 'Fecha de retorno / fin'}>
                      <Fecha valor={f.endDate} desde={f.date} onCambiar={(v) => pon({ endDate: v, manualEndDateOverride: true })} />
                    </Fila>
                  ) : null}
                  {r.esIncapacidad && f.disabilityType !== 'MATERNIDAD' ? (
                    <>
                      <Campo multiline={false} keyboardType="number-pad" placeholder="Días de incapacidad (ej. 3)" value={f.disabilityDays ? String(f.disabilityDays) : ''}
                        onChangeText={(t) => { const n = parseInt(t, 10) || 0; pon({ disabilityDays: n, endDate: finPorDias(f.date, n) }); }} />
                      {f.endDate && f.disabilityDays > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Regresa el ${larga(diaDeRegreso(f.endDate))}`}</Text> : null}
                    </>
                  ) : null}
                  {(r.esVacacion || (r.esIncapacidad && f.disabilityType === 'MATERNIDAD')) && f.endDate ? (
                    <Aviso tono={asueto || avisoLey ? 'cuidado' : 'nota'} texto={asueto ? `Día inhábil: ${asueto.name}. La ley prohíbe iniciar esta licencia en asueto.` : `Días calculados: ${dias}. ${avisoLey || 'Cálculo verificado según la normativa vigente.'}`} />
                  ) : null}
                </Seccion>
              )}

              {r.esCargo ? (
                <Seccion titulo="Nuevo cargo">
                  <Fila rotulo="¿Cambia también de sucursal?"><Switch value={!!f.isTransferAndPromotion} onValueChange={(v) => pon({ isTransferAndPromotion: v })} /></Fila>
                  <Campo multiline={false} value={buscaCargo} onChangeText={setBuscaCargo} placeholder="Buscar cargo" />
                  <Opciones valor={f.newRole} onCambiar={(v) => pon({ newRole: v })} opciones={cargos.map((c) => ({ id: c.name, label: c.name }))} />
                </Seccion>
              ) : null}

              {r.esTraslado ? (
                <Seccion titulo="Sucursal destino">
                  <Opciones valor={f.targetBranchId ? String(f.targetBranchId) : ''} onCambiar={(v) => pon({ targetBranchId: v })}
                    opciones={otrasSalas.map((b) => ({ id: String(b.id), label: b.name }))} />
                </Seccion>
              ) : null}

              {r.esIncapacidad ? (
                <Seccion titulo="Boleta">
                  <Campo multiline={false} autoCapitalize="characters" placeholder="N° de boleta ISSS / médico (ej. B-12345678)" value={f.certificateNumber || ''}
                    onChangeText={(t) => pon({ certificateNumber: t.toUpperCase() })} />
                </Seccion>
              ) : null}

              {r.esBaja ? (
                <Seccion titulo="Motivo legal de la baja">
                  <Opciones valor={f.terminationReason} onCambiar={(v) => pon({ terminationReason: v })}
                    opciones={opcionesDeCatalogo(TERMINATION_REASONS).map((o) => ({ id: o.value, label: o.label }))} />
                  <Fila rotulo="¿Entregó y firmó el finiquito?"><Switch value={!!f.hasFiniquito} onValueChange={(v) => pon({ hasFiniquito: v })} /></Fila>
                </Seccion>
              ) : null}

              {r.esCodigo ? (
                <Seccion titulo="Código del carné" pie={f.newKioskPin ? 'El carné de plástico nuevo se imprime desde una computadora con la impresora de etiquetas.' : null}>
                  <Dato primero rotulo="Código actual" valor={String(emp.code || emp.employee_code || 'S/N')} />
                  <Campo multiline={false} keyboardType="number-pad" placeholder="Nuevo código (sólo números)" value={f.newCode || ''} onChangeText={cambiarCodigo} />
                  {f.hasConflict ? <Aviso tono="freno" texto={`El código ${f.newCode} ya está en uso. Elige otro.`} /> : null}
                </Seccion>
              ) : null}

              {r.esSalario ? (
                <Seccion titulo="Salario">
                  <Dato primero rotulo="Salario actual" valor={salarioActual ? formatMoney(salarioActual) : '—'} />
                  <Dato rotulo="Cargo" valor={emp.role || '—'} />
                  <Dato rotulo="Antigüedad" valor={antiguedad(emp.hireDate || emp.hire_date)} />
                  <Campo multiline={false} keyboardType="decimal-pad" placeholder="Nuevo salario base mensual" value={f.newSalary ? String(f.newSalary) : ''}
                    onChangeText={(t) => pon({ newSalary: t.replace(/[^0-9.]/g, '') })} />
                  {diferencia != null && !Number.isNaN(diferencia) ? (
                    <Text style={{ color: diferencia > 0 ? MARCA.verde : diferencia < 0 ? MARCA.rojo : colorSistema.texto2, fontSize: 15, fontWeight: '700' }}>
                      {`${diferencia > 0 ? '▲ +' : diferencia < 0 ? '▼ ' : '= '}${formatMoney(diferencia)}`}
                    </Text>
                  ) : null}
                </Seccion>
              ) : null}

              <Seccion titulo="Observaciones o justificación">
                <Campo value={f.note || ''} onChangeText={(t) => pon({ note: t })} style={{ minHeight: 90 }}
                  placeholder={r.esIncapacidad ? 'Diagnóstico o detalles breves…' : r.esBaja ? 'Notas de entrega de activos o pendientes…' : 'Detalla los motivos de esta acción…'} />
              </Seccion>

              {eventoAEditar ? null : (
                <Seccion titulo={`Respaldo ${respaldoObligatorio(f.type) ? '(obligatorio)' : '(opcional)'}`}
                  pie={`${r.esIncapacidad ? 'La boleta médica' : r.esBaja ? 'El finiquito' : 'El respaldo'} — PDF, JPG o PNG, hasta 10 MB.`}>
                  <Fila rotulo={archivo ? archivo.name : 'Sin archivo'}>
                    <Pressable hitSlop={8} onPress={adjuntar} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '700' }}>{archivo ? 'Cambiar' : 'Adjuntar'}</Text>
                    </Pressable>
                  </Fila>
                </Seccion>
              )}

              {motivo ? <Aviso tono="freno" texto={motivo} /> : null}
              {faltaRespaldo ? <Aviso tono="cuidado" texto="Falta adjuntar el respaldo." /> : null}
              <BotonGrande texto={enviando ? 'Guardando…' : eventoAEditar ? 'Guardar los cambios' : 'Registrar la acción'}
                color={r.esBaja ? MARCA.rojo : MARCA.azul} deshabilitado={!ok || faltaRespaldo || enviando} onPress={guardar} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
