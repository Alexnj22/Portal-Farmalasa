// Piezas de Vacaciones: las solicitudes de cambio (aprobar o rechazar con
// motivo, con `processChangeRequest`, la misma acción del portal) y el año
// entero como una línea de tiempo por persona (el Gantt del portal).
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fechaTexto, NOMBRES_DE_MES } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { fallo, listo } from '../Progreso';

const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '—');

export function SolicitudesDeCambio({ cambios, puedeDecidir, procesar, aprobadorId, alTerminar }) {
  const [ocupado, setOcupado] = useState(null);
  if (!cambios?.length) return null;

  const decidir = async (req, accion, motivo = '') => {
    const meta = req.metadata || {};
    setOcupado(req.id);
    const ok = await procesar(req.id, accion, meta.vacation_plan_id,
      accion === 'APPROVED' ? meta.requested_start : null, accion === 'APPROVED' ? meta.requested_end : null, motivo, aprobadorId ?? null);
    setOcupado(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      listo(accion === 'APPROVED' ? 'Cambio aprobado' : 'Cambio rechazado', accion === 'APPROVED' ? 'Vacaciones actualizadas.' : 'Se mantienen las fechas originales.');
      alTerminar?.();
    } else {
      fallo('No se pudo procesar la solicitud', 'Puede que alguien ya la haya decidido.');
    }
  };
  const rechazar = (req) => Alert.prompt('Rechazar el cambio', 'Se mantienen las fechas originales. Dile por qué.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Rechazar', style: 'destructive', onPress: (motivo) => {
      if (!String(motivo || '').trim()) { fallo('Falta el motivo', 'Sin motivo la persona no sabe qué corregir.'); return; }
      decidir(req, 'REJECTED', String(motivo).trim());
    } },
  ], 'plain-text');
  const aprobar = (req) => {
    const m = req.metadata || {};
    Alert.alert('Aprobar el cambio', `Las vacaciones pasan a ${corta(m.requested_start)} → ${corta(m.requested_end)}.`, [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Aprobar', onPress: () => decidir(req, 'APPROVED') },
    ]);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>
        {`Solicitudes de cambio · ${cambios.length}`}
      </Text>
      {cambios.map((req) => {
        const m = req.metadata || {};
        const emp = req.employee;
        return (
          <View key={req.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20} tinte="rgba(247,144,9,0.14)">
              <View style={{ padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar empleado={emp ?? { name: '?' }} tamano={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{emp ? shortEmployeeName(emp) : 'Sin ficha'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{`Pide: ${corta(m.requested_start)} → ${corta(m.requested_end)}`}</Text>
                    {m.original_start ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Original: ${corta(m.original_start)} → ${corta(m.original_end)}`}</Text> : null}
                  </View>
                </View>
                {req.note ? <Text style={{ color: MARCA.ambar, fontSize: 13, fontStyle: 'italic' }}>{`“${req.note}”`}</Text> : null}
                {puedeDecidir ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable disabled={!!ocupado} onPress={() => aprobar(req)}
                      style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.verde, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{ocupado === req.id ? 'Procesando…' : 'Aprobar'}</Text>
                    </Pressable>
                    <Pressable disabled={!!ocupado} onPress={() => rechazar(req)}
                      style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: MARCA.rojo, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                      <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Rechazar</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
    </View>
  );
}

/**
 * El año como línea de tiempo: una fila por persona, doce columnas (meses),
 * y cada plan como una barra del color de su estado. Se desliza de lado.
 */
const ANCHO_MES = 46;
export function GanttDelAnio({ planes, anio, colorDe }) {
  const porPersona = new Map();
  for (const p of planes || []) {
    if (p.status === 'CANCELLED') continue;
    const k = String(p.employee_id);
    if (!porPersona.has(k)) porPersona.set(k, { emp: p.employee, planes: [] });
    porPersona.get(k).planes.push(p);
  }
  const filas = [...porPersona.values()].sort((a, b) => String(a.emp?.name).localeCompare(String(b.emp?.name)));
  if (!filas.length) return null;
  const inicioAnio = Date.UTC(anio, 0, 1);
  const finAnio = Date.UTC(anio + 1, 0, 1);
  const total = 12 * ANCHO_MES;
  const x = (f) => {
    const t = Date.parse(`${String(f).slice(0, 10)}T00:00:00Z`);
    return Math.max(0, Math.min(total, ((t - inicioAnio) / (finAnio - inicioAnio)) * total));
  };
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ flexDirection: 'row', paddingVertical: 12 }}>
          <View style={{ width: 104, paddingLeft: 12 }}>
            <View style={{ height: 18 }} />
            {filas.map((f) => (
              <Text key={String(f.emp?.id ?? f.planes[0].employee_id)} style={{ height: 26, color: colorSistema.texto, fontSize: 12, fontWeight: '600', lineHeight: 26 }}>
                {f.emp ? shortEmployeeName(f.emp) : '—'}
              </Text>
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 12 }}>
            <View style={{ width: total }}>
              <View style={{ flexDirection: 'row', height: 18 }}>
                {NOMBRES_DE_MES.map((m) => <Text key={m} style={{ width: ANCHO_MES, color: colorSistema.texto2, fontSize: 10, fontWeight: '700' }}>{m.slice(0, 3).toUpperCase()}</Text>)}
              </View>
              {filas.map((f) => (
                <View key={String(f.emp?.id ?? f.planes[0].employee_id)} style={{ height: 26, justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', left: 0, right: 0, height: 1, top: 13, backgroundColor: colorSistema.separador }} />
                  {f.planes.map((p) => {
                    const a = x(p.start_date);
                    const b = Math.max(a + 4, x(p.end_date) + total / 365);
                    return <View key={p.id} style={{ position: 'absolute', left: a, width: b - a, height: 12, top: 7, borderRadius: 6, backgroundColor: colorDe(p.status) }} />;
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Vidrio>
    </View>
  );
}
