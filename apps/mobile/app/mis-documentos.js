// Mis documentos, NATIVO — «Mis documentos» del portal
// (`EmployeeDocumentsView`): los papeles de mi expediente y los que viajan con
// mis solicitudes (incapacidades, constancias, permisos), en una sola lista.
// La lista, las pestañas y el filtro salen del núcleo (`misDocumentos`), los
// mismos del portal. Tocar uno lo abre con una URL firmada al momento
// (`openStoredFile`): los buckets son privados y una firmada guardada vence.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchOwnApprovalRequests } from '@nucleo/data/employeeSelfService';
import {
  documentosDelExpediente, ESTADO_DOC, filtrarDocumentos, pestanasDeDocumentos, ROTULO_CONSTANCIA, ROTULO_TIPO_DOC, solicitudesConDocumento,
} from '@nucleo/utils/misDocumentos';
import { grupoDeCategoria, nombreDelIconoDeCategoria } from '@nucleo/utils/documentosDelExpediente';
import { getExpiryBadge } from '@nucleo/utils/documentExpiry';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Pildora } from '../componentes/avisos/Piezas';
import { Chip } from '../componentes/inicio/Widget';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

// Un día de calendario (`issue_date`) se lee tal cual; un instante (`created_at`)
// en la hora de El Salvador — cortarlo a 10 caracteres daba el día UTC.
const fecha = (f) => (f ? fechaTexto(String(f).length > 10 ? f : String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const ICONO_TIPO = { DISABILITY: ['Stethoscope', MARCA.rojo], CERTIFICATE: ['FileCheck', MARCA.azulClaro], VACATION: ['Palmtree', MARCA.verde],
  PERMIT: ['FileText', MARCA.ambar], SHIFT_CHANGE: ['RefreshCw', MARCA.violeta], EXPEDIENTE: ['FolderOpen', MARCA.azul] };
const COLOR_ESTADO = { EN_EXPEDIENTE: MARCA.azul, APPROVED: MARCA.verde, PENDING: MARCA.ambar, REJECTED: MARCA.rojo, CANCELLED: colorSistema.texto2 };
const COLOR_VENCE = { danger: MARCA.rojo, warning: MARCA.ambar };

export default function MisDocumentos() {
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const [solicitudes, setSolicitudes] = useState(null);
  const [pestana, setPestana] = useState('ALL');
  const [texto, setTexto] = useState('');
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!user?.id) return;
    const filas = await fetchOwnApprovalRequests(user.id).catch(() => []);
    setSolicitudes(solicitudesConDocumento(filas || []));
  }, [user?.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const yo = (empleados || []).find((e) => String(e.id) === String(user?.id));
  const todos = useMemo(() => [...documentosDelExpediente(yo), ...(solicitudes || [])], [yo, solicitudes]);
  const pestanas = useMemo(() => pestanasDeDocumentos(todos), [todos]);
  const activa = pestanas.some((t) => t.key === pestana) ? pestana : 'ALL';
  const visibles = useMemo(() => filtrarDocumentos(todos, { pestana: activa, busqueda: texto }), [todos, activa, texto]);

  const abrir = async (d) => {
    if (!d.meta?.docUrl) return;
    Haptics.selectionAsync().catch(() => {});
    try { await openStoredFile(d.meta.docUrl); } catch (e) { fallo('No se pudo abrir el documento', e?.message ?? String(e)); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Mis documentos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Buscar un documento', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {pestanas.length > 2 ? (
          <Segmentos activa={activa} onCambiar={setPestana}
            opciones={pestanas.map((t) => ({ id: t.key, label: t.key === 'ALL' ? `Todos · ${t.cuenta}` : t.label.replace('Del expediente', 'Expediente') }))} />
        ) : null}
        {solicitudes == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((d) => {
          const exp = d.type === 'EXPEDIENTE';
          const [icono, color] = exp ? [nombreDelIconoDeCategoria(d.meta?.categoria), MARCA.azul] : (ICONO_TIPO[d.type] ?? ['FileText', colorSistema.texto2]);
          const titulo = exp ? (d.meta?.nombre || 'Documento') : d.type === 'CERTIFICATE'
            ? (ROTULO_CONSTANCIA[d.meta?.certificateType] ?? 'Constancia') : (ROTULO_TIPO_DOC[d.type] ?? 'Documento');
          const sub = exp ? (grupoDeCategoria(d.meta?.categoria) || 'Del expediente') : d.note;
          const vence = exp ? getExpiryBadge(d.meta?.expiryDate) : null;
          return (
            <Pressable key={d.id} onPress={() => abrir(d)} disabled={!d.meta?.docUrl}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo={!!d.meta?.docUrl}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                  <Chip icono={icono} color={color} tamano={40} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{titulo}</Text>
                    {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{sub}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      <Pildora texto={ESTADO_DOC[d.status] ?? d.status} color={COLOR_ESTADO[d.status] ?? colorSistema.texto2} />
                      {vence ? <Pildora texto={vence.label} color={COLOR_VENCE[vence.variant] ?? MARCA.ambar} /> : null}
                      {exp && d.meta?.versiones > 0 ? <Pildora texto={`${d.meta.versiones + 1} versiones`} color={colorSistema.texto2} /> : null}
                    </View>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{fecha(exp ? (d.meta?.issueDate || d.created_at) : d.created_at)}</Text>
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {solicitudes && !visibles.length ? (
          <View style={{ alignItems: 'center', paddingTop: 40, gap: 6, marginHorizontal: 24 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{texto ? 'Ningún documento con esa búsqueda' : 'Todavía no tienes documentos'}</Text>
            {!texto ? <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Aquí aparecen los papeles de tu expediente y los de tus solicitudes.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
