// Personal, NATIVO — el directorio del portal (`EquiposView.jsx`): una sección
// por sala, en el orden del negocio (`pesoDeSucursal`), con su estructura de
// mando —la jefatura y su segundo arriba y destacados, el «Puesto sin cubrir»
// cuando falta el segundo, «Sin jefatura» cuando no hay, el equipo, y aparte
// «También en esta sala» los que trabajan acá y responden a otro— y el pulso de
// la sala («12 personas · 2 vacaciones · 1 incapacidad»). Todo eso sale del
// núcleo (`repartirSala`, `estadoDePersona`, `alertasDePersona`), lo mismo
// que pinta el portal.
//
// Vistas del portal: Todos / Activos / Ausentes en el segmentado; Practicantes
// y Externos y sistema en el menú de filtros, junto con la sala. Tocar a
// alguien abre su ficha NATIVA (`empleado/[id]`), y desde ahí se edita
// (`empleado/editar`). El «+» de la barra da de alta a un empleado —o a un
// practicante, en esa vista—; tocar un practicante lo edita. Recontratar sigue
// en el portal.
//
// Mismo alcance que el portal: sin `staff_list` en ALL se ve sólo la sala propia.
import { useEffect, useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { soloNoEmpleados, soloPersonalEnPlanilla, esFichaQueNoEsEmpleado } from '@nucleo/utils/tipoDeFicha';
import { estadoDePersona, estaAusenteHoy } from '@nucleo/utils/estadoDePersona';
import { pesoDeSucursal } from '@nucleo/utils/alertasDePersona';
import { repartirSala } from '@nucleo/utils/mandoDeSala';
import { smartFilter } from '@nucleo/utils/searchUtils';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import Vidrio from '../componentes/Vidrio';
import TarjetaPersona, { PuestoVacante, TarjetaPracticante } from '../componentes/personas/TarjetaPersona';

const INACTIVOS = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'];
const salaDe = (e) => Number(e.branchId ?? e.branch_id) || 0;

/** «12 personas · 2 vacaciones · 1 incapacidad» — el `PulsoDeSala` del portal. */
function pulso(personas) {
  const m = new Map();
  personas.forEach((p) => { const e = estadoDePersona(p); const k = e && !e.faltan ? e.texto : 'activos'; m.set(k, (m.get(k) || 0) + 1); });
  return [`${personas.length} persona${personas.length === 1 ? '' : 's'}`, ...[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}`)].join(' · ');
}

export default function Personal() {
  const { user, getScope, hasPermission } = useAuth();
  const puedeEditar = hasPermission('staff_list', 'can_edit');
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const roles = useStaffStore((s) => s.roles);
  const practicantes = useStaffStore((s) => s.practicantes);
  const fetchPracticantes = useStaffStore((s) => s.fetchPracticantes);
  const todas = getScope?.('staff_list') === 'ALL';
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState('todos');
  const [tipo, setTipo] = useState('personal');
  const [sala, setSala] = useState('todas');
  useEffect(() => { fetchPracticantes?.(); }, [fetchPracticantes]);

  const nombreDe = useMemo(() => new Map((sucursales || []).map((b) => [Number(b.id), b.name])), [sucursales]);
  const base = useMemo(() => (todas ? (empleados || []) : (empleados || []).filter((e) => salaDe(e) === Number(user?.branchId))), [empleados, todas, user?.branchId]);
  // La plantilla vigente (para saber quién manda en cada sala aunque se filtre).
  const plantilla = useMemo(() => base.filter((e) => !INACTIVOS.includes(e.status)), [base]);
  const ausentes = useMemo(() => soloPersonalEnPlanilla(plantilla).filter(estaAusenteHoy).length, [plantilla]);

  const secciones = useMemo(() => {
    if (tipo === 'practicantes') {
      let lista = (practicantes || []).filter((p) => todas || Number(p.branch_id) === Number(user?.branchId))
        .filter((p) => sala === 'todas' || String(p.branch_id) === sala);
      if (texto.trim()) lista = smartFilter(texto, lista, (p) => [`${p.first_names || ''} ${p.last_names || ''}`, p.institucion_educativa, nombreDe.get(Number(p.branch_id))]).results;
      const m = new Map();
      lista.forEach((p) => { const k = Number(p.branch_id) || 0; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
      return [...m.entries()].map(([id, l]) => ({ id, titulo: nombreDe.get(id) || 'Sin sala', pulso: `${l.length} practicante${l.length === 1 ? '' : 's'}`, data: l.map((p) => ({ k: `p${p.id}`, practicante: p })) }))
        .sort((a, b) => pesoDeSucursal(a.titulo) - pesoDeSucursal(b.titulo));
    }
    let personas = (tipo === 'externos' ? soloNoEmpleados(base) : soloPersonalEnPlanilla(base))
      .filter((e) => (vista === 'activos' ? !estaAusenteHoy(e) && !INACTIVOS.includes(e.status) : vista === 'ausentes' ? estaAusenteHoy(e) : true))
      .filter((e) => sala === 'todas' || String(salaDe(e)) === sala);
    if (texto.trim()) personas = smartFilter(texto, personas, (e) => [e.name, e.role, e.secondary_role, nombreDe.get(salaDe(e))]).results;
    const porSala = new Map();
    personas.forEach((e) => { const k = salaDe(e); if (!porSala.has(k)) porSala.set(k, []); porSala.get(k).push(e); });
    return [...porSala.entries()].map(([id, gente]) => {
      const r = repartirSala({ personas: gente, todos: plantilla, roles: roles || [], sucursalId: id || null });
      const filas = [];
      if (r.jefe) filas.push({ k: `j${r.jefe.id}`, emp: r.jefe, destacada: true });
      (r.segundos || []).forEach((e) => filas.push({ k: `s${e.id}`, emp: e, destacada: true }));
      (r.vacantesDeSegundo || []).forEach((c) => filas.push({ k: `v${c.id}`, vacante: c.name }));
      (r.equipo || []).forEach((e) => filas.push({ k: `e${e.id}`, emp: e }));
      if ((r.adscritos || []).length) {
        filas.push({ k: `t${id}`, titulo: 'También en esta sala' });
        r.adscritos.forEach((e) => filas.push({ k: `a${e.id}`, emp: e, conSuperior: true }));
      }
      const sinSede = id === 0;
      return {
        id, sinSede, titulo: sinSede ? 'Sin sucursal asignada' : (nombreDe.get(id) || 'Sin sala'),
        pulso: pulso(gente), sinJefatura: !r.jefe && !sinSede,
        soloCuentas: gente.length > 0 && gente.every(esFichaQueNoEsEmpleado), data: filas,
      };
    }).sort((a, b) => (a.sinSede !== b.sinSede ? (a.sinSede ? 1 : -1) : pesoDeSucursal(a.titulo) - pesoDeSucursal(b.titulo) || a.titulo.localeCompare(b.titulo)));
  }, [tipo, practicantes, todas, user?.branchId, sala, texto, nombreDe, base, vista, plantilla, roles]);

  const salas = useMemo(() => [...new Set(plantilla.map(salaDe))].filter(Boolean)
    .map((id) => ({ id: String(id), label: nombreDe.get(id) || 'Sin sala' }))
    .sort((a, b) => pesoDeSucursal(a.label) - pesoDeSucursal(b.label) || a.label.localeCompare(b.label)), [plantilla, nombreDe]);
  const grupos = [
    { id: 'tipo', titulo: 'Ver', activa: tipo, porDefecto: 'personal', onCambiar: setTipo,
      opciones: [{ id: 'personal', label: 'Personal en planilla' }, { id: 'practicantes', label: 'Practicantes' }, { id: 'externos', label: 'Externos y sistema' }] },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: 'todas', onCambiar: setSala, opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas] }] : []),
  ];
  const total = secciones.reduce((n, s) => n + s.data.filter((f) => f.emp || f.practicante).length, 0);

  const Cabecera = (
    <View style={{ gap: 12, paddingTop: 12, paddingBottom: 4 }}>
      <FiltrosActivos grupos={grupos} />
      {tipo === 'personal' ? (
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'todos', label: 'Todos' }, { id: 'activos', label: 'Activos' }, { id: 'ausentes', label: ausentes ? `Ausentes · ${ausentes}` : 'Ausentes' }]} />
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${total} ${tipo === 'practicantes' ? 'practicante' : 'persona'}${total === 1 ? '' : 's'}`}</Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Personal', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, cargo o sala', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={puedeEditar && tipo !== 'externos' ? {
        icono: 'plus', etiqueta: tipo === 'practicantes' ? 'Nuevo practicante' : 'Nuevo empleado',
        onPress: () => router.push(tipo === 'practicantes' ? '/empleado/practicante' : '/empleado/editar'),
      } : null} />
      <SectionList
        sections={secciones}
        keyExtractor={(f) => f.k}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 48 }}
        ListHeaderComponent={Cabecera}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderSectionHeader={({ section: s }) => (
          <View style={{ marginTop: 14, marginBottom: 8, marginHorizontal: 12 }}>
            <Vidrio radio={14}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{s.titulo}</Text>
                  {s.sinJefatura ? <Pildora texto="Sin jefatura" color={MARCA.ambar} /> : null}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{s.pulso}</Text>
              </View>
            </Vidrio>
            {s.sinSede ? (
              <View style={{ marginTop: 8, marginHorizontal: 4 }}>
                <Aviso tono={s.soloCuentas ? 'nota' : 'cuidado'} texto={s.soloCuentas
                  ? 'Son cuentas del portal, no personas: no trabajan en ninguna sala, así que no llevan sede.'
                  : 'Estas fichas no tienen sucursal: no aparecen en ningún equipo ni en el conteo de ninguna sala. Falta elegirles una sede.'} />
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item: f }) => {
          if (f.titulo) return <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20, marginTop: 4 }}>{f.titulo}</Text>;
          if (f.vacante) return <PuestoVacante cargo={f.vacante} />;
          if (f.practicante) return <TarjetaPracticante p={f.practicante} puedeEditar={puedeEditar} />;
          return <TarjetaPersona emp={f.emp} roles={roles} destacada={f.destacada} conSuperior={f.conSuperior} />;
        }}
        ListEmptyComponent={(
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {texto ? 'Nadie con ese nombre' : vista === 'ausentes' ? 'Hoy están todos' : 'Sin personas'}
            </Text>
          </View>
        )}
      />
    </>
  );
}
