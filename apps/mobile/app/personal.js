// Personal, NATIVO — el directorio del portal (`EquiposView.jsx`): una sección
// por sala, en el orden del negocio (`pesoDeSucursal`), con su estructura de
// mando —la jefatura y su segundo arriba y destacados, el «Puesto sin cubrir»
// cuando falta el segundo, «Sin jefatura» cuando no hay, el equipo, y aparte
// «También en esta sala» los que trabajan acá y responden a otro— y el pulso de
// la sala («12 personas · 2 vacaciones · 1 incapacidad»). Todo eso sale del
// núcleo (`repartirSala`, `estadoDePersona`, `alertasDePersona`), lo mismo
// que pinta el portal.
//
// Vistas del portal: Planilla / Practicantes / Externos en las pestañas; Todos /
// Activos / Ausentes en el menú de filtros, junto con la sala. Tocar a
// alguien abre su ficha NATIVA (`empleado/[id]`), y desde ahí se edita
// (`empleado/editar`). El «+» de la barra da de alta a un empleado —o a un
// practicante, en esa vista—; tocar un practicante lo edita. Recontratar sigue
// en el portal.
//
// Mismo alcance que el portal: sin `staff_list` en ALL se ve sólo la sala propia.
// Con `staff_list_descargar`, «Exportar el directorio» comparte el MISMO CSV
// del portal (`tablaDelDirectorio`) con lo que está a la vista; las columnas
// que la llave no deja llenar no van.
//
// Como el portal: quien ya no trabaja acá va APARTE al final de su sala («Ya no
// trabajan aquí») — dentro del reparto podía salir como jefatura y contaba en
// el pulso —; el filtro de sala incluye a quien la CUBRE (`assigned_branch_ids`)
// aunque su sede sea otra; y arriba, la franja del seguro de vida colectivo
// («Pago 2026 pendiente», «3 sin cubrir») abre su vista (`/seguro-de-vida`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ICONO } from '../componentes/solicitudes/iconos';
import { Host, Icon } from '@expo/ui';
import { fetchPoliza, fetchPagoDelAnio } from '@nucleo/data/seguroDeVida';
import { periodoVigente, estadoEnElSeguro } from '@nucleo/utils/seguroDeVida';
import { iconoDe } from '../tema/iconos';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { soloNoEmpleados, soloPersonalEnPlanilla, esFichaQueNoEsEmpleado } from '@nucleo/utils/tipoDeFicha';
import { estadoDePersona, estaAusenteHoy } from '@nucleo/utils/estadoDePersona';
import { pesoDeSucursal } from '@nucleo/utils/alertasDePersona';
import { repartirSala } from '@nucleo/utils/mandoDeSala';
import { smartFilter } from '@nucleo/utils/searchUtils';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { tablaDelDirectorio } from '@nucleo/utils/directorioCsv';
import { compartirCsv } from '../componentes/fiscal/csv';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import Vidrio from '../componentes/Vidrio';
import TarjetaPersona, { PuestoVacante, TarjetaPracticante } from '../componentes/personas/TarjetaPersona';
import IconoFijo from '../componentes/IconoFijo';

const INACTIVOS = ['INACTIVO', 'Inactivo', 'LIQUIDADO', 'Liquidado'];
const salaDe = (e) => Number(e.branchId ?? e.branch_id) || 0;
const esDeBaja = (e) => INACTIVOS.includes(e?.status);
// ¿Trabaja en esta sala? La principal o cualquiera de las que cubre. Sólo para
// el FILTRO: la sección sigue siendo la sala principal (como `cubreLaSala` del
// portal).
const cubreLaSala = (e, sala) => String(salaDe(e)) === String(sala)
  || (e.assigned_branch_ids || []).some((id) => String(id) === String(sala));

/** La franja del seguro de vida: el estado del pago del año en una línea. */
function FranjaDelSeguro({ personas }) {
  const [resumen, setResumen] = useState(null);   // null = cargando
  useFocusEffect(useCallback(() => {
    let vivo = true;
    fetchPoliza()
      .then(async (poliza) => {
        const anio = periodoVigente(new Date(), poliza?.mes_de_pago || 11);
        const pago = await fetchPagoDelAnio(anio);
        if (vivo) setResumen({ anio, pago });
      })
      .catch(() => { if (vivo) setResumen({ fallo: true }); });
    return () => { vivo = false; };
  }, []));
  const alDia = resumen?.pago ? personas.filter((e) => estadoEnElSeguro(e.id, resumen.pago).clave === 'solvente').length : 0;
  const estado = !resumen ? null
    : resumen.fallo ? { texto: 'No se pudo leer', variante: 'neutral' }
      : !resumen.pago ? { texto: `Pago ${resumen.anio} pendiente`, variante: 'warning' }
        : alDia === personas.length ? { texto: 'Todos solventes', variante: 'success' }
          : { texto: `${personas.length - alDia} sin cubrir`, variante: 'warning' };
  const detalle = !resumen ? 'Cargando…' : resumen.fallo ? 'Póliza y pago anual'
    : resumen.pago ? `${alDia} de ${personas.length} solventes` : `${personas.length} personas en planilla`;
  // Compacta (2026-11-12, usuario: «el seguro de vida colectivo… de forma más
  // compacta»): una píldora en el renglón del conteo, no una tarjeta entera.
  const color = estado ? colorDeVariante(estado.variante) : colorSistema.texto2;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Seguro de vida colectivo: ${estado?.texto ?? 'cargando'}. ${detalle}`}
      onPress={() => router.push('/seguro-de-vida')} hitSlop={6}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 12, borderRadius: 17,
        backgroundColor: `${color}1F`, borderWidth: 0.5, borderColor: `${color}55`, opacity: pressed ? 0.7 : 1 })}>
      <IconoFijo name={iconoDe('ShieldCheck')} size={14} color={color} />
      <Text style={{ color, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{`Seguro · ${estado?.texto ?? '…'}`}</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>›</Text>
    </Pressable>
  );
}

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
  // Las salas que se contraen (2026-11-12, usuario: «que se puedan minimizar las
  // sucursales»). Con una búsqueda escrita se abren todas: lo encontrado no
  // puede quedar escondido en una sala cerrada.
  const [plegadas, setPlegadas] = useState(() => new Set());
  const plegar = (id) => { Haptics.selectionAsync().catch(() => {}); setPlegadas((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  useEffect(() => { fetchPracticantes?.(); }, [fetchPracticantes]);

  const nombreDe = useMemo(() => new Map((sucursales || []).map((b) => [Number(b.id), b.name])), [sucursales]);
  const base = useMemo(() => (todas ? (empleados || []) : (empleados || []).filter((e) => salaDe(e) === Number(user?.branchId))), [empleados, todas, user?.branchId]);
  // La plantilla vigente (para saber quién manda en cada sala aunque se filtre).
  const plantilla = useMemo(() => base.filter((e) => !INACTIVOS.includes(e.status)), [base]);

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
      .filter((e) => sala === 'todas' || cubreLaSala(e, sala));
    if (texto.trim()) personas = smartFilter(texto, personas, (e) => [e.name, e.role, e.secondary_role, nombreDe.get(salaDe(e))]).results;
    const porSala = new Map();
    personas.forEach((e) => { const k = salaDe(e); if (!porSala.has(k)) porSala.set(k, []); porSala.get(k).push(e); });
    return [...porSala.entries()].map(([id, todosEnSala]) => {
      // Al reparto entra sólo quien trabaja acá; las bajas van al final, aparte.
      const gente = todosEnSala.filter((e) => !esDeBaja(e));
      const bajas = todosEnSala.filter(esDeBaja);
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
      if (bajas.length) {
        filas.push({ k: `b${id}`, titulo: 'Ya no trabajan aquí' });
        bajas.forEach((e) => filas.push({ k: `x${e.id}`, emp: e }));
      }
      const sinSede = id === 0;
      return {
        id, sinSede, titulo: sinSede ? 'Sin sucursal asignada' : (nombreDe.get(id) || 'Sin sala'),
        pulso: `${pulso(gente)}${bajas.length ? ` · ${bajas.length} de baja` : ''}`, sinJefatura: !r.jefe && !sinSede && gente.length > 0,
        soloCuentas: todosEnSala.length > 0 && todosEnSala.every(esFichaQueNoEsEmpleado), data: filas,
      };
    }).sort((a, b) => (a.sinSede !== b.sinSede ? (a.sinSede ? 1 : -1) : pesoDeSucursal(a.titulo) - pesoDeSucursal(b.titulo) || a.titulo.localeCompare(b.titulo)));
  }, [tipo, practicantes, todas, user?.branchId, sala, texto, nombreDe, base, vista, plantilla, roles]);

  const salas = useMemo(() => [...new Set(plantilla.map(salaDe))].filter(Boolean)
    .map((id) => ({ id: String(id), label: nombreDe.get(id) || 'Sin sala' }))
    .sort((a, b) => pesoDeSucursal(a.label) - pesoDeSucursal(b.label) || a.label.localeCompare(b.label)), [plantilla, nombreDe]);
  const grupos = [
    ...(tipo === 'personal' ? [{ id: 'estado', titulo: 'Ver', activa: vista, porDefecto: 'todos', onCambiar: setVista,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'activos', label: 'Activos' }, { id: 'ausentes', label: 'Ausentes' }] }] : []),
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: 'todas', onCambiar: setSala, opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas] }] : []),
  ];
  // Quién entra en la póliza: la misma lista que usa la vista del seguro.
  const enPlanilla = useMemo(() => soloPersonalEnPlanilla((empleados || []).filter((e) => e.status === 'ACTIVO')), [empleados]);
  const total = secciones.reduce((n, s) => n + s.data.filter((f) => f.emp || f.practicante).length, 0);
  const puedeExportar = !!hasPermission?.('staff_list_descargar');
  const exportar = () => {
    const visibles = secciones.flatMap((s) => s.data.filter((f) => f.emp).map((f) => f.emp));
    const { headers, rows, nombre } = tablaDelDirectorio(visibles, nombreDe, {
      identidad: !!hasPermission?.('staff_detail', 'can_view'),
    });
    Promise.resolve(compartirCsv({ headers, rows, nombre, modulo: 'personal' })).catch(() => {});
  };

  const buscando = !!texto.trim();
  const todasPlegadas = secciones.length > 0 && secciones.every((s) => plegadas.has(s.id));
  const Cabecera = (
    <View style={{ gap: 10, paddingTop: 12, paddingBottom: 4 }}>
      <FiltrosActivos grupos={grupos} />
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginHorizontal: 16 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', flexGrow: 1 }}>{`${total} ${tipo === 'practicantes' ? 'practicante' : 'persona'}${total === 1 ? '' : 's'}`}</Text>
        {tipo === 'personal' && (vista === 'todos' || vista === 'activos') ? <FranjaDelSeguro personas={enPlanilla} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginHorizontal: 20 }}>
        {secciones.length > 1 && !buscando ? (
          <Pressable hitSlop={8} accessibilityRole="button" onPress={() => { Haptics.selectionAsync().catch(() => {}); setPlegadas(todasPlegadas ? new Set() : new Set(secciones.map((s) => s.id))); }}
            style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{todasPlegadas ? 'Abrir todas las salas' : 'Contraer todas las salas'}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {puedeExportar && tipo === 'personal' && total ? (
          <Pressable hitSlop={8} accessibilityRole="button" onPress={exportar} style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Exportar</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  const visibles = secciones.map((s) => (!buscando && plegadas.has(s.id) ? { ...s, data: [], plegada: true } : s));

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Personal',
        headerSearchBarOptions: {
          placeholder: 'Nombre, cargo o sala', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={puedeEditar && tipo !== 'externos' ? {
        icono: 'plus', etiqueta: tipo === 'practicantes' ? 'Nuevo practicante' : 'Nuevo empleado',
        onPress: () => router.push(tipo === 'practicantes' ? '/empleado/practicante' : '/empleado/editar'),
      } : null} />
      {/* Fijo arriba al desplazar (2026-11-11). */}
      <FijoArriba>
        <Segmentos activa={tipo} onCambiar={setTipo}
          opciones={[{ id: 'personal', label: 'Planilla' }, { id: 'practicantes', label: 'Practicantes' }, { id: 'externos', label: 'Externos' }]} />
      </FijoArriba>
      <SectionList
        sections={visibles}
        keyExtractor={(f) => f.k}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 48 }}
        ListHeaderComponent={Cabecera}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderSectionHeader={({ section: s }) => (
          <View style={{ marginTop: 14, marginBottom: s.plegada ? 0 : 8, marginHorizontal: 12 }}>
            <Pressable onPress={() => plegar(s.id)} disabled={buscando} accessibilityRole="button"
              accessibilityState={{ expanded: !s.plegada }} accessibilityLabel={`${s.titulo}, ${s.pulso}`}>
              {({ pressed }) => (
                <Vidrio radio={14} interactivo style={{ opacity: pressed ? 0.8 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{s.titulo}</Text>
                        {s.sinJefatura ? <Pildora texto="Sin jefatura" color={MARCA.ambar} /> : null}
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{s.pulso}</Text>
                    </View>
                    {!buscando ? (
                      <View style={{ transform: [{ rotate: s.plegada ? '0deg' : '90deg' }] }}>
                        <IconoFijo name={ICONO.siguiente} size={13} color={colorSistema.texto2} />
                      </View>
                    ) : null}
                  </View>
                </Vidrio>
              )}
            </Pressable>
            {s.sinSede && !s.plegada ? (
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
          <Vacio tono={!texto && vista === 'ausentes' ? 'bien' : 'neutro'} icono={texto ? 'Search' : 'Users'}
            titulo={texto ? 'Nadie con ese nombre' : vista === 'ausentes' ? 'Hoy están todos' : 'Sin personas'} />
        )}
      />
    </>
  );
}
