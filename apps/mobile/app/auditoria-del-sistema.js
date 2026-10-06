// Auditoría del sistema, NATIVO — `AuditView`: la bitácora de lo que se hizo
// en el portal y en el kiosco, la más reciente arriba, con quién lo hizo, la
// acción, su severidad, de dónde vino y en qué sala. Se filtra por acción y
// por período —hoy, siete días, todo, o un rango de fechas con el calendario—
// y se busca; de 50 en 50. Tocar un registro abre su ficha en una hoja: quién,
// cuándo, equipo, origen, método de ingreso y objetivo, con los detalles
// plegados (son JSON y se leen sólo si hace falta).
//
// «En vivo» relee cada 10 segundos, como el portal. «Exportar» comparte el CSV
// de lo que se está viendo con las MISMAS columnas del portal
// (`COLUMNAS_CSV_BITACORA`) y se anota como salida de datos. Filtro, orden y
// columnas salen del núcleo (`bitacora`), con el día de El Salvador. Como en
// el portal, quien ve la auditoría puede exportarla.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  ACCIONES_DE_BITACORA, COLUMNAS_CSV_BITACORA, filasCsvDeBitacora, filtrarBitacora, ordenarBitacora, ROTULO_DE_ORIGEN, varianteDeSeveridad,
} from '@nucleo/utils/bitacora';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12, hora12ConSegundos } from '@nucleo/utils/hora';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { compartirCsv } from '../componentes/sistema/csv';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

const POR_PAGINA = 50;
const SEVERIDAD = { CRITICAL: 'Crítico', WARNING: 'Aviso' };

function Ficha({ l, quien, onCerrar }) {
  const [verDetalles, setVerDetalles] = useState(false);
  if (!l) return null;
  const detalles = l.details && Object.keys(l.details).length ? JSON.stringify(l.details, null, 2) : null;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Registro</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar empleado={quien ?? { name: l.user_name || 'Sistema' }} tamano={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{quien ? shortEmployeeName(quien) : (l.user_name || 'Sistema')}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fechaHora12(l.created_at, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            </View>
            <Pildora texto={SEVERIDAD[l.severity] ?? 'Info'} color={colorDeVariante(varianteDeSeveridad(l.severity))} />
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{l.action}</Text>
          <Seccion titulo="Dónde y cómo">
            <Dato primero rotulo="Origen" valor={ROTULO_DE_ORIGEN[l.source] ?? l.source ?? '—'} />
            <Dato rotulo="Sucursal" valor={l.branch_name || '—'} />
            <Dato rotulo="Equipo" valor={l.device_name || '—'} />
            <Dato rotulo="Método de ingreso" valor={l.input_method || '—'} />
            <Dato rotulo="Objetivo" valor={l.target_id || '—'} />
            <Dato rotulo="Hora exacta" valor={hora12ConSegundos(new Date(l.created_at))} />
          </Seccion>
          {detalles ? (
            <Seccion titulo="Detalles">
              <Pressable onPress={() => setVerDetalles((v) => !v)}><Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{verDetalles ? 'Ocultar' : 'Ver los detalles'}</Text></Pressable>
              {verDetalles ? <Text selectable style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }}>{detalles}</Text> : null}
            </Seccion>
          ) : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

export default function AuditoriaDelSistema() {
  const logs = useStaffStore((s) => s.auditLog);
  const fetchAuditLogs = useStaffStore((s) => s.fetchAuditLogs);
  const empleados = useStaffStore((s) => s.employees);
  const [accion, setAccion] = useState('ALL');
  const [periodo, setPeriodo] = useState('hoy');
  const [rango, setRango] = useState({ desde: sumarDias(hoySV(), -30), hasta: hoySV() });
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [enVivo, setEnVivo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [exportando, setExportando] = useState(false);

  const cargar = useCallback(async () => { await fetchAuditLogs?.(); setCargando(false); }, [fetchAuditLogs]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!enVivo) return undefined;
    const t = setInterval(() => { fetchAuditLogs?.(); }, 10_000);
    return () => clearInterval(t);
  }, [enVivo, fetchAuditLogs]);
  useEffect(() => { setCuantos(POR_PAGINA); }, [accion, periodo, rango, texto]);

  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const desde = periodo === 'hoy' ? hoySV() : periodo === 'semana' ? sumarDias(hoySV(), -6) : periodo === 'rango' ? rango.desde : '';
  const hasta = periodo === 'rango' ? rango.hasta : '';
  const visibles = useMemo(() => ordenarBitacora(filtrarBitacora(logs, { accion, desde, hasta }))
    .filter((l) => !texto.trim() || tokenMatch(texto.trim(), l.user_name, l.action, l.branch_name, l.device_name)), [logs, accion, desde, hasta, texto]);
  const elegido = abierto != null ? visibles.find((l, i) => (l.id ?? i) === abierto) : null;

  const exportar = async () => {
    setExportando(true);
    try {
      await compartirCsv({ headers: COLUMNAS_CSV_BITACORA, rows: filasCsvDeBitacora(visibles, hora12ConSegundos), nombre: `auditoria ${hoySV()}`, modulo: 'auditoria' });
    } catch (e) { fallo('No se pudo exportar', e?.message || ''); }
    finally { setExportando(false); }
  };

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
      <MenuDeFiltros grupos={grupos} extra={visibles.length ? { icono: 'square.and.arrow.up', etiqueta: 'Exportar', onPress: exportar } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={periodo} onCambiar={setPeriodo} opciones={[{ id: 'hoy', label: 'Hoy' }, { id: 'semana', label: '7 días' }, { id: 'rango', label: 'Fechas' }, { id: 'todo', label: 'Todo' }]} />
        {periodo === 'rango' ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Desde</Text>
                  <Fecha valor={rango.desde} onCambiar={(v) => setRango((r) => ({ ...r, desde: v }))} hasta={rango.hasta} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>Hasta</Text>
                  <Fecha valor={rango.hasta} onCambiar={(v) => setRango((r) => ({ ...r, hasta: v }))} desde={rango.desde} hasta={hoySV()} />
                </View>
              </View>
            </Vidrio>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, gap: 10 }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{`${visibles.length.toLocaleString('es-SV')} registro${visibles.length === 1 ? '' : 's'}${exportando ? ' · exportando…' : ''}`}</Text>
          <Text style={{ color: enVivo ? MARCA.rojo : colorSistema.texto2, fontSize: 13, fontWeight: enVivo ? '700' : '400' }}>En vivo</Text>
          <Switch value={enVivo} onValueChange={(v) => { Haptics.selectionAsync().catch(() => {}); setEnVivo(v); }} />
        </View>
        {cargando && !(logs || []).length ? <ActivityIndicator style={{ marginTop: 24 }} /> : (
          <>
            {visibles.slice(0, cuantos).map((l, i) => {
              const quien = porId.get(String(l.user_id));
              return (
                <Pressable key={l.id ?? i} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(l.id ?? i); }}
                  style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                  <Vidrio radio={16} interactivo>
                    <View style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Avatar empleado={quien ?? { name: l.user_name || 'Sistema' }} tamano={30} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{quien ? shortEmployeeName(quien) : (l.user_name || 'Sistema')}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fechaHora12(l.created_at)}</Text>
                        </View>
                        <Pildora texto={SEVERIDAD[l.severity] ?? 'Info'} color={colorDeVariante(varianteDeSeveridad(l.severity))} />
                      </View>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{l.action}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                        {[ROTULO_DE_ORIGEN[l.source] ?? l.source, l.branch_name, l.device_name].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Vidrio>
                </Pressable>
              );
            })}
            {visibles.length > cuantos ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande borde texto={`Ver ${Math.min(POR_PAGINA, visibles.length - cuantos)} más · quedan ${visibles.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} />
              </View>
            ) : null}
            {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin registros en este período</Text> : null}
          </>
        )}
      </ScrollView>
      {elegido ? <Ficha l={elegido} quien={porId.get(String(elegido.user_id))} onCerrar={() => setAbierto(null)} /> : null}
    </>
  );
}
