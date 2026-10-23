// La QUINCENA de la Auditoría de tiempos (la vista principal del portal): el
// paso de período, las cuatro tarjetas (Empleados / Horas regulares / Extra /
// Ausencias), los turnos extra declarados que esperan respuesta y cada persona,
// agrupada por sala con el subtotal de horas, con su franja (regular, extra,
// nocturnas, tardanza, ausencias) y cuántos días están aprobados.
//
// Acciones con las funciones del portal: «Aprobar todo» por persona
// (`approveTimesheetsBulk`) y Confirmar / Rechazar con motivo un turno extra
// (`resolverTurnoExtra`). «Cerrar quincena» aprueba todos los días que
// quedan sin aprobar (`closeQuincenaTimesheets`, la del portal) de las personas
// que se ven —la sala elegida, o todas—: pide escribir CERRAR, porque desde ahí
// la planilla se arma con esas horas. La suma sale del núcleo
// (`resumenDeQuincena`).
//
// Igual que el portal: un turno extra declarado se puede CONFIRMAR tal cual,
// EDITAR las horas antes de aplicarlo, o RECHAZAR con motivo —también el que
// no declaró horario, que sólo marcó entrada—. Con `time_audit_descargar`, la
// quincena se exporta en CSV (mismas columnas del portal, anotada como salida
// de datos), y una quincena pasada y cerrada ofrece «Ver planilla».
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { approveTimesheetsBulk, closeQuincenaTimesheets, fetchPendingShiftExceptions, fetchQuincenaTimesheets, resolverTurnoExtra } from '@nucleo/data/attendanceAudit';
import { getCurrentQuincenaStart, getQuincenaEnd, nextQuincena, prevQuincena } from '@nucleo/utils/quincena';
import { resumenDeQuincena, RESUMEN_VACIO } from '@nucleo/utils/auditoriaDeTiempos';
import { ordenDeCargo } from '@nucleo/utils/planilla';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { ordenDeSala } from '@nucleo/constants/erp';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import { BotonGrande } from '../formulario/Piezas';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { fallo, listo } from '../Progreso';
import { compartirCsv } from '../fiscal/csv';
import Hora from './Hora';
import { Encabezado, PasoDePeriodo, PildoraDeCargo } from './Piezas';

const h = (n) => `${(Number(n) || 0).toFixed(1)} h`;

function Cifra({ valor, rotulo, color }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 54 }}>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 10, fontWeight: '600' }}>{rotulo}</Text>
    </View>
  );
}

export default function Quincena({ empleados, sucursales, puedeEditar, puedeDescargar = false, usuario, onRecargar, salaNombre = null }) {
  const [inicio, setInicio] = useState(() => getCurrentQuincenaStart());
  const fin = getQuincenaEnd(inicio);
  const [ts, setTs] = useState(null);
  const [turnosExtra, setTurnosExtra] = useState([]);
  const [ocupado, setOcupado] = useState(null);
  const [editando, setEditando] = useState(null); // { id, inicio, fin }

  const cargar = useCallback(async () => {
    const [{ data }, extra] = await Promise.all([
      fetchQuincenaTimesheets(inicio, fin),
      fetchPendingShiftExceptions().catch(() => []),
    ]);
    setTs(data || []);
    setTurnosExtra((extra || []).filter((r) => { const d = r.metadata?.date; return d && d >= inicio && d <= fin; }));
  }, [inicio, fin]);
  useEffect(() => { setTs(null); cargar(); }, [cargar]);
  useEffect(() => { if (onRecargar) onRecargar.current = cargar; }, [cargar, onRecargar]);

  const ids = useMemo(() => new Set((empleados || []).map((e) => String(e.id))), [empleados]);
  const { porPersona, total } = useMemo(() => resumenDeQuincena((ts || []).filter((t) => ids.has(String(t.employee_id)))), [ts, ids]);
  const porSala = useMemo(() => {
    const m = new Map();
    for (const e of [...(empleados || [])].sort((a, b) => ordenDeCargo(a) - ordenDeCargo(b))) {
      const k = String(e.branchId ?? e.branch_id ?? '');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ e, r: porPersona.get(String(e.id)) || RESUMEN_VACIO });
    }
    return [...m.entries()].sort((a, b) => ordenDeSala(Number(a[0])) - ordenDeSala(Number(b[0])));
  }, [empleados, porPersona]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? 'Sin sala';
  const actual = inicio === getCurrentQuincenaStart();

  const aprobarTodo = (e) => {
    const pendientes = (ts || []).filter((t) => String(t.employee_id) === String(e.id) && t.status !== 'APPROVED');
    if (!pendientes.length) return;
    Alert.alert('Aprobar la quincena', `${pendientes.length} día${pendientes.length === 1 ? '' : 's'} de ${shortEmployeeName(e)} quedan aprobados.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Aprobar', onPress: async () => {
        setOcupado(e.id);
        const lista = pendientes.map((t) => t.id);
        const { error } = await approveTimesheetsBulk(lista, { employeeId: e.id, quincena: inicio });
        setOcupado(null);
        if (error) { fallo('No se pudo aprobar', mensajeAmigable(error, 'Intenta de nuevo.')); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setTs((prev) => (prev || []).map((t) => (lista.includes(t.id) ? { ...t, status: 'APPROVED' } : t)));
        listo('Aprobado', `${lista.length} día(s) de ${shortEmployeeName(e)}.`);
      } },
    ]);
  };

  // Lo que falta aprobar de las personas que se ven (no de otras salas).
  const sinAprobar = useMemo(() => (ts || []).filter((t) => ids.has(String(t.employee_id)) && t.status !== 'APPROVED'), [ts, ids]);
  const rotuloQuincena = `${fechaTexto(inicio, { day: 'numeric' })} – ${fechaTexto(fin, { day: 'numeric', month: 'long' })}`;
  const cerrar = () => {
    if (!sinAprobar.length) return;
    const quien = salaNombre ? `de ${salaNombre}` : 'de todas las salas que ves';
    Alert.prompt('Cerrar la quincena',
      `Se aprueban ${sinAprobar.length} día${sinAprobar.length === 1 ? '' : 's'} sin aprobar ${quien} (${rotuloQuincena}). La planilla se arma con esas horas.\n\nEscribe CERRAR para confirmar.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar quincena', style: 'destructive', onPress: async (txt) => {
          if (String(txt || '').trim().toUpperCase() !== 'CERRAR') { fallo('No se cerró', 'Escribe CERRAR para confirmar.'); return; }
          setOcupado('cerrar');
          const lista = sinAprobar.map((t) => t.id);
          // `CERRAR_QUINCENA` lo anota la función, igual que en el portal.
          const { error } = await closeQuincenaTimesheets(lista, { quincena: inicio, new_value: `${lista.length} días aprobados ${quien}`, desde: 'app' });
          setOcupado(null);
          if (error) { fallo('No se pudo cerrar', mensajeAmigable(error, 'Intenta de nuevo.')); return; }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setTs((prev) => (prev || []).map((t) => (lista.includes(t.id) ? { ...t, status: 'APPROVED' } : t)));
          listo('Quincena cerrada', `${lista.length} día(s) aprobados.`);
        } },
      ], 'plain-text');
  };

  // `horas` = { inicio, fin } cuando se editaron antes de aplicar; si no, las declaradas.
  const resolver = async (req, aprobar, motivo = '', horas = null) => {
    const m = req.metadata || {};
    setOcupado(req.id);
    try {
      const { error, yaResuelta } = await resolverTurnoExtra(req, aprobar, {
        confirmedStart: aprobar ? (horas?.inicio ?? m.declaredStart) : null, confirmedEnd: aprobar ? (horas?.fin ?? m.declaredEnd) : null,
        motivo, approverId: usuario?.id, approverName: usuario?.name,
      });
      if (error) throw error;
      setTurnosExtra((prev) => prev.filter((r) => r.id !== req.id));
      setEditando(null);
      if (yaResuelta) fallo('Ya estaba resuelta', 'Alguien la decidió antes, así que no se volvió a aplicar.');
      else listo(aprobar ? 'Confirmado' : 'Rechazado', aprobar ? 'Turno extra aplicado al empleado.' : 'Solicitud rechazada.');
    } catch (err) {
      fallo('No se pudo resolver', mensajeAmigable(err, 'Intenta de nuevo.'));
    } finally { setOcupado(null); }
  };
  const rechazar = (req) => Alert.prompt('Rechazar el turno extra', 'Dile por qué: sin motivo no sabe qué corregir.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Rechazar', style: 'destructive', onPress: (motivo) => {
      if (!String(motivo || '').trim()) { fallo('Falta el motivo', ''); return; }
      resolver(req, false, String(motivo).trim());
    } },
  ], 'plain-text');

  const aplicarEditado = (req) => {
    if (!editando?.inicio || !editando?.fin) { fallo('Faltan las horas', 'Elige la entrada y la salida.'); return; }
    resolver(req, true, '', { inicio: editando.inicio, fin: editando.fin });
  };

  // El mismo CSV del portal: una fila por persona que se ve, con su suma.
  const exportar = () => {
    const filas = porSala.flatMap(([k, lista]) => lista.map(({ e, r }) => [
      nombreSala(k), e.name || '', e.role || '—', r.regular.toFixed(1), r.overtime.toFixed(1), r.late, r.absent, r.approved, r.total,
    ]));
    compartirCsv({
      headers: ['Sucursal', 'Nombre', 'Cargo', 'Horas Regulares', 'Horas extra', 'Tardanzas (min)', 'Ausencias', 'Aprobados', 'Total días'],
      rows: filas, nombre: `quincena-${inicio}`, modulo: 'asistencia', detalle: { quincena: inicio },
    }).catch((e) => fallo('No se pudo exportar', mensajeAmigable(e)));
  };
  // Una quincena PASADA, con días y todo aprobado: como el portal, el atajo a la planilla.
  const pasada = inicio < getCurrentQuincenaStart();
  const quincenaCerrada = (ts || []).length > 0 && (ts || []).every((t) => t.status === 'APPROVED');

  return (
    <View style={{ gap: 12 }}>
      <PasoDePeriodo
        titulo={`${fechaTexto(inicio, { day: 'numeric' })} – ${fechaTexto(fin, { day: 'numeric', month: 'long', year: 'numeric' })}`}
        apoyo={actual ? 'Quincena actual' : null}
        onAtras={() => setInicio(prevQuincena(inicio))}
        onAdelante={() => setInicio(nextQuincena(inicio))} puedeAdelante={!actual} />

      {ts == null ? <ActivityIndicator style={{ marginTop: 20 }} /> : (
        <>
          <FilaDeKpis>
            <Kpi icono="Users" rotulo="Empleados" valor={String((empleados || []).length)} color={MARCA.azulClaro} apoyo={`${total.approved} de ${total.total} días aprobados`} />
            <Kpi icono="Clock" rotulo="Horas regulares" valor={h(total.regular)} color={MARCA.verde} apoyo={total.nocturnal ? `${h(total.nocturnal)} nocturnas` : null} />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="TrendingUp" rotulo="Horas extra" valor={h(total.overtime)} color={MARCA.violetaClaro} apoyo={total.nocturnalOT ? `${h(total.nocturnalOT)} extra nocturnas` : null} />
            <Kpi icono="UserX" rotulo="Ausencias" valor={String(total.absent)} color={total.absent ? MARCA.rojo : colorSistema.texto2} apoyo={total.late ? `${total.late} min de tardanza` : 'sin tardanzas'} />
          </FilaDeKpis>

          {puedeEditar && total.total ? (
            <View style={{ marginHorizontal: 16 }}>
              {sinAprobar.length
                ? <BotonGrande texto={ocupado === 'cerrar' ? 'Cerrando…' : `Cerrar quincena · ${sinAprobar.length} día${sinAprobar.length === 1 ? '' : 's'} sin aprobar`} color={MARCA.verde} onPress={cerrar} deshabilitado={!!ocupado} />
                : <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>Quincena cerrada: todo aprobado</Text>}
            </View>
          ) : null}
          {pasada && quincenaCerrada ? (
            <View style={{ marginHorizontal: 16 }}>
              <BotonGrande texto="Ver planilla" color={MARCA.verde} onPress={() => router.push('/nomina')} />
            </View>
          ) : null}
          {puedeDescargar && porSala.length ? (
            <Pressable onPress={exportar} accessibilityRole="button"
              style={({ pressed }) => ({ alignSelf: 'center', minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}2E`, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Exportar CSV</Text>
            </Pressable>
          ) : null}

          {turnosExtra.length ? (
            <View style={{ gap: 8 }}>
              <Encabezado>{`Turnos extra declarados · ${turnosExtra.length}`}</Encabezado>
              {turnosExtra.map((req) => {
                const m = req.metadata || {};
                const emp = (empleados || []).find((x) => String(x.id) === String(req.employee_id));
                return (
                  <View key={req.id} style={{ marginHorizontal: 16 }}>
                    <Vidrio radio={18} tinte="rgba(105,41,196,0.16)">
                      <View style={{ padding: 12, gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          {emp ? <Avatar empleado={emp} tamano={34} /> : null}
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{emp ? shortEmployeeName(emp) : (m.employeeName || 'Empleado')}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                              {[m.date ? fechaTexto(m.date, { weekday: 'long', day: 'numeric', month: 'long' }) : null,
                                m.declaredStart && m.declaredEnd ? `declara ${m.declaredStart} – ${m.declaredEnd}` : 'no declaró horario — sólo registró entrada',
                                m.pinOmitido ? 'sin PIN' : null].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                        </View>
                        {puedeEditar && editando?.id === req.id ? (
                          <View style={{ gap: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Text style={{ color: colorSistema.texto2, fontSize: 14, width: 52 }}>Entra</Text>
                              <Hora valor={editando.inicio} onCambiar={(v) => setEditando((x) => ({ ...x, inicio: v }))} />
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Text style={{ color: colorSistema.texto2, fontSize: 14, width: 52 }}>Sale</Text>
                              <Hora valor={editando.fin} onCambiar={(v) => setEditando((x) => ({ ...x, fin: v }))} />
                            </View>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                              <Pressable disabled={!!ocupado} onPress={() => aplicarEditado(req)}
                                style={({ pressed }) => ({ flex: 1, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.verde, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{ocupado === req.id ? '…' : 'Aplicar'}</Text>
                              </Pressable>
                              <Pressable onPress={() => setEditando(null)}
                                style={({ pressed }) => ({ flex: 1, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.16)', opacity: pressed ? 0.8 : 1 })}>
                                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>Cancelar</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : puedeEditar ? (
                          <View style={{ flexDirection: 'row', gap: 10 }}>
                            {m.declaredStart && m.declaredEnd ? (
                              <>
                                <Pressable disabled={!!ocupado} onPress={() => resolver(req, true)}
                                  style={({ pressed }) => ({ flex: 1, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.verde, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Confirmar</Text>
                                </Pressable>
                                <Pressable disabled={!!ocupado} onPress={() => setEditando({ id: req.id, inicio: m.declaredStart, fin: m.declaredEnd })}
                                  style={({ pressed }) => ({ flex: 1, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(105,41,196,0.22)', opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                                  <Text style={{ color: MARCA.violetaClaro, fontSize: 14, fontWeight: '700' }}>Editar</Text>
                                </Pressable>
                              </>
                            ) : null}
                            <Pressable disabled={!!ocupado} onPress={() => rechazar(req)}
                              style={({ pressed }) => ({ flex: 1, minHeight: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: MARCA.rojo, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                              <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>Rechazar</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    </Vidrio>
                  </View>
                );
              })}
            </View>
          ) : null}

          {porSala.map(([k, lista]) => {
            const sub = lista.reduce((s, { r }) => ({ reg: s.reg + r.regular, ot: s.ot + r.overtime }), { reg: 0, ot: 0 });
            return (
              <View key={k} style={{ gap: 8 }}>
                <Encabezado>{`${nombreSala(k)} · ${h(sub.reg)}${sub.ot ? ` + ${h(sub.ot)} extra` : ''}`}</Encabezado>
                <View style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={20}>
                    <View style={{ padding: 12, gap: 12 }}>
                      {lista.map(({ e, r }, i) => {
                        const todoAprobado = r.total > 0 && r.approved === r.total;
                        return (
                          <View key={e.id} style={{ gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 12 : 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <Avatar empleado={e} tamano={34} />
                              <View style={{ flex: 1, gap: 2 }}>
                                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{shortEmployeeName(e)}</Text>
                                <PildoraDeCargo cargo={e.role} />
                              </View>
                              <Text style={{ color: todoAprobado ? MARCA.verde : r.total ? MARCA.ambar : colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>
                                {r.total ? (todoAprobado ? 'Aprobada' : `${r.approved}/${r.total} aprobados`) : 'Sin días'}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Cifra valor={h(r.regular)} rotulo="REGULAR" />
                              <Cifra valor={h(r.overtime)} rotulo="EXTRA" color={r.overtime ? MARCA.violetaClaro : undefined} />
                              <Cifra valor={h(r.nocturnal + r.nocturnalOT)} rotulo="NOCTURNAS" color={r.nocturnal + r.nocturnalOT ? MARCA.azulClaro : undefined} />
                              <Cifra valor={`${r.late}m`} rotulo="TARDANZA" color={r.late ? MARCA.ambar : undefined} />
                              <Cifra valor={String(r.absent)} rotulo="AUSENCIAS" color={r.absent ? MARCA.rojo : undefined} />
                            </View>
                            {puedeEditar && r.total && !todoAprobado ? (
                              <Pressable disabled={ocupado === e.id} onPress={() => aprobarTodo(e)}
                                style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: `${MARCA.verde}2E`, opacity: pressed ? 0.7 : 1 })}>
                                <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>{ocupado === e.id ? 'Aprobando…' : 'Aprobar todo'}</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </Vidrio>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}
