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
import { ERP_NAMES } from '@nucleo/constants/erp';
import { buscadorDePersonas, lineasDe } from '@nucleo/utils/movimientoTexto';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { reglasDeBandeja, ordenarCola } from '@nucleo/utils/bandejaDeSolicitudes';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import Segmentos from '../componentes/Segmentos';
import Pestanas from '../componentes/inicio/Pestanas';
import Avatar from '../componentes/Avatar';
import { abrirSolicitud } from '../pantallas';

const DIAS_DE_HISTORIAL = 30;
const COLOR_ESTADO = { APPROVED: colorSistema.verde, REJECTED: colorSistema.rojo, CANCELLED: colorSistema.texto2 };
const ROTULO_ESTADO = { APPROVED: 'Aprobada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada' };

/* Qué se le pide a la base. El portal lo pide por ámbito; acá los dos ámbitos
 * van en una sola lista, así que se pide lo más ancho que alguno de los dos
 * permita — el RLS recorta igual, y las reglas de la bandeja después. */
function criteriosDe(getScope, user) {
  const alcances = [getScope?.('requests'), getScope?.('requests_personales')];
  if (alcances.includes('ALL')) return { branchId: null };
  if (alcances.includes('BRANCH')) return { branchId: user?.branchId ?? null };
  return { soloMiasId: user?.id };
}

function Fila({ r, detalle, teToca, onAbrir }) {
  const tipo = REQUEST_TYPES[r.type]?.label ?? 'Solicitud';
  const resuelta = r.status !== 'PENDING';
  return (
    <Pressable onPress={onAbrir} style={({ pressed }) => ({
      backgroundColor: colorSistema.fila, borderRadius: 16, marginHorizontal: 16, padding: 14,
      flexDirection: 'row', gap: 12, alignItems: 'center',
      transform: [{ scale: pressed ? 0.98 : 1 }], opacity: pressed ? 0.9 : 1,
    })}>
      <Avatar empleado={r.employee} tamano={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {shortEmployeeName(r.employee)}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{cuandoLlego(r.created_at)}</Text>
        </View>
        <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{tipo}</Text>
        {detalle?.contexto ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{detalle.contexto}</Text> : null}
        {resuelta ? (
          <Text style={{ color: COLOR_ESTADO[r.status] ?? colorSistema.texto2, fontSize: 12, fontWeight: '600', marginTop: 2 }}>
            {ROTULO_ESTADO[r.status] ?? r.status}
          </Text>
        ) : teToca ? (
          <Text style={{ color: colorSistema.acento, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Te toca decidir</Text>
        ) : null}
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 22, fontWeight: '300' }}>›</Text>
    </Pressable>
  );
}

export default function Solicitudes() {
  const { user, hasPermission, getScope } = useAuth();
  const requests = useStaffStore((s) => s.requests);
  const employees = useStaffStore((s) => s.employees);
  const personas = useStaffStore((s) => s.personasDeSolicitudes);
  const fetchRequests = useStaffStore((s) => s.fetchRequests);
  const [minmaxFilas, setMinmaxFilas] = useState([]);
  const [estado, setEstado] = useState('PENDING');
  const [familia, setFamilia] = useState('todas');
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

  // Familias que de verdad tienen algo en este estado: una píldora vacía es un
  // toque que no informa.
  const familias = [...new Set(delEstado.map((r) => r.type))]
    .map((t) => ({ id: t, label: REQUEST_TYPES[t]?.label ?? t }))
    .sort((a, b) => a.label.localeCompare(b.label));
  useEffect(() => {
    if (familia !== 'todas' && !familias.some((f) => f.id === familia)) setFamilia('todas');
  }, [familia, familias]);

  const filtradas = delEstado.filter((r) => familia === 'todas' || r.type === familia);
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={estado} onCambiar={(v) => { Haptics.selectionAsync().catch(() => {}); setEstado(v); }} opciones={[
          { id: 'PENDING', label: pendientes ? `Pendientes (${pendientes})` : 'Pendientes' },
          { id: 'RESUELTAS', label: 'Resueltas' },
        ]} />
        {familias.length > 1 ? (
          <Pestanas activa={familia} onCambiar={setFamilia} opciones={[{ id: 'todas', label: 'Todas' }, ...familias]} />
        ) : null}

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
