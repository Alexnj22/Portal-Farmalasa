// Personal, NATIVO — el directorio del portal (`EquiposView.jsx`): la gente de
// planilla agrupada por sala, en el orden del negocio (`pesoDeSucursal`), con
// sus cargos, su estado de hoy y lo que hay que saber de su expediente
// (`alertasDePersona`, la MISMA lista que pinta el portal). Llamar y escribir
// por WhatsApp salen de la tarjeta; tocarla abre su ficha en el portal.
//
// Mismo alcance que el portal: sin `staff_list` en ALL se ve sólo la sala
// propia. Búsqueda en la barra del sistema, «Activos / No están hoy» en el
// segmentado y la sala en el menú de filtros.
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { soloPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';
import { estadoDePersona, estaAusenteHoy } from '@nucleo/utils/estadoDePersona';
import { alertasDePersona, pesoDeSucursal } from '@nucleo/utils/alertasDePersona';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { anotar } from '@nucleo/data/audit';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { iconoDe } from '../tema/iconos';

// Las variantes del portal, en los colores de la marca.
const VARIANTE = {
  success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, neutral: colorSistema.texto2,
  'chart-1': MARCA.azulClaro, 'chart-3': MARCA.azul, 'chart-6': MARCA.violeta, 'chart-9': MARCA.azulClaro,
};
const colorDe = (v) => VARIANTE[v] ?? MARCA.azulClaro;
const INACTIVOS = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'];
const soloDigitos = (tel) => String(tel || '').replace(/\D/g, '');

function BotonRedondo({ icono, color, onPress, etiqueta }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={etiqueta} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: color + '22', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Host matchContents><Icon name={iconoDe(icono)} size={20} color={color} /></Host>
    </Pressable>
  );
}

function Tarjeta({ emp }) {
  const estado = estadoDePersona(emp);
  const alertas = alertasDePersona(emp);
  const cargos = [emp.role, emp.secondary_role || emp.secondaryRole].filter(Boolean);
  const tel = soloDigitos(emp.phone);
  const nombre = shortEmployeeName(emp);
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/portal', params: { ruta: `/personal/empleado/${emp.id}`, nombre } });
  };
  const contactar = (via) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    anotar(via === 'wa' ? 'PERSONAL_WHATSAPP' : 'PERSONAL_LLAMAR', emp.id, { desde: 'app' });
    const tel503 = tel.length === 8 ? `503${tel}` : tel;
    Linking.openURL(via === 'wa' ? `https://wa.me/${tel503}` : `tel:${tel}`).catch(() => {});
  };
  return (
    <Pressable onPress={abrir} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={emp} tamano={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{nombre}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{cargos.join(' · ') || 'Sin cargo'}</Text>
            </View>
            {tel ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <BotonRedondo icono="MessageCircle" color={MARCA.verde} etiqueta={`Escribir a ${nombre}`} onPress={() => contactar('wa')} />
                <BotonRedondo icono="Phone" color={MARCA.azul} etiqueta={`Llamar a ${nombre}`} onPress={() => contactar('tel')} />
              </View>
            ) : null}
          </View>
          {estado || alertas.length ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {estado ? <Pildora texto={estado.texto} color={colorDe(estado.variante)} /> : null}
              {alertas.map((a) => <Pildora key={a.key} texto={a.texto} color={colorDe(a.variante)} />)}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Personal() {
  const { user, getScope } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('staff_list') === 'ALL';
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState('activos');
  const [sala, setSala] = useState('todas');

  const nombreDe = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const salaDe = (e) => String(e.branchId ?? e.branch_id ?? '');

  // La plantilla del alcance: planilla, sin dados de baja.
  const plantilla = useMemo(() => {
    const base = todas ? (empleados || []) : (empleados || []).filter((e) => salaDe(e) === String(user?.branchId));
    return soloPersonalEnPlanilla(base).filter((e) => !INACTIVOS.includes(e.status));
  }, [empleados, todas, user?.branchId]);
  const ausentes = useMemo(() => plantilla.filter(estaAusenteHoy).length, [plantilla]);

  const secciones = useMemo(() => {
    let personas = plantilla
      .filter((e) => (vista === 'ausentes' ? estaAusenteHoy(e) : !estaAusenteHoy(e)))
      .filter((e) => sala === 'todas' || salaDe(e) === sala);
    if (texto.trim()) {
      personas = smartFilter(texto, personas, (e) => [e.name, e.role, e.secondary_role, nombreDe.get(salaDe(e))]).results;
    }
    const porSala = new Map();
    for (const e of personas) {
      const k = salaDe(e);
      if (!porSala.has(k)) porSala.set(k, []);
      porSala.get(k).push(e);
    }
    return [...porSala.entries()]
      .map(([id, gente]) => ({ id, nombre: nombreDe.get(id) || 'Sin sala', gente: gente.sort((a, b) => shortEmployeeName(a).localeCompare(shortEmployeeName(b))) }))
      .sort((a, b) => pesoDeSucursal(a.nombre) - pesoDeSucursal(b.nombre) || a.nombre.localeCompare(b.nombre));
  }, [plantilla, vista, sala, texto, nombreDe]);

  const salas = useMemo(() => [...new Set(plantilla.map(salaDe))]
    .map((id) => ({ id, label: nombreDe.get(id) || 'Sin sala' }))
    .sort((a, b) => pesoDeSucursal(a.label) - pesoDeSucursal(b.label) || a.label.localeCompare(b.label)), [plantilla, nombreDe]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: 'todas', onCambiar: setSala,
    opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas] }] : [];
  const total = secciones.reduce((n, s) => n + s.gente.length, 0);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Personal', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, cargo o sala', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'activos', label: 'En la sala' }, { id: 'ausentes', label: ausentes ? `No están hoy · ${ausentes}` : 'No están hoy' }]} />
        {secciones.map((s) => (
          <View key={s.id} style={{ gap: 10 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginHorizontal: 20, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {`${s.nombre} · ${s.gente.length}`}
            </Text>
            {s.gente.map((e) => <Tarjeta key={e.id} emp={e} />)}
          </View>
        ))}
        {!total ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {texto ? 'Nadie con ese nombre' : vista === 'ausentes' ? 'Hoy están todos' : 'Sin personas'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
