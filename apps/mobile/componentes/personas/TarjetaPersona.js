// La tarjeta de una persona en Personal — la `TarjetaPersona` del portal: foto,
// nombre, el estado de hoy (con «vuelve el …»), sus cargos con el color de su
// jerarquía, «Cubre N áreas», a quién responde (jefatura y adscritos), las
// alertas del expediente, la sala, y WhatsApp/llamar visibles. Tocarla abre la
// ficha NATIVA (`empleado/[id]`). La jefatura y el segundo van «destacados».
import { Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { estadoDePersona } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona } from '@nucleo/utils/alertasDePersona';
import { cadenaDeSuperiores } from '@nucleo/utils/roles';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { anotar } from '@nucleo/data/audit';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { iconoDe } from '../../tema/iconos';
import { PildoraDeCargo } from './Piezas';

const INACTIVOS = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'];
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

function BotonRedondo({ icono, color, onPress, etiqueta }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${color}22`, transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color={color} /></Host>
    </Pressable>
  );
}

export default function TarjetaPersona({ emp, roles, nombreDeSala, destacada = false, conSuperior = false }) {
  const estado = estadoDePersona(emp);
  const ausente = !!estado && !estado.faltan;
  const alertas = alertasDePersona(emp);
  const cargos = [emp.role, emp.secondary_role || emp.secondaryRole].filter(Boolean);
  const tel = soloDigitos(emp.phone);
  const nombre = shortEmployeeName(emp);
  const inactiva = INACTIVOS.includes(emp.status);
  const areas = (emp.assigned_branch_ids || []).length;
  let respondeA = null;
  if (destacada || conSuperior) {
    const [padre] = cadenaDeSuperiores(roles || [], emp.role_id);
    respondeA = (roles || []).find((r) => String(r.id) === String(padre))?.name || null;
  }
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/empleado/[id]', params: { id: String(emp.id) } });
  };
  const contactar = (via) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    anotar(via === 'wa' ? 'PERSONAL_WHATSAPP' : 'PERSONAL_LLAMAR', emp.id, { desde: 'app' });
    const tel503 = tel.length === 8 ? `503${tel}` : tel;
    Linking.openURL(via === 'wa' ? `https://wa.me/${tel503}` : `tel:${tel}`).catch(() => {});
  };
  return (
    <Pressable onPress={abrir} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo tinte={destacada ? 'rgba(0,82,204,0.16)' : undefined}>
        <View style={{ padding: 14, gap: 8, opacity: inactiva ? 0.6 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={emp} tamano={destacada ? 58 : 46} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: ausente ? colorSistema.texto2 : colorSistema.texto, fontSize: destacada ? 17 : 16, fontWeight: '700' }}>{nombre}</Text>
              {estado ? (
                <View style={{ flexDirection: 'row' }}>
                  <Pildora texto={`${estado.texto}${estado.hasta ? ` · vuelve el ${estado.hasta}` : ''}`} color={colorDeVariante(estado.variante)} />
                </View>
              ) : null}
            </View>
            {tel.length >= 8 ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <BotonRedondo icono="MessageCircle" color={MARCA.verde} etiqueta={`Escribir a ${nombre}`} onPress={() => contactar('wa')} />
                <BotonRedondo icono="Phone" color={MARCA.azul} etiqueta={`Llamar a ${nombre}`} onPress={() => contactar('tel')} />
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', opacity: ausente ? 0.7 : 1 }}>
            {cargos.length ? cargos.map((c) => <PildoraDeCargo key={c} cargo={c} />) : <PildoraDeCargo cargo="Sin cargo" />}
            {areas >= 2 ? <Pildora texto={`Cubre ${areas} áreas`} color={MARCA.azulClaro} /> : null}
            {inactiva ? <Pildora texto="Dado de baja" color={MARCA.rojo} /> : null}
          </View>
          {respondeA ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{`↳ Responde a ${respondeA}`}</Text> : null}
          {alertas.length ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {alertas.map((a) => <Pildora key={a.key} texto={a.texto} color={colorDeVariante(a.variante)} />)}
            </View>
          ) : null}
          {nombreDeSala ? <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{nombreDeSala}</Text> : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

/** El hueco que la jefatura deja sin cubrir: se DICE, no se calla. */
export function PuestoVacante({ cargo }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22} tinte="rgba(247,144,9,0.12)">
        <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderStyle: 'dashed', borderColor: MARCA.ambar }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '700' }}>Puesto sin cubrir</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{cargo}</Text>
          </View>
        </View>
      </Vidrio>
    </View>
  );
}

const ESTADO_PRACTICANTE = { ACTIVO: ['Activo', MARCA.verde], FINALIZADO: ['Finalizado', colorSistema.texto2], CANCELADO: ['Cancelado', MARCA.rojo] };
const dma = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).split('-'); return `${dd}/${m}/${y}`; };

/** Un practicante: horas sociales, sin planilla ni expediente (otra tabla). */
export function TarjetaPracticante({ p, nombreDeSala }) {
  const [texto, color] = ESTADO_PRACTICANTE[p.estado] || ESTADO_PRACTICANTE.ACTIVO;
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 14, gap: 6 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${p.first_names || ''} ${p.last_names || ''}`.trim()}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pildora texto="Practicante" color={MARCA.violetaClaro} />
            <Pildora texto={texto} color={color} />
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{p.institucion_educativa || 'Sin institución'}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{`${dma(p.fecha_inicio)} → ${dma(p.fecha_fin)}`}</Text>
          {nombreDeSala ? <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{nombreDeSala}</Text> : null}
        </View>
      </Vidrio>
    </View>
  );
}
