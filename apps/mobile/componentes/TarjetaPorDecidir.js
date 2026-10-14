// Una tarjeta de «Por decidir»: quién lo pide, qué es y lo que se pide, en
// vidrio, con «Te toca» a la derecha. Tocarla abre la pantalla donde se
// decide: la de la solicitud (también Min/Max), la del traslado o la del envío.
import { Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { nombreDelIconoDeTipo } from '@nucleo/constants/tipoIconos';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { piezasDe } from '@nucleo/utils/trasladoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import Vidrio from './Vidrio';
import Avatar from './Avatar';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';
import { iconoDe } from '../tema/iconos';
import { abrirSolicitud } from '../pantallas';
import { ORIGENES, PRECIOS } from '@nucleo/data/mayoristas';

// La nota con la que se pidió (motivo), si la solicitud la trae.
function describirPie(f) {
  const m = f?.metadata ?? {};
  const nota = m.reason ?? m.motivo ?? f?.note;
  return nota ? `Motivo: ${nota}` : null;
}

function describir(item, persona) {
  const f = item.fila;
  switch (item.tipo) {
    case 'minmax': {
      const d = detalleDeMinMax(f);
      return { tipo: 'Ajuste de Mín·Máx', icono: 'BarChart2', quien: persona(f.requested_by_id) ?? { name: f.requested_by_name },
        contexto: d?.contexto, renglones: d?.renglones, abrir: () => abrirSolicitud(item.clave) };
    }
    case 'traslado': {
      const p = piezasDe(f.metadata);
      return { tipo: 'Te piden un traslado', icono: 'ArrowLeftRight', quien: persona(f.employee_id),
        contexto: `${f.metadata?.origen_branch_name ?? '—'} → ${f.metadata?.branch_name ?? '—'} · ${p?.cuenta ?? ''}${p && !p.varios ? ` ${p.nombre}` : ''}`,
        abrir: () => router.push({ pathname: '/traslado/[id]', params: { id: String(f.id) } }) };
    }
    case 'envio': {
      const l = f.lineas || [];
      return { tipo: 'Te enviaron producto', icono: 'Truck', quien: persona(f.employee_id),
        contexto: `${f.origen_branch_name ?? '—'} → ${f.branch_name ?? '—'} · ${l.length === 1 ? `${l[0].cantidad} ${l[0].presentacion_tipo ?? ''} ${l[0].descripcion}` : `${l.length} productos`}`,
        abrir: () => router.push({ pathname: '/envio/[id]', params: { id: String(f.id) } }) };
    }
    case 'mayorista': {
      // Un cliente pidió precio de mayorista (desde la app o propuesto en sala).
      // Se aprueba o rechaza en su ficha; mientras siga 'solicitado' se queda aquí.
      const cliente = f.customers?.name ?? `Cliente ${f.customer_id}`;
      return { tipo: 'Quiere ser mayorista', icono: 'ShoppingBag',
        quien: f.solicitado_por ? persona(f.solicitado_por) : null,
        origen: ORIGENES[f.origen] ?? 'Desde la app',
        contexto: `${cliente}${f.precio ? ` · ${PRECIOS[f.precio] ?? f.precio}` : ''}`,
        pie: f.nota_solicitud ? `Nota: ${f.nota_solicitud}` : null,
        abrir: () => router.push({ pathname: '/mayorista/[id]', params: { id: String(f.customer_id) } }) };
    }
    default: {
      const d = detalleDeSolicitud(f);
      return { tipo: REQUEST_TYPES[f.type]?.label ?? 'Solicitud', icono: nombreDelIconoDeTipo(f.type), quien: persona(f.employee_id),
        contexto: d?.contexto, renglones: d?.renglones, pie: d?.pie, abrir: () => abrirSolicitud(f.id) };
    }
  }
}

// Lo necesario para decidir sin abrirla (2026-10-12, «dando siempre la
// información requerida»): hasta TRES renglones, cuántos más hay, la nota de
// la solicitud y la sala que la pide.
const ANDROID = Platform.OS === 'android';

export default function TarjetaPorDecidir({ item, persona }) {
  const d = describir(item, persona);
  const todos = d.renglones || [];
  const renglones = todos.slice(0, 3);
  const mas = todos.length - renglones.length;
  const sala = item.fila?.metadata?.branch_name ?? item.fila?.branch_name ?? null;
  const pie = d.pie ?? (item.tipo === 'minmax' || item.tipo === 'mayorista' ? null : describirPie(item.fila));
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); d.abrir(); }}
      android_ripple={ANDROID ? { color: 'rgba(127,127,127,0.20)', foreground: true } : undefined}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed && !ANDROID ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${MARCA.azulClaro}33`, alignItems: 'center', justifyContent: 'center' }}>
              <Host matchContents><Icon name={iconoDe(d.icono)} size={17} color={MARCA.azulClaro} /></Host>
            </View>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{d.tipo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{cuandoLlego(item.creado)}</Text>
          </View>
          {d.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{d.contexto}</Text> : null}
          {renglones.map(([a, b], i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: -4 }}>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{a}</Text>
              {b ? <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{b}</Text> : null}
            </View>
          ))}
          {mas > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginTop: -4 }}>{`y ${mas} más`}</Text> : null}
          {pie ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }} numberOfLines={2}>{pie}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            {d.quien ? <Avatar empleado={d.quien} tamano={24} /> : null}
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {d.quien ? shortEmployeeName(d.quien) : (d.origen ?? '')}{sala ? <Text style={{ fontWeight: '400' }}>{` · ${sala}`}</Text> : null}
            </Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${MARCA.azulClaro}2E` }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>Te toca decidir ›</Text>
            </View>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}
