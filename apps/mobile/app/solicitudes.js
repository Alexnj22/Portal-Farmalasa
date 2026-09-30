// Solicitudes, nativa: la bandeja del portal (Solicitudes de la sala +
// Solicitudes personales) en una sola lista, con el control segmentado del
// sistema para el estado, píldoras por familia y el buscador de la barra.
// Tocar una abre `solicitud/[id]`, que es donde se decide.
//
// Las reglas —quién ve cada una, quién la decide, el orden de la cola— son las
// MISMAS del portal: salen de `utils/bandejaDeSolicitudes.js` del núcleo. Los
// dos ámbitos del portal son dos módulos con dos permisos, así que cada
// solicitud se juzga con las reglas del SUYO (`esOperativa`).
//
// Lo pendiente se ve entero; lo resuelto, sólo los últimos 30 días — una
// bandeja es una cola, no un archivo (el portal recorta por semana).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { REQUEST_TYPES, esOperativa, adaptarMinMax } from '@nucleo/store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests } from '@nucleo/data/minmaxRequests';
import { ERP_NAMES, ERP_ORDEN, BRANCH_A_ERP } from '@nucleo/constants/erp';
import { buscadorDePersonas, lineasDe } from '@nucleo/utils/movimientoTexto';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { reglasDeBandeja, ordenarCola, salaDeSolicitud } from '@nucleo/utils/bandejaDeSolicitudes';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { nombreDelIconoDeTipo } from '@nucleo/constants/tipoIconos';
import { Host, Icon } from '@expo/ui';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Avatar from '../componentes/Avatar';
import { MARCA } from '../componentes/inicio/Secciones';
import Vidrio from '../componentes/Vidrio';
import { iconoDe } from '../tema/iconos';
import { abrirSolicitud } from '../pantallas';

const DIAS_DE_HISTORIAL = 30;

/* Qué se le pide a la base. El portal lo pide por ámbito; acá los dos ámbitos
 * van en una sola lista, así que se pide lo más ancho que alguno de los dos
 * permita — el RLS recorta igual, y las reglas de la bandeja después. */
function criteriosDe(getScope, user) {
  const alcances = [getScope?.('requests'), getScope?.('requests_personales')];
  if (alcances.includes('ALL')) return { branchId: null };
  if (alcances.includes('BRANCH')) return { branchId: user?.branchId ?? null };
  return { soloMiasId: user?.id };
}

// La tarjeta de una solicitud, en vidrio como el resto de la app: arriba el
// tipo con su ícono (el mismo del portal, `nombreDelIconoDeTipo`) y cuándo
// llegó; en medio lo que se pide y sus primeros renglones; abajo quién la
// pidió y el estado en una píldora del color de estado.
// Colores en hexadecimal (los de la marca): a los del sistema no se les puede
// pegar la transparencia del fondo tintado.
const PILDORA = {
  PENDING: { texto: 'Pendiente', color: MARCA.ambar },
  APPROVED: { texto: 'Aprobada', color: MARCA.verde },
  REJECTED: { texto: 'Rechazada', color: MARCA.rojo },
  CANCELLED: { texto: 'Cancelada', color: '#8E8E93' },
};
const DECIDIR = { texto: 'Te toca decidir', color: MARCA.azulClaro };

function Fila({ r, detalle, teToca, onAbrir }) {
  const tipo = REQUEST_TYPES[r.type]?.label ?? 'Solicitud';
  const estado = teToca ? DECIDIR : (PILDORA[r.status] ?? PILDORA.PENDING);
  const colorTipo = estado.color;
  const renglones = (detalle?.renglones ?? []).slice(0, 2);
  const resto = (detalle?.renglones?.length ?? 0) - renglones.length;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onAbrir(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${colorTipo}30`, alignItems: 'center', justifyContent: 'center' }}>
              <Host matchContents><Icon name={iconoDe(nombreDelIconoDeTipo(r.type))} size={17} color={colorTipo} /></Host>
            </View>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{tipo}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{cuandoLlego(r.created_at)}</Text>
          </View>

          {detalle?.contexto || renglones.length ? (
            <View style={{ gap: 4 }}>
              {detalle?.contexto ? <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{detalle.contexto}</Text> : null}
              {renglones.map(([a, b], i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{a}</Text>
                  {b ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{b}</Text> : null}
                </View>
              ))}
              {resto > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>y {resto} más</Text> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <Avatar empleado={r.employee} tamano={24} />
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{shortEmployeeName(r.employee)}</Text>
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${estado.color}26` }}>
              <Text style={{ color: estado.color, fontSize: 12, fontWeight: '700' }}>{estado.texto}</Text>
            </View>
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
  const [minmaxFilas, setMinmaxFilas] = useState([]);
  const [estado, setEstado] = useState('PENDING');
  const [familia, setFamilia] = useState('todas');
  const [sala, setSala] = useState('todas');
  const [busqueda, setBusqueda] = useState('');
  const [recargando, setRecargando] = useState(false);
  const [cargado, setCargado] = useState(false);

  const miId = String(user?.id ?? '');
  const criterios = useMemo(() => criteriosDe(getScope, user), [getScope, user]);
  const veSala = hasPermission('requests', 'can_view');

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

  // Las reglas de cada ámbito, con SU módulo y SU alcance (igual que el portal).
  const reglas = useMemo(() => {
    const de = (modulo) => {
      const soloMio = getScope?.(modulo) === 'MINE';
      return reglasDeBandeja({ miId, soloMio, canApprove: hasPermission(modulo, 'can_approve') && !soloMio, hasPermission });
    };
    return { sala: de('requests'), personal: de('requests_personales') };
  }, [miId, getScope, hasPermission]);

  const buscarPersona = useMemo(() => {
    const enElMaestro = buscadorDePersonas(employees);
    return (id) => enElMaestro(id) ?? (id ? (personas?.[String(id)] ?? null) : null);
  }, [employees, personas]);

  // Min/Max vive en otra tabla: se adapta a la forma común y se guarda su fila
  // original para el detalle.
  const minmax = useMemo(() => minmaxFilas.map((f) => ({ ...adaptarMinMax(f, (id) => ERP_NAMES[id], buscarPersona), _fila: f })),
    [minmaxFilas, buscarPersona]);

  const todas = useMemo(() => {
    const limite = Date.now() - DIAS_DE_HISTORIAL * 86400000;
    return [...(requests ?? []), ...minmax].filter((r) => {
      const operativa = esOperativa(r.type) || r.type === 'MINMAX_CHANGE_REQUEST';
      if (!hasPermission(operativa ? 'requests' : 'requests_personales', 'can_view') && String(r.employee_id) !== miId) return false;
      if (!(operativa ? reglas.sala : reglas.personal).visible(r)) return false;
      return r.status === 'PENDING' || new Date(r.created_at).getTime() >= limite;
    });
  }, [requests, minmax, reglas, hasPermission, miId]);

  const cuenta = (s) => todas.filter((r) => r.status === s).length;
  const delEstado = todas.filter((r) => (estado === 'RESUELTAS' ? r.status !== 'PENDING' : r.status === estado));

  // Las opciones de cada filtro son las que de verdad tienen algo en este
  // estado: una opción vacía es un toque que no informa. Y si la elegida se
  // queda sin nada (se resolvió la última), el filtro vuelve a «todas».
  const familias = [...new Set(delEstado.map((r) => r.type))]
    .map((t) => ({ id: t, label: REQUEST_TYPES[t]?.label ?? 'Solicitud' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const conSala = new Set(delEstado.map(salaDeSolicitud).filter(Boolean));
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
    { id: 'sala', titulo: 'Sala', opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas], activa: sala, porDefecto: 'todas', onCambiar: setSala },
  ];

  const filtradas = delEstado.filter((r) => (familia === 'todas' || r.type === familia)
    && (sala === 'todas' || salaDeSolicitud(r) === sala));
  const { results } = busqueda.trim()
    ? smartFilter(busqueda, filtradas, (r) => [r.employee?.name, REQUEST_TYPES[r.type]?.label,
        r.metadata?.correlativo, r.metadata?.branch_name, r.metadata?.producto,
        ...lineasDe(r.metadata).map((i) => i.descripcion)])
    : { results: filtradas };
  const lista = ordenarCola(results);

  const detalleDe = (r) => (r._fila ? detalleDeMinMax(r._fila) : detalleDeSolicitud(r));
  const teToca = (r) => r.status === 'PENDING'
    && (esOperativa(r.type) || r.type === 'MINMAX_CHANGE_REQUEST' ? reglas.sala : reglas.personal).puedeDecidir(r);

  const pendientes = cuenta('PENDING');

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
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={estado} onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setEstado(v); }} opciones={[
          { id: 'PENDING', label: pendientes ? `Pendientes (${pendientes})` : 'Pendientes' },
          { id: 'RESUELTAS', label: 'Resueltas' },
        ]} />
        <FiltrosActivos grupos={grupos} />

        {lista.map((r) => (
          <Fila key={r.id} r={r} detalle={detalleDe(r)} teToca={teToca(r)} onAbrir={() => abrirSolicitud(r.id)} />
        ))}

        {cargado && !lista.length ? (
          <View style={{ alignItems: 'center', paddingTop: 70, gap: 6, paddingHorizontal: 32 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {busqueda ? 'Sin resultados' : estado === 'PENDING' ? 'Nada pendiente' : 'Nada resuelto'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {busqueda ? 'Prueba con otro nombre o producto.'
                : estado === 'PENDING' ? 'Lo que llegue aparece acá.' : `Lo de los últimos ${DIAS_DE_HISTORIAL} días aparece acá.`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
