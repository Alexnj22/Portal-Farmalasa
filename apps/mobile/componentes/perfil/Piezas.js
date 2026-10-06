// Las piezas de «Mi perfil» en la app: el renglón con su ícono (como los
// campos del portal), el plan de vacaciones, el expediente en línea y el
// historial con buscar, tipo y desde/hasta (`filtrarHistorial`, núcleo — la
// misma regla del portal).
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { EVENT_TYPES } from '@nucleo/data/constants';
import { estadoDePlan, filtrarHistorial } from '@nucleo/utils/miPerfil';
import { documentosDelExpediente, ESTADO_DOC } from '@nucleo/utils/misDocumentos';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

const hoyIso = () => hoySV();
import { colorSistema } from '../Formulario';
import { Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Fecha from '../formulario/Fecha';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { iconoDe } from '../../tema/iconos';

export const fechaCorta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Un dato con su ícono a la izquierda; `extra` va debajo (p. ej. «en 5 días»). */
export function FilaConIcono({ icono, color = MARCA.azulClaro, rotulo, valor, extra, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}26` }}>
        <Host matchContents><Icon name={iconoDe(icono)} size={15} color={color} /></Host>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{valor ?? '—'}</Text>
        {extra ? <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{extra}</Text> : null}
      </View>
    </View>
  );
}

/** Todos los planes de vacaciones vigentes: fechas, días, año y estado. */
export function PlanDeVacaciones({ planes = [], hoy }) {
  if (!planes.length) return null;
  return (
    <Seccion titulo="Plan de vacaciones">
      {planes.map((vp, i) => {
        const e = estadoDePlan(vp.status);
        const proxima = vp.end_date >= hoy;
        return (
          <View key={vp.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: proxima ? 1 : 0.6 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${fechaCorta(vp.start_date)} – ${fechaCorta(vp.end_date)}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[vp.days != null ? `${vp.days} días` : null, vp.year].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pildora texto={e.label} color={colorDeVariante(e.variante)} />
          </View>
        );
      })}
    </Seccion>
  );
}

/** Los documentos del expediente, en línea; tocar abre «Mis documentos». */
export function ExpedienteEnLinea({ empleado }) {
  const docs = useMemo(() => documentosDelExpediente(empleado), [empleado]);
  if (!docs.length) return null;
  return (
    <Seccion titulo={`Mi expediente · ${docs.length}`}>
      {docs.slice(0, 5).map((d, i) => {
        const m = d.meta || {};
        const vence = m.expiryDate ? String(m.expiryDate).slice(0, 10) : null;
        const vencido = vence && vence < hoyIso();
        return (
          <Pressable key={d.id ?? i} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/mis-documentos'); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{m.nombre || 'Documento'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[m.categoria, m.issueDate ? `emitido ${fechaCorta(m.issueDate)}` : null, m.versiones ? `${m.versiones} anteriores` : null].filter(Boolean).join(' · ')}</Text>
            </View>
            {vence ? <Pildora texto={vencido ? 'Vencido' : `Vence ${fechaCorta(vence)}`} color={vencido ? MARCA.rojo : MARCA.ambar} /> : <Pildora texto={ESTADO_DOC[d.status] ?? 'En tu expediente'} color={MARCA.verde} />}
          </Pressable>
        );
      })}
      <Pressable onPress={() => router.push('/mis-documentos')} style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{docs.length > 5 ? `Ver los ${docs.length}` : 'Abrir mi expediente'}</Text>
      </Pressable>
    </Seccion>
  );
}

const COLOR_EVENTO = { VACATION: MARCA.verde, PERMIT: MARCA.verde, DISABILITY: MARCA.rojo, SHIFT_CHANGE: MARCA.violeta, SALARY: MARCA.violeta, TRANSFER: MARCA.azulClaro, HIRING: MARCA.verde };

/** El historial con buscar, tipo y desde/hasta; cada evento con sus detalles. */
export function Historial({ historial }) {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [cuantos, setCuantos] = useState(10);
  const tipos = useMemo(() => [...new Set(historial.map((e) => e.type))], [historial]);
  const filtrado = useMemo(() => filtrarHistorial(historial, { desde, hasta, tipo, busqueda: busca, rotulos: EVENT_TYPES }), [historial, desde, hasta, tipo, busca]);
  const rotulo = (t) => (t === 'HIRING' ? 'Contratación inicial' : EVENT_TYPES[t]?.label ?? t);
  const hayFiltro = busca.trim() || tipo || desde || hasta;
  const elegirTipo = () => {
    const opciones = ['Todos los tipos', ...tipos.map(rotulo), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Tipo de evento', options: opciones, cancelButtonIndex: opciones.length - 1 }, (i) => {
      if (i === 0) setTipo(''); else if (i < opciones.length - 1) setTipo(tipos[i - 1]);
    });
  };
  return (
    <Seccion titulo={`Mi historial · ${filtrado.length}${hayFiltro ? ` de ${historial.length}` : ''}`}>
      <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar en el historial" placeholderTextColor={colorSistema.texto2} clearButtonMode="while-editing"
        style={{ minHeight: 40, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: colorSistema.texto, backgroundColor: 'rgba(127,127,127,0.16)' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pressable onPress={elegirTipo} style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: tipo ? `${MARCA.azulClaro}33` : 'rgba(127,127,127,0.16)', opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: tipo ? MARCA.azulClaro : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{tipo ? rotulo(tipo) : 'Tipo ▾'}</Text>
        </Pressable>
        {hayFiltro ? (
          <Pressable onPress={() => { setBusca(''); setTipo(''); setDesde(''); setHasta(''); }} hitSlop={6}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14 }}>Quitar filtros</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Desde</Text>
        <Fecha valor={desde || historial.at(-1)?.date?.slice(0, 10)} onCambiar={setDesde} />
        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>hasta</Text>
        <Fecha valor={hasta || historial[0]?.date?.slice(0, 10)} onCambiar={setHasta} />
      </View>
      {filtrado.slice(0, cuantos).map((ev, i) => {
        const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
        const anulado = meta.status === 'CANCELLED';
        const editado = meta.status === 'SUPERSEDED';
        return (
          <View key={ev.id ?? i} style={{ flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: anulado || editado ? 0.55 : 1 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: COLOR_EVENTO[ev.type] ?? colorSistema.texto2 }} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{rotulo(ev.type)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaCorta(ev.date)}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{ev.note || 'Evento registrado.'}</Text>
              {meta.endDate ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Hasta: ${fechaCorta(meta.endDate)}`}</Text> : null}
              {Array.isArray(meta.permissionDates) && meta.permissionDates.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  {meta.permissionDates.map((d) => <Pildora key={d} texto={fechaCorta(d)} color={MARCA.ambar} />)}
                </View>
              ) : null}
              {meta.old_value && meta.new_value ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  <Text style={{ textDecorationLine: 'line-through' }}>{String(meta.old_value)}</Text>
                  <Text>{'  →  '}</Text>
                  <Text style={{ color: MARCA.azulClaro, fontWeight: '700' }}>{String(meta.new_value)}</Text>
                </Text>
              ) : null}
              {anulado || editado ? <View style={{ flexDirection: 'row' }}><Pildora texto={anulado ? 'Cancelado' : 'Editado'} color={anulado ? MARCA.rojo : colorSistema.texto2} /></View> : null}
            </View>
          </View>
        );
      })}
      {!filtrado.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{hayFiltro ? 'Nada con esos filtros.' : 'Sin eventos.'}</Text> : null}
      {filtrado.length > cuantos ? (
        <Pressable onPress={() => setCuantos((n) => n + 20)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Ver más (${filtrado.length - cuantos})`}</Text>
        </Pressable>
      ) : null}
    </Seccion>
  );
}
