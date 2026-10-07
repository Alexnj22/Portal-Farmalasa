// El estado de un documento con Hacienda, como una lista de chequeo —el
// `EstadoHacienda` del portal—: número de control, código de generación, firma
// y sello de recepción, cada uno con su ✓ o su ✗, lo que dijo Hacienda, y el
// botón de lo que toca (reenviar, aviso de contingencia, corregir, enviar la
// invalidación). La revisión sale del núcleo (`revisionHacienda`).
import { Text, View } from 'react-native';
import { Host, Icon } from '@expo/ui';
import { revisionHacienda } from '@nucleo/utils/distribucionComun';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { BotonGrande } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { iconoDe } from '../../../tema/iconos';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../soloConsulta';

const NIVEL = {
  ok: { icono: 'ShieldCheck', color: MARCA.verde },
  pendiente: { icono: 'Clock', color: MARCA.ambar },
  error: { icono: 'AlertTriangle', color: MARCA.rojo },
  info: { icono: 'Info', color: MARCA.azulClaro },
};

const BOTON = {
  reenviar: ['Reenviar a Hacienda', 'onReenviar'],
  contingencia: ['Enviar aviso de contingencia', 'onContingencia'],
  corregir: ['Corregir y facturar', 'onCorregir'],
  invalidacion: ['Enviar invalidación', 'onInvalidacion'],
};

export default function EstadoHacienda({ documento, ocupado = false, puedeActuar = true, ...acciones }) {
  const r = revisionHacienda(documento);
  if (!r) return null;
  const n = NIVEL[r.nivel];
  const obs = documento.observaciones_mh ?? [];
  const [texto, prop] = BOTON[r.accion] ?? [];
  const onPress = prop ? acciones[prop] : null;
  return (
    <Vidrio radio={22} tinte={`${n.color}22`}>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: `${n.color}33`, alignItems: 'center', justifyContent: 'center' }}>
            <Host matchContents><Icon name={iconoDe(n.icono)} size={19} color={n.color} /></Host>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: n.color, fontSize: 17, fontWeight: '800' }}>{r.titulo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{r.detalle}</Text>
          </View>
        </View>
        <View style={{ gap: 7 }}>
          {r.pasos.map((p) => (
            <View key={p.clave} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text style={{ width: 18, color: p.ok ? MARCA.verde : MARCA.rojo, fontSize: 15, fontWeight: '800' }}
                accessibilityLabel={p.ok ? 'bien' : 'falta'}>{p.ok ? '✓' : '✗'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{p.rotulo}</Text>
                {p.valor ? <Text selectable style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }}>{p.valor}</Text> : null}
              </View>
            </View>
          ))}
        </View>
        {obs.length ? (
          <View style={{ gap: 4, padding: 12, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>
              {`Lo que dice Hacienda${documento.descripcion_msg ? ` · ${documento.descripcion_msg}` : ''}`}
            </Text>
            {obs.map((o, i) => <Text key={i} style={{ color: colorSistema.texto2, fontSize: 13 }}>{`• ${o}`}</Text>)}
          </View>
        ) : null}
        {/* Cada botón de acá le habla a Hacienda: en sólo consulta, se hace en el portal. */}
        {puedeActuar && onPress && !ACCIONES_DE_DINERO ? <SeHaceEnElPortal /> : null}
        {puedeActuar && onPress && ACCIONES_DE_DINERO ? <BotonGrande texto={ocupado ? 'Un momento…' : texto} color={n.color} deshabilitado={ocupado} onPress={onPress} /> : null}
      </View>
    </Vidrio>
  );
}
