// Auditoría del sistema, NATIVO — `AuditView`: la bitácora de lo que se hizo
// en el portal y en el kiosco, la más reciente arriba, con quién lo hizo, la
// acción, su severidad, de dónde vino y en qué sala. Se filtra por acción y
// por período (hoy, siete días, todo) y se busca; tocar un registro muestra su
// detalle completo.
//
// El filtro y el orden salen del núcleo (`bitacora`), los mismos del portal —
// con el día de El Salvador. Exportar el CSV sigue en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ACCIONES_DE_BITACORA, filtrarBitacora, ordenarBitacora, ROTULO_DE_ORIGEN, varianteDeSeveridad } from '@nucleo/utils/bitacora';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

const TOPE = 100;

export default function AuditoriaDelSistema() {
  const logs = useStaffStore((s) => s.auditLog);
  const fetchAuditLogs = useStaffStore((s) => s.fetchAuditLogs);
  const empleados = useStaffStore((s) => s.employees);
  const [accion, setAccion] = useState('ALL');
  const [periodo, setPeriodo] = useState('hoy');
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => { await fetchAuditLogs?.(); setCargando(false); }, [fetchAuditLogs]);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const desde = periodo === 'hoy' ? hoySV() : periodo === 'semana' ? sumarDias(hoySV(), -6) : '';
  const visibles = useMemo(() => ordenarBitacora(filtrarBitacora(logs, { accion, desde }))
    .filter((l) => !texto.trim() || tokenMatch(texto.trim(), l.user_name, l.action, l.branch_name, l.device_name)), [logs, accion, desde, texto]);
  const grupos = [{ id: 'accion', titulo: 'Acción', activa: accion, porDefecto: 'ALL', onCambiar: setAccion,
    opciones: ACCIONES_DE_BITACORA.map((a) => ({ id: a.value, label: a.label })) }];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Auditoría', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Persona, acción, sala o equipo', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={periodo} onCambiar={setPeriodo} opciones={[{ id: 'hoy', label: 'Hoy' }, { id: 'semana', label: '7 días' }, { id: 'todo', label: 'Todo' }]} />
        {cargando && !(logs || []).length ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length} registro${visibles.length === 1 ? '' : 's'}`}</Text>
            {visibles.slice(0, TOPE).map((l, i) => {
              const quien = porId.get(String(l.user_id));
              const abiertoEste = abierto === (l.id ?? i);
              return (
                <Pressable key={l.id ?? i} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : (l.id ?? i)); }} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={16} interactivo>
                    <View style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Avatar empleado={quien ?? { name: l.user_name || 'Sistema' }} tamano={30} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{quien ? shortEmployeeName(quien) : (l.user_name || 'Sistema')}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(l.created_at)}</Text>
                        </View>
                        <Pildora texto={l.severity === 'CRITICAL' ? 'Crítico' : l.severity === 'WARNING' ? 'Aviso' : 'Info'} color={colorDeVariante(varianteDeSeveridad(l.severity))} />
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{l.action}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                        {[ROTULO_DE_ORIGEN[l.source] ?? l.source, l.branch_name, l.device_name].filter(Boolean).join(' · ')}
                      </Text>
                      {abiertoEste && l.details ? (
                        <Text selectable style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo', marginTop: 4 }}>{JSON.stringify(l.details, null, 2)}</Text>
                      ) : null}
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
            {visibles.length > TOPE ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 20 }}>{`Se muestran los ${TOPE} más recientes. Busca o filtra para acotar.`}</Text> : null}
            {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin registros en este período</Text> : null}
          </>
        )}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Exportar (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/auditoria-del-sistema', nombre: 'Auditoría' } })} />
        </View>
      </ScrollView>
    </>
  );
}
