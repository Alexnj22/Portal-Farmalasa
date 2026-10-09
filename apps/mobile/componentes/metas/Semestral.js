// El pago semestral del bono de meta, NATIVO — `TabSemestral` del portal.
//
// El bono se gana cada mes y se PAGA dos veces al año: enero–junio en la 1ª
// quincena de julio y julio–diciembre en la 1ª de enero. Esta es la hoja de
// ese pago: el bono de cada mes por persona y la suma. Los meses vienen de la
// foto del cierre (no se recalculan con el personal de hoy); el mes que sigue
// abierto se marca «en curso».
//
// Quien ya no trabaja no se paga ni se niega solo: gerencia decide, con motivo.
// Sin esas decisiones no se aprueba. Aprobar congela la hoja; reabrir pide
// motivo. La cuenta es del núcleo (`resumenDelSemestre`), la misma del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { aprobarBonoSemestral, decidirBonoSemestral, fetchBonoSemestral } from '@nucleo/data/metas';
import {
  ESTADO_MES_SEMESTRAL, ROTULO_DE_BAJA, SEMESTRE_INICIO, csvDelSemestre, resumenDelSemestre,
  semestreDe, semestreLabel, semestrePagoLabel, semestreSumar, ymHoySV, ymLabelCorto,
} from '@nucleo/utils/metasUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';
import { compartirCsv } from '../fiscal/csv';
import Tocable from '../Tocable';

function Paso({ sem, onCambiar }) {
  const actual = semestreDe(ymHoySV());
  const flecha = (t, n, off) => (
    <Tocable disabled={off} hitSlop={8} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(semestreSumar(sem, n)); }}
      style={({ pressed }) => ({ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.3 : pressed ? 0.5 : 1 })}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 26 }}>{t}</Text>
    </Tocable>
  );
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {flecha('‹', -1, sem <= SEMESTRE_INICIO)}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{semestreLabel(sem)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{semestrePagoLabel(sem)}</Text>
          </View>
          {flecha('›', 1, sem >= actual)}
        </View>
      </Vidrio>
    </View>
  );
}

export default function Semestral({ canApprove }) {
  const ymActual = ymHoySV();
  const [sem, setSem] = useState(semestreDe(ymActual));
  const [hoja, setHoja] = useState(null);
  const [error, setError] = useState(null);
  const [intento, setIntento] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const empleados = useStaffStore((s) => s.employees);

  useEffect(() => {
    let vivo = true;
    setHoja(null); setError(null);
    fetchBonoSemestral(sem)
      .then((d) => { if (vivo) setHoja(d ?? { meses: [], personas: [] }); })
      .catch((err) => {
        if (!vivo) return;
        setError(err?.code === '42501'
          ? 'El pago semestral necesita ver las metas de todas las salas, y tu cargo no tiene ese alcance.'
          : mensajeAmigable(err, 'No se pudo cargar el pago semestral'));
      });
    return () => { vivo = false; };
  }, [sem, intento]);

  const r = useMemo(() => resumenDelSemestre(hoja, ymActual), [hoja, ymActual]);
  const nombreDe = useCallback((p) => {
    const emp = (empleados || []).find((e) => e.id === p.employee_id);
    return shortEmployeeName(emp || { name: p.nombre });
  }, [empleados]);

  const correr = async (fn, titulo) => {
    setOcupado(true);
    try { setHoja(await fn()); listo(titulo, ''); return true; }
    catch (err) { fallo('No se pudo guardar', mensajeAmigable(err, 'Vuelve a intentarlo.')); return false; }
    finally { setOcupado(false); }
  };

  const aprobar = () => Alert.alert(`Aprobar ${semestreLabel(sem).toLowerCase()}`,
    `Quedan congelados ${formatMoney(r.aPagar)} para ${r.cuantosCobran} personas. A partir de aquí la hoja no cambia: es la que se paga.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Aprobar', onPress: () => correr(() => aprobarBonoSemestral(sem, true, null, { a_pagar: r.aPagar }), 'Semestre aprobado') },
    ]);
  const reabrir = () => Alert.prompt(`Reabrir ${semestreLabel(sem).toLowerCase()}`,
    'Esto deshace la aprobación y la hoja vuelve a calcularse. Escribe por qué.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reabrir', style: 'destructive', onPress: (texto) => {
        if (!String(texto || '').trim()) { Alert.alert('Falta el motivo', 'Escribe por qué se reabre.'); return; }
        correr(() => aprobarBonoSemestral(sem, false, String(texto).trim()), 'Semestre reabierto');
      } },
    ], 'plain-text');
  const decidir = (p, pagar) => Alert.prompt(pagar ? `Pagarle a ${nombreDe(p)}` : `No pagarle a ${nombreDe(p)}`,
    pagar ? 'Cobra lo acumulado aunque ya no trabaje. Escribe por qué.' : 'No cobra lo acumulado. Escribe por qué.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: pagar ? 'Pagar' : 'No pagar', style: pagar ? 'default' : 'destructive', onPress: (texto) => {
        if (!String(texto || '').trim()) { Alert.alert('Falta el motivo', 'La decisión necesita un motivo.'); return; }
        correr(() => decidirBonoSemestral({ semestre: sem, employeeId: p.employee_id, pagar, motivo: String(texto).trim() }), 'Decisión guardada');
      } },
    ], 'plain-text');

  return (
    <View style={{ gap: 12 }}>
      <Paso sem={sem} onCambiar={setSem} />
      {error ? (
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          <Aviso tono="freno" texto={error} />
          <BotonGrande texto="Reintentar" borde onPress={() => setIntento((n) => n + 1)} />
        </View>
      ) : !hoja ? <ActivityIndicator style={{ marginTop: 20 }} /> : (
        <>
          <FilaDeKpis>
            <Kpi icono="HandCoins" rotulo={r.aprobado ? 'Se paga' : 'A pagar'} valor={r.personas.length ? formatMoney(r.aPagar) : '—'} color={MARCA.azulClaro} apoyo={semestrePagoLabel(sem)} />
            <Kpi icono="Users" rotulo="Personas" valor={r.personas.length ? String(r.personas.length) : '—'} color={MARCA.violetaClaro} apoyo="con bono en el semestre" />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="UserX" rotulo="Por decidir" valor={r.porDecidir ? String(r.porDecidir) : '—'} color={MARCA.ambar} pide={r.porDecidir > 0} apoyo={r.porDecidir > 0 ? 'ya no trabajan' : 'nadie pendiente'} />
            <Kpi icono={r.aprobado ? 'Lock' : 'CalendarDays'} rotulo="Estado" valor={r.aprobado ? 'Aprobado' : r.terminado ? 'Por aprobar' : 'Acumulando'}
              color={r.aprobado ? MARCA.verde : MARCA.azulClaro}
              apoyo={r.aprobado && hoja?.aprobado_por ? `por ${shortEmployeeName(hoja.aprobado_por)}` : `${r.cerrados} de 6 meses cerrados`} />
          </FilaDeKpis>
          {r.personas.length ? (
            <Tocable hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-end', marginHorizontal: 20, minHeight: 32, justifyContent: 'center' }}
              onPress={() => compartirCsv({ ...csvDelSemestre(r, sem), modulo: 'metas' }).catch((e) => fallo('No se pudo compartir', e?.message || ''))}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Descargar la hoja (CSV)</Text>
            </Tocable>
          ) : null}
          {r.meses.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 16 }}>
              {r.meses.map((m) => (
                <Pildora key={m.ym} texto={`${ymLabelCorto(m.ym)} · ${ESTADO_MES_SEMESTRAL[m.estado]?.rotulo || m.estado}`}
                  color={colorDeVariante(ESTADO_MES_SEMESTRAL[m.estado]?.variant || 'neutral')} />
              ))}
            </View>
          ) : null}
          {r.informativo ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Las bonificaciones están apagadas: estos montos dicen lo que se habría ganado; se vuelven dinero cuando se activan en la pestaña Bono." /></View> : null}
          {!r.aprobado && !r.terminado ? <View style={{ marginHorizontal: 16 }}><Aviso texto="El semestre sigue abierto: los meses cerrados ya no cambian y el mes en curso se mueve con cada venta. Se aprueba cuando cierre el último mes (el cierre corre el día 5)." /></View> : null}

          {r.personas.map((p) => (
            <View key={p.employee_id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18}>
                <View style={{ padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar empleado={(empleados || []).find((e) => e.id === p.employee_id) ?? { name: p.nombre }} tamano={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{nombreDe(p)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{(p.salas || []).join(' / ') || '—'}</Text>
                    </View>
                    <Text style={{ color: p.pagar ? colorSistema.texto : colorSistema.texto2, fontSize: 17, fontWeight: '800', textDecorationLine: p.pagar ? 'none' : 'line-through' }}>{formatMoney(p.total)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {r.meses.map((m) => (
                      <Text key={m.ym} style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${ymLabelCorto(m.ym)} ${formatMoney(p.por_mes?.[m.ym] ?? 0)}`}</Text>
                    ))}
                  </View>
                  {!p.activo ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <Pildora texto={ROTULO_DE_BAJA[p.status] || 'Ya no trabaja'} color={MARCA.ambar} />
                      {p.decision ? <Pildora texto={p.decision.pagar ? 'Se paga' : 'No se paga'} color={p.decision.pagar ? MARCA.verde : MARCA.rojo} /> : null}
                    </View>
                  ) : null}
                  {p.decision?.motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${p.decision.motivo}${p.decision.por ? ` · ${shortEmployeeName(p.decision.por)}` : ''}`}</Text> : null}
                  {canApprove && !p.activo && !r.aprobado ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}><BotonGrande texto="Pagar" color={MARCA.verde} borde onPress={() => decidir(p, true)} deshabilitado={ocupado} /></View>
                      <View style={{ flex: 1 }}><BotonGrande texto="No pagar" color={MARCA.rojo} borde onPress={() => decidir(p, false)} deshabilitado={ocupado} /></View>
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </View>
          ))}
          {!r.personas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>Nadie ganó bono en este semestre.</Text> : null}

          {canApprove && !r.aprobado && r.terminado && r.todosCerrados ? (
            <View style={{ marginHorizontal: 16, gap: 6 }}>
              <BotonGrande texto="Aprobar el semestre" onPress={aprobar} deshabilitado={ocupado || r.porDecidir > 0} />
              {r.porDecidir > 0 ? <Aviso tono="cuidado" texto="Primero hay que decidir por quienes ya no trabajan." /> : null}
            </View>
          ) : null}
          {canApprove && r.aprobado ? (
            <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Reabrir el semestre" borde color={MARCA.ambar} onPress={reabrir} deshabilitado={ocupado} /></View>
          ) : null}
        </>
      )}
    </View>
  );
}
