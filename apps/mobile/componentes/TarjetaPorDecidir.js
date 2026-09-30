// Una tarjeta de «Por decidir»: quién lo pide, qué es y lo que se pide, en
// vidrio, con «Te toca» a la derecha. Tocarla abre la pantalla donde se
// decide: la de la solicitud (también Min/Max), la del traslado o la del envío.
import { Pressable, Text, View } from 'react-native';
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
    default: {
      const d = detalleDeSolicitud(f);
      return { tipo: REQUEST_TYPES[f.type]?.label ?? 'Solicitud', icono: nombreDelIconoDeTipo(f.type), quien: persona(f.employee_id),
        contexto: d?.contexto, renglones: d?.renglones, abrir: () => abrirSolicitud(f.id) };
    }
  }
}

export default function TarjetaPorDecidir({ item, persona }) {
  const d = describir(item, persona);
  const renglones = (d.renglones || []).slice(0, 2);
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); d.abrir(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
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
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{a}</Text>
              {b ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{b}</Text> : null}
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Avatar empleado={d.quien} tamano={24} />
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(d.quien)}</Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${MARCA.azulClaro}2E` }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>Te toca decidir ›</Text>
            </View>
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}
