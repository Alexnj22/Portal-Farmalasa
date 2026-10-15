// Historial de cambios del MIN·MAX de un producto en una sala, NATIVO — el
// diálogo «Historial MIN·MAX» del portal (`TabMinMax`): lo VIGENTE arriba con
// de dónde salió (solicitud aprobada, excepción declarada o puesto a mano), su
// motivo y las firmas; abajo, todo lo que pasó con quién, cuándo y cuánto.
//
// La lista de acciones y sus rótulos son los del núcleo
// (`ACCIONES_DEL_HISTORIAL_MINMAX`, `HISTORIAL_MINMAX_META`); las solicitudes
// se cruzan por `request_id` para traer el motivo que se escribió al pedir.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { effectiveMinMaxPair, fetchAuditLogsForProduct, fetchEmployeesBasic, fetchStockParams } from '@nucleo/data/stockParams';
import { fetchSolicitudesDeProducto } from '@nucleo/data/minmaxRequests';
import { ACCIONES_DEL_HISTORIAL_MINMAX, HISTORIAL_MINMAX_META, MOTIVO_AJUSTE } from '@nucleo/constants/minmax';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLUMNAS = 'min_units, max_units, manual_min, manual_max, manual_at, manual_por, manual_motivo, manual_nota, manual_cliente_unidades, manual_cliente_dias, ajuste_solicitud_id';
const TONO = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, neutral: colorSistema.texto2 };
const igual = (a, b) => a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Busca una ficha por cualquiera de sus claves (id, nombre, usuario o correo):
// la misma persona firma distinto según de dónde salga la firma.
const quienEs = (indice, ...claves) => {
  for (const k of claves) {
    if (!k) continue;
    const hit = indice[String(k).trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
};

function Firma({ rotulo, persona, crudo }) {
  const nombre = persona?.name ? shortEmployeeName(persona) : String(crudo ?? '').split('@')[0];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
      <Avatar empleado={persona ?? { name: nombre }} tamano={22} />
      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{nombre}</Text>
    </View>
  );
}

export default function MinMaxHistorial() {
  const { producto, sala, nombre } = useLocalSearchParams();
  const [datos, setDatos] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: logs }, { data: emps }, { data: sols }, { data: fila }] = await Promise.all([
      fetchAuditLogsForProduct(ACCIONES_DEL_HISTORIAL_MINMAX, Number(producto), Number(sala)),
      fetchEmployeesBasic(),
      fetchSolicitudesDeProducto(producto, sala),
      fetchStockParams(Number(producto), Number(sala), COLUMNAS).then((r) => r).catch(() => ({ data: null })),
    ]);
    await signPhotosDeep(emps || []).catch(() => {});
    const indice = {};
    (emps || []).forEach((e) => [e.id, e.name, e.username, e.email].forEach((k) => { if (k) indice[String(k).trim().toLowerCase()] = e; }));
    setDatos({ logs: logs || [], sols: sols || [], fila, indice });
  }, [producto, sala]);
  useEffect(() => { cargar(); }, [cargar]);

  const vigente = () => {
    const f = datos.fila;
    if (!f?.manual_at) return null;
    const par = effectiveMinMaxPair(f);
    const origen = f.ajuste_solicitud_id ? datos.sols.find((s) => s.id === f.ajuste_solicitud_id) : null;
    const motivo = f.manual_motivo ? (MOTIVO_AJUSTE[f.manual_motivo]?.label ?? f.manual_motivo) : null;
    const razon = motivo || origen?.reason || f.manual_nota || null;
    const nota = igual(f.manual_nota, razon) ? null : f.manual_nota;
    const pedido = igual(origen?.reason, razon) ? null : origen?.reason;
    return (
      <Vidrio radio={18}>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>VIGENTE</Text>
              <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${par.min ?? 0} · ${par.max ?? 0}`}</Text>
            </View>
            <Pildora texto={origen ? 'Solicitud aprobada' : motivo ? 'Excepción declarada' : 'Puesto a mano'} color={origen ? MARCA.verde : colorSistema.texto2} />
          </View>
          {razon ? (
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
              {razon}
              {f.manual_motivo === 'cliente_fijo' && f.manual_cliente_unidades > 0 && f.manual_cliente_dias > 0
                ? <Text style={{ color: colorSistema.texto2, fontWeight: '400' }}>{` · ${f.manual_cliente_unidades} cada ${f.manual_cliente_dias} días`}</Text> : null}
            </Text>
          ) : null}
          {pedido ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Pidió: ${pedido}`}</Text> : null}
          {nota ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{nota}</Text> : null}
          {origen?.decision_note ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Al aprobar: ${origen.decision_note}`}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            {origen?.requested_by_name ? <Firma rotulo="Pidió" persona={quienEs(datos.indice, origen.requested_by_name)} crudo={origen.requested_by_name} /> : null}
            {f.manual_por ? <Firma rotulo={origen ? 'Aprobó' : 'Puso'} persona={quienEs(datos.indice, f.manual_por, String(f.manual_por).split('@')[0])} crudo={f.manual_por} /> : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 12, marginLeft: 'auto' }}>{fechaTexto(f.manual_at, { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
          </View>
        </View>
      </Vidrio>
    );
  };

  const entrada = (log) => {
    const d = log.details || {};
    const meta = HISTORIAL_MINMAX_META[log.action] || { label: log.action, variante: 'neutral' };
    const persona = quienEs(datos.indice, log.user_id, log.user_name);
    const sol = d.request_id ? datos.sols.find((s) => s.id === d.request_id) : null;
    const salaTxt = log.action === 'MINMAX_ZERO_ALL_BRANCHES' ? 'Todas las salas' : (ERP_NAMES[d.sucursal_id] || '');
    const fmt = (v) => (v == null ? '—' : String(v));
    const vigenteId = datos.fila?.ajuste_solicitud_id;
    return (
      <Vidrio key={log.id} radio={16}>
        <View style={{ padding: 12, flexDirection: 'row', gap: 10 }}>
          <Avatar empleado={persona ?? { name: log.user_name || '?' }} tamano={32} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '500' }}>{d.requested_by_name ? 'Aprobó ' : 'Modificó '}</Text>
                {persona?.name ? shortEmployeeName(persona) : (log.user_name || 'Sistema')}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaTexto(log.created_at, { day: 'numeric', month: 'short', year: 'numeric' })} · ${hora12(new Date(log.created_at))}`}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Pildora texto={meta.label} color={TONO[meta.variante] ?? colorSistema.texto2} />
              {log.action === 'MINMAX_MOTIVO_AJUSTE' ? (
                <Text style={{ color: colorSistema.texto, fontSize: 14, flexShrink: 1 }}>
                  <Text style={{ fontWeight: '700' }}>{d.motivo ? (MOTIVO_AJUSTE[d.motivo]?.label ?? d.motivo) : 'Sin motivo'}</Text>
                  {d.motivo === 'cliente_fijo' && d.cliente_unidades > 0 && d.cliente_dias > 0 ? ` · ${d.cliente_unidades} cada ${d.cliente_dias} días` : ''}
                  {d.nota ? ` · ${d.nota}` : ''}
                </Text>
              ) : (
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontVariant: ['tabular-nums'] }}>
                  {`MIN ${d.old_min !== d.new_min ? `${fmt(d.old_min)} → ` : ''}`}<Text style={{ fontWeight: '800' }}>{fmt(d.new_min)}</Text>
                  {`   MAX ${d.old_max !== d.new_max ? `${fmt(d.old_max)} → ` : ''}`}<Text style={{ fontWeight: '800' }}>{fmt(d.new_max)}</Text>
                </Text>
              )}
              {salaTxt ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginLeft: 'auto' }}>{salaTxt}</Text> : null}
            </View>
            {d.requested_by_name ? <Firma rotulo="Solicitó" persona={quienEs(datos.indice, d.requested_by_id, d.requested_by_name)} crudo={d.requested_by_name} /> : null}
            {log.action === 'MINMAX_ZERO_ALL_BRANCHES' && d.nota ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${d.motivo === 'ya_no_rota' ? `${MOTIVO_AJUSTE.ya_no_rota.label}:` : 'Por qué:'} ${d.nota}`}</Text>
            ) : null}
            {sol?.reason && sol.id !== vigenteId ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Motivo: ${sol.reason}`}</Text> : null}
            {(sol?.decision_note || d.note) && sol?.id !== vigenteId ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Al aprobar: ${sol?.decision_note || d.note}`}</Text> : null}
          </View>
        </View>
      </Vidrio>
    );
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Historial MIN·MAX' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4, marginTop: -8 }}>{ERP_NAMES[Number(sala)] ?? ''}</Text>
        {datos == null ? <ActivityIndicator style={{ marginTop: 30 }} /> : (
          <>
            {vigente()}
            {datos.logs.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, marginHorizontal: 4, marginTop: 4 }}>TODO LO QUE PASÓ</Text> : null}
            {datos.logs.length ? datos.logs.map(entrada) : <Aviso tono="nota" texto="Sin cambios registrados." />}
          </>
        )}
      </ScrollView>
    </>
  );
}
