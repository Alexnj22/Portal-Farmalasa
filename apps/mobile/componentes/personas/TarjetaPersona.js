// La tarjeta de una persona en Personal — la `TarjetaPersona` del portal: foto,
// nombre, el estado de hoy (con «vuelve el …»), sus cargos con el color de su
// jerarquía, «Cubre N áreas», a quién responde (jefatura y adscritos), las
// alertas del expediente, la sala, y WhatsApp/llamar visibles. Tocarla abre la
// ficha NATIVA (`empleado/[id]`). La jefatura y el segundo van «destacados».
import { Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { estadoDePersona, estaAusenteHoy } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona, datosPendientesDePersona } from '@nucleo/utils/alertasDePersona';
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
import IconoComun from '../IconoFijo';

const INACTIVOS = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'];
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

// El verde de WhatsApp, tintado (el sólido de antes gritaba más que el nombre).
const VERDE_CLARO = MARCA.verde;

// El ícono, por la pieza común (en iPhone, vista nativa simple: ver
// componentes/IconoFijo.ios.js).
const IconoFijo = ({ nombre, tamano, color }) => <IconoComun name={iconoDe(nombre)} size={tamano} color={color} />;

// WhatsApp y Llamar: secundarios (usuario, 2026-11-12: «muy grandes… no es lo
// principal»). Dos círculos chicos de color suave al pie, a la derecha, siempre
// en el mismo lugar; lo principal de la tarjeta es entrar al perfil.
// Del mismo alto que la píldora del cargo, para que el renglón quede parejo.
function PildoraChica({ texto, color }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: `${color}26` }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}

function BotonDeContacto({ icono, color, onPress, etiqueta }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${color}26`, borderWidth: 0.5, borderColor: `${color}59`, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <IconoFijo nombre={icono} tamano={17} color={color} />
    </Pressable>
  );
}

/**
 * La alerta en palabras que dicen QUÉ (2026-11-12, usuario: «me dice falta 1
 * dato, vence en 49 d, pero ¿qué?»): con un solo dato, cuál; con el documento,
 * cuál vence. El núcleo da el rótulo corto (el del portal) y el detalle en
 * `title`.
 */
export function textoDeAlerta(a, emp) {
  if (a.key === 'pendiente') {
    const faltan = datosPendientesDePersona(emp);
    return faltan.length === 1 ? `Falta ${faltan[0]}` : a.texto;
  }
  if (a.key === 'documento') {
    const [doc] = String(a.title || '').split(':');
    return doc ? `${doc.trim()} · ${a.texto.replace(/^Vence/, 'vence').replace('Documento vencido', 'vencido')}` : a.texto;
  }
  return a.texto;
}

export default function TarjetaPersona({ emp, roles, nombreDeSala, destacada = false, conSuperior = false }) {
  const estado = estadoDePersona(emp);
  const ausente = estaAusenteHoy(emp);
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
      <Vidrio radio={20} interactivo tinte={destacada ? 'rgba(0,82,204,0.16)' : undefined}>
        <View style={{ padding: 14, gap: 8, opacity: inactiva ? 0.6 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={emp} tamano={destacada ? 64 : 48} />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{ color: colorSistema.texto, fontSize: destacada ? 17 : 16, fontWeight: '700' }}>{nombre}</Text>
              {/* Estado, cargos, áreas y alertas en UN renglón que se parte solo
                  (2026-11-12, usuario: «¿por qué en vez de salir a la par sale
                  una abajo de otra usando más espacio?»). */}
              <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                {estado ? <PildoraChica texto={`${estado.texto}${estado.hasta ? ` · vuelve el ${estado.hasta}` : ''}`} color={colorDeVariante(estado.variante)} /> : null}
                {cargos.length ? cargos.map((c) => <PildoraDeCargo key={c} cargo={c} />) : <PildoraDeCargo cargo="Sin cargo" />}
                {areas >= 2 ? <PildoraChica texto={`Cubre ${areas} áreas`} color={MARCA.azulClaro} /> : null}
                {inactiva ? <PildoraChica texto="Dado de baja" color={MARCA.rojo} /> : null}
                {alertas.map((a) => <PildoraChica key={a.key} texto={textoDeAlerta(a, emp)} color={colorDeVariante(a.variante)} />)}
              </View>
            </View>
          </View>
          {respondeA ? <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{`↳ Responde a ${respondeA}`}</Text> : null}
          {/* El pie: que se entienda que la tarjeta abre el perfil, y el
              contacto chico a la derecha. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: colorSistema.acento, fontSize: 14, fontWeight: '600' }}>Ver perfil  ›</Text>
            {tel.length >= 8 && !inactiva ? (
              <>
                <BotonDeContacto icono="MessageCircle" color={VERDE_CLARO} etiqueta={`Escribir a ${nombre} por WhatsApp`} onPress={() => contactar('wa')} />
                <BotonDeContacto icono="Phone" color={MARCA.azulClaro} etiqueta={`Llamar a ${nombre}`} onPress={() => contactar('tel')} />
              </>
            ) : null}
          </View>
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
      <Vidrio radio={20} tinte="rgba(247,144,9,0.12)">
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
export function TarjetaPracticante({ p, nombreDeSala, puedeEditar = false }) {
  const [texto, color] = ESTADO_PRACTICANTE[p.estado] || ESTADO_PRACTICANTE.ACTIVO;
  // Con permiso de edición, tocar abre su formulario (editar, estado, eliminar).
  return (
    <Pressable disabled={!puedeEditar}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/empleado/practicante', params: { id: String(p.id) } }); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20}>
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
    </Pressable>
  );
}
