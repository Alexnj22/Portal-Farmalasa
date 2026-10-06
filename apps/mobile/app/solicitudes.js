// Solicitudes, nativa: la bandeja del portal (Solicitudes de la sala +
// Solicitudes personales) en una sola lista. Tocar una abre `solicitud/[id]`,
// que es donde se decide.
//
// Lo mismo que el portal (`RequestsView`), a la manera del teléfono:
//   · el ESTADO en el control segmentado —Pendientes / Aprobadas / Rechazadas /
//     Todas, las `STATUS_TABS` del portal—;
//   · lo secundario en el menú de filtros de la barra: tipo, sala y «de quién»
//     (Todos / Sólo yo — no se ofrece a quien sólo ve lo suyo, donde no hay una
//     segunda cosa que ver);
//   · la SEMANA con flechas: recorta el HISTORIAL y nunca lo pendiente. Una
//     bandeja es una cola: lo que falta contestar se ve aunque se haya pedido
//     hace tres semanas, porque nadie retrocede semana por semana buscando lo
//     que no sabe que existe;
//   · agrupada por TIPO, con su encabezado (el del portal se pliega; éste
//     también).
//
// Las reglas —quién ve cada una, quién la decide, el orden de la cola— son las
// MISMAS del portal: salen de `utils/bandejaDeSolicitudes.js` del núcleo. Los
// dos ámbitos del portal son dos módulos con dos permisos, así que cada
// solicitud se juzga con las reglas del SUYO (`esOperativa`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { REQUEST_TYPES, esOperativa, adaptarMinMax, DISTRIBUCION_REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests } from '@nucleo/data/minmaxRequests';
import { ERP_NAMES, ERP_ORDEN, BRANCH_A_ERP } from '@nucleo/constants/erp';
import { familiasDisponibles } from '@nucleo/constants/familiasOperativas';
import {
  areaQueDecide, buscadorDePersonas, cuandoSeDecidio, desdeHace, esParcial, fmtFechaHora, fmtHora, lineasDe,
  motivoDeRechazoCorto, personasDe, salaQueEspera,
} from '@nucleo/utils/movimientoTexto';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { reglasDeBandeja, ordenarCola, salaDeSolicitud, deQuienEs } from '@nucleo/utils/bandejaDeSolicitudes';
import { enLaSemanaDe, getLocalMonday } from '@nucleo/utils/semana';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { nombreDelIconoDeTipo } from '@nucleo/constants/tipoIconos';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Avatar from '../componentes/Avatar';
import { MARCA } from '../componentes/inicio/marca';
import Vidrio from '../componentes/Vidrio';
import PasoDeSemana from '../componentes/solicitudes/PasoDeSemana';
import { ICONO } from '../componentes/solicitudes/iconos';
import { iconoDe } from '../tema/iconos';
import { abrirSolicitud } from '../pantallas';

/* Qué se le pide a la base. El portal lo pide por ámbito; acá los dos ámbitos
 * van en una sola lista, así que se pide lo más ancho que alguno de los dos
 * permita — el RLS recorta igual, y las reglas de la bandeja después. */
function criteriosDe(getScope, user) {
  const alcances = [getScope?.('requests'), getScope?.('requests_personales')];
  if (alcances.includes('ALL')) return { branchId: null };
  if (alcances.includes('BRANCH')) return { branchId: user?.branchId ?? null };
  return { soloMiasId: user?.id };
}

// El color es del ESTADO, nunca del tipo (la regla del portal): el tipo se lee
// por ícono y nombre. Hexadecimales de la marca para poder pegarles la
// transparencia del fondo tintado.
const PILDORA = {
  PENDING: { texto: 'Pendiente', color: MARCA.ambar },
  APPROVED: { texto: 'Aprobada', color: MARCA.verde },
  REJECTED: { texto: 'Rechazada', color: MARCA.rojo },
  CANCELLED: { texto: 'Cancelada', color: '#8E8E93' },
};
const DECIDIR = { texto: 'Te toca decidir', color: MARCA.azulClaro };
const ESTADOS = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'];

/* La tarjeta: quién la mandó (su cara) y el estado; el tipo y la sala; lo que
 * se pide con sus primeros renglones; el motivo del rechazo si lo hubo; y el
 * pie con cuándo entró —y cuánto lleva esperando— y en manos de quién está o
 * quién la cerró, con su hora. Es la `RequestCard` del portal. */
function Tarjeta({ r, detalle, teToca, porId, ahora, onAbrir }) {
  const tipo = REQUEST_TYPES[r.type]?.label ?? 'Solicitud';
  const base = PILDORA[r.status] ?? PILDORA.PENDING;
  const estado = teToca ? DECIDIR : (r.status === 'APPROVED' && esParcial(r) ? { texto: 'Aprobada parcial', color: MARCA.ambar } : base);
  const meta = (typeof r.metadata === 'object' && r.metadata) ? r.metadata : {};
  const { solicitante, aprobador } = personasDe(r, porId);
  const sala = r.type === 'INVENTORY_TRANSFER_REQUEST'
    ? ([meta.origen_branch_name, meta.branch_name].filter(Boolean).join(' → ') || null)
    : (meta.branch_name || solicitante?.branch_name || null);
  const renglones = (detalle?.renglones ?? []).slice(0, 3);
  const resto = (detalle?.renglones?.length ?? 0) - renglones.length;
  const pendiente = r.status === 'PENDING';
  const decidida = r.status === 'APPROVED' || r.status === 'REJECTED';
  const espera = pendiente ? desdeHace(r.created_at, ahora) : '';
  const esperaLarga = pendiente && ahora && (ahora - new Date(r.created_at).getTime()) > 2 * 86400000;
  const motivo = motivoDeRechazoCorto(r);
  const esperaSala = salaQueEspera(r);
  const area = areaQueDecide(r);
  const cerro = cuandoSeDecidio(r);
  const sinAprobadorFijo = r.type === 'MINMAX_CHANGE_REQUEST' && !aprobador;
  const quien = esperaSala || area || (aprobador ? shortEmployeeName(aprobador) : (decidida ? 'Sin registro' : 'Sin asignar'));
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onAbrir(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 10, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo tinte={r.type === 'DISABILITY' && pendiente ? `${MARCA.rojo}1A` : undefined}>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View>
              <Avatar empleado={solicitante ?? { name: '?' }} tamano={40} />
              <View style={{ position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: `${estado.color}`, alignItems: 'center', justifyContent: 'center' }}>
                <Host matchContents><Icon name={iconoDe(nombreDelIconoDeTipo(r.type))} size={11} color="#fff" /></Host>
              </View>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{solicitante ? shortEmployeeName(solicitante) : tipo}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{[tipo, sala].filter(Boolean).join(' · ')}</Text>
            </View>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${estado.color}26` }}>
              <Text style={{ color: estado.color, fontSize: 12, fontWeight: '700' }}>{estado.texto}</Text>
            </View>
          </View>

          {detalle?.contexto || renglones.length ? (
            <View style={{ gap: 4 }}>
              {detalle?.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{detalle.contexto}</Text> : null}
              {renglones.map(([a, b], i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{a}</Text>
                  {b ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{b}</Text> : null}
                </View>
              ))}
              {resto > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`y ${resto} más`}</Text> : null}
            </View>
          ) : null}

          {motivo ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '600' }}>{motivo}</Text> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, minWidth: 140, color: colorSistema.texto2, fontSize: 12 }}>
              {fmtFechaHora(r.created_at)}
              {espera ? <Text style={{ color: esperaLarga ? MARCA.ambar : colorSistema.texto2, fontWeight: '700' }}>{` · ${espera}`}</Text> : null}
            </Text>
            {r.status === 'CANCELLED' || (pendiente && sinAprobadorFijo) ? null : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: r.status === 'REJECTED' ? MARCA.rojo : decidida ? MARCA.verde : colorSistema.texto2, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {r.status === 'REJECTED' ? 'Rechazó' : decidida ? 'Aprobó' : 'Espera a'}
                </Text>
                {aprobador && !esperaSala && !area ? <Avatar empleado={aprobador} tamano={20} /> : null}
                <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '600', fontStyle: esperaSala || area || aprobador ? 'normal' : 'italic' }}>{quien}</Text>
                {decidida && cerro ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fmtHora(cerro)}</Text> : null}
              </View>
            )}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Solicitudes() {
  const { user, hasPermission, getScope } = useAuth();
  const requests = useStaffStore((s) => s.requests);
  const employees = useStaffStore((s) => s.employees);
  const branches = useStaffStore((s) => s.branches);
  const personas = useStaffStore((s) => s.personasDeSolicitudes);
  const fetchRequests = useStaffStore((s) => s.fetchRequests);
  const resolverPersonas = useStaffStore((s) => s.resolverPersonasDeSolicitudes);
  const ahora = useNowTick(60_000);
  const [minmaxFilas, setMinmaxFilas] = useState([]);
  const [estado, setEstado] = useState('PENDING');
  const [familia, setFamilia] = useState('todas');
  const [sala, setSala] = useState('todas');
  const [quien, setQuien] = useState('TODAS');
  const [semana, setSemana] = useState(() => getLocalMonday());
  const [plegados, setPlegados] = useState(() => new Set());
  const [busqueda, setBusqueda] = useState('');
  const [recargando, setRecargando] = useState(false);
  const [cargado, setCargado] = useState(false);

  const miId = String(user?.id ?? '');
  const criterios = useMemo(() => criteriosDe(getScope, user), [getScope, user]);
  const veSala = hasPermission('requests', 'can_view');
  // «Sólo yo» no se ofrece a quien sólo ve lo suyo en los dos ámbitos: no hay
  // una segunda cosa que ver, y un interruptor con un solo lado útil se lee
  // como que la pantalla esconde algo.
  const soloMioEnTodo = getScope?.('requests') === 'MINE' && getScope?.('requests_personales') === 'MINE';
  const filtrandoMias = !soloMioEnTodo && quien === 'MIAS';

  const cargar = useCallback(async () => {
    await Promise.all([
      fetchRequests(criterios),
      veSala
        ? fetchAllMinMaxChangeRequests().then((f) => setMinmaxFilas(f ?? [])).catch(() => {})
        : Promise.resolve(),
    ]);
    setCargado(true);
  }, [criterios, fetchRequests, veSala]);

  // Al volver de decidir una, la lista tiene que dejar de ofrecerla.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Quien decidió un Min/Max casi siempre es un cargo que el maestro esconde.
  useEffect(() => {
    if (!minmaxFilas.length || !resolverPersonas) return;
    resolverPersonas(minmaxFilas.map((f) => f.requested_by_id), minmaxFilas.map((f) => f.decided_by));
  }, [minmaxFilas, resolverPersonas]);

  // Las reglas de cada ámbito, con SU módulo y SU alcance (igual que el portal).
  const reglas = useMemo(() => {
    const de = (modulo) => {
      const soloMio = getScope?.(modulo) === 'MINE';
      return reglasDeBandeja({ miId, soloMio, canApprove: hasPermission(modulo, 'can_approve') && !soloMio, hasPermission });
    };
    return { sala: de('requests'), personal: de('requests_personales') };
  }, [miId, getScope, hasPermission]);

  const porId = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(String(e.id), e));
    Object.entries(personas || {}).forEach(([id, p]) => { if (!m.has(id)) m.set(id, p); });
    return m;
  }, [employees, personas]);

  const buscarPersona = useMemo(() => {
    const enElMaestro = buscadorDePersonas(employees);
    return (id) => enElMaestro(id) ?? (id ? (personas?.[String(id)] ?? null) : null);
  }, [employees, personas]);

  // Min/Max vive en otra tabla: se adapta a la forma común y se guarda su fila
  // original para el detalle.
  const minmax = useMemo(() => minmaxFilas.map((f) => ({ ...adaptarMinMax(f, (id) => ERP_NAMES[id], buscarPersona), _fila: f })),
    [minmaxFilas, buscarPersona]);

  // Lo que la persona puede ver. Los descuentos de la distribuidora se deciden
  // en su propia entrada, igual que en el portal.
  const visibles = useMemo(() => [...(requests ?? []), ...minmax].filter((r) => {
    if (DISTRIBUCION_REQUEST_TYPES?.has?.(r.type)) return false;
    const operativa = esOperativa(r.type) || r.type === 'MINMAX_CHANGE_REQUEST';
    if (!hasPermission(operativa ? 'requests' : 'requests_personales', 'can_view') && String(r.employee_id) !== miId) return false;
    return (operativa ? reglas.sala : reglas.personal).visible(r);
  }), [requests, minmax, reglas, hasPermission, miId]);

  // La semana recorta el HISTORIAL y deja pasar lo pendiente.
  const enFiltro = (r) => (!filtrandoMias || deQuienEs(r) === miId)
    && (sala === 'todas' || salaDeSolicitud(r) === sala)
    && (familia === 'todas' || r.type === familia)
    && (r.status === 'PENDING' || enLaSemanaDe(semana, r.created_at));

  const pendientes = visibles.filter((r) => r.status === 'PENDING' && enFiltro(r)).length;
  const delEstado = visibles.filter((r) => estado === 'ALL' || r.status === estado);

  // Las opciones de cada filtro son las que de verdad tienen algo en este
  // estado: una opción vacía es un toque que no informa. Y si la elegida se
  // queda sin nada (se resolvió la última), el filtro vuelve a «todas».
  const familias = [...new Set(delEstado.map((r) => r.type))]
    .map((t) => ({ id: t, label: REQUEST_TYPES[t]?.label ?? 'Solicitud' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const conSala = new Set(visibles.map(salaDeSolicitud).filter(Boolean));
  const salas = (branches ?? []).filter((b) => conSala.has(String(b.id)))
    .map((b) => ({ id: String(b.id), label: b.name,
      orden: BRANCH_A_ERP[b.id] != null ? ERP_ORDEN.indexOf(BRANCH_A_ERP[b.id]) : 99 }))
    .sort((a, b) => a.orden - b.orden);
  useEffect(() => {
    if (familia !== 'todas' && !familias.some((f) => f.id === familia)) setFamilia('todas');
    if (sala !== 'todas' && !salas.some((s) => s.id === sala)) setSala('todas');
  }, [familia, familias, sala, salas]);

  const grupos = [
    { id: 'tipo', titulo: 'Tipo', opciones: [{ id: 'todas', label: 'Todos los tipos' }, ...familias], activa: familia, porDefecto: 'todas', onCambiar: setFamilia },
    // El selector de sala es del ALCANCE, no de los datos (decisión del
    // usuario, 2026-08-21): con «mi sucursal» no se ofrece filtrar por las demás.
    ...(criterios.branchId === null && !criterios.soloMiasId
      ? [{ id: 'sala', titulo: 'Sala', opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas], activa: sala, porDefecto: 'todas', onCambiar: setSala }]
      : []),
    ...(!soloMioEnTodo
      ? [{ id: 'quien', titulo: 'De quién', opciones: [{ id: 'TODAS', label: 'Todos' }, { id: 'MIAS', label: 'Sólo yo' }], activa: quien, porDefecto: 'TODAS', onCambiar: setQuien }]
      : []),
  ];

  const filtradas = delEstado.filter(enFiltro);
  const { results, isFuzzy } = busqueda.trim()
    ? smartFilter(busqueda, filtradas, (r) => [r.employee?.name, REQUEST_TYPES[r.type]?.label,
        r.metadata?.correlativo, r.metadata?.branch_name, r.metadata?.producto,
        ...lineasDe(r.metadata).map((i) => i.descripcion)])
    : { results: filtradas, isFuzzy: false };

  // Agrupada por tipo; dentro de cada grupo, el orden de la cola. Los grupos,
  // en el orden de su solicitud más urgente.
  const secciones = useMemo(() => {
    const orden = ordenarCola(results);
    const porTipo = new Map();
    orden.forEach((r) => { const t = r.type || 'OTHER'; if (!porTipo.has(t)) porTipo.set(t, []); porTipo.get(t).push(r); });
    return [...porTipo.entries()].map(([tipo, filas]) => ({ tipo, total: filas.length, data: plegados.has(tipo) ? [] : filas }));
  }, [results, plegados]);

  const detalleDe = (r) => (r._fila ? detalleDeMinMax(r._fila) : detalleDeSolicitud(r));
  const teToca = (r) => r.status === 'PENDING'
    && (esOperativa(r.type) || r.type === 'MINMAX_CHANGE_REQUEST' ? reglas.sala : reglas.personal).puedeDecidir(r);

  const puedeCrear = familiasDisponibles(hasPermission).length > 0 || hasPermission('requests_personales', 'can_edit');
  const plegar = (tipo) => { Haptics.selectionAsync().catch(() => {}); setPlegados((p) => { const s = new Set(p); s.has(tipo) ? s.delete(tipo) : s.add(tipo); return s; }); };

  const vacio = cargado && !results.length;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA,
        title: 'Solicitudes',
        headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Persona, producto, factura…',
          hideWhenScrolling: true,
          onChangeText: (e) => setBusqueda(e.nativeEvent.text),
          onCancelButtonPress: () => setBusqueda(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={puedeCrear ? { icono: 'plus', etiqueta: 'Nueva solicitud', onPress: () => router.push('/nueva-solicitud') } : null} />
      <SectionList
        style={{ flex: 1 }}
        sections={secciones}
        keyExtractor={(r) => String(r.id)}
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ paddingTop: 12, gap: 12, paddingBottom: 6 }}>
            <Segmentos activa={estado} onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setEstado(v); }} opciones={[
              { id: 'PENDING', label: 'Pendientes' },
              { id: 'APPROVED', label: 'Aprobadas' },
              { id: 'REJECTED', label: 'Rechazadas' },
              { id: 'ALL', label: 'Todas' },
            ]} />
            {estado !== 'PENDING' ? <PasoDeSemana semana={semana} onCambiar={setSemana} /> : null}
            <FiltrosActivos grupos={grupos} />
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
              {estado === 'PENDING'
                ? (pendientes ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'} — se ven todas, sean de la semana que sean` : 'Nada pendiente')
                : `${results.length} solicitud${results.length === 1 ? '' : 'es'}${estado === 'ALL' && pendientes ? ` · ${pendientes} pendiente${pendientes === 1 ? '' : 's'} de cualquier semana` : ''}`}
            </Text>
            {isFuzzy && busqueda.trim() ? (
              <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600', marginHorizontal: 20 }}>{`Resultados parecidos a «${busqueda.trim()}»: no hubo coincidencias exactas.`}</Text>
            ) : null}
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <Pressable onPress={() => plegar(section.tipo)} accessibilityRole="button" accessibilityState={{ expanded: !plegados.has(section.tipo) }}
            style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 8 }}>
            <Vidrio radio={14}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 36 }}>
                <Host matchContents><Icon name={iconoDe(nombreDelIconoDeTipo(section.tipo))} size={14} color={colorSistema.texto2} /></Host>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {REQUEST_TYPES[section.tipo]?.label ?? 'Solicitud'}
                </Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{section.total}</Text>
                <View style={{ transform: [{ rotate: plegados.has(section.tipo) ? '0deg' : '90deg' }] }}>
                  <Host matchContents><Icon name={ICONO.siguiente} size={12} color={colorSistema.texto2} /></Host>
                </View>
              </View>
            </Vidrio>
          </Pressable>
        )}
        renderItem={({ item: r }) => (
          <Tarjeta r={r} detalle={detalleDe(r)} teToca={teToca(r)} porId={porId} ahora={ahora} onAbrir={() => abrirSolicitud(r.id)} />
        )}
        ListEmptyComponent={vacio ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 6, paddingHorizontal: 32 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {busqueda ? 'Sin resultados' : estado === 'PENDING' ? 'Todo al día' : 'Sin solicitudes'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {busqueda ? 'Prueba con otro nombre o producto.'
                : estado === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Nada en esta semana. Usa las flechas para mirar otra.'}
            </Text>
          </View>
        ) : null}
      />
    </>
  );
}
