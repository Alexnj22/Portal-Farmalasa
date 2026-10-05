// Gestionar avisos, NATIVO — `AnnouncementsView`: los avisos internos activos,
// programados y archivados, con su destino, si son urgentes y cuánta gente ya
// los leyó; tocar uno muestra quién falta por leer y deja archivarlo. Y
// publicar uno nuevo desde el teléfono: título, mensaje, a quién (todos o una
// sala) y si es urgente.
//
// A quién le llega, la lectura y la sección salen del núcleo
// (`avisosInternos`), la misma regla del portal. Avisos a un cargo o a
// personas sueltas, y programarlos, se hacen en el portal.
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { avisoConLectura, seccionDeAviso } from '@nucleo/utils/avisosInternos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { ordenDeSala } from '@nucleo/constants/erp';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

function Nuevo({ abierto, onCerrar, salas, salaFija }) {
  const createAnnouncement = useStaffStore((s) => s.createAnnouncement);
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [destino, setDestino] = useState(salaFija ? String(salaFija) : 'GLOBAL');
  const [urgente, setUrgente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const listo_ = titulo.trim() && mensaje.trim();
  const publicar = async () => {
    setEnviando(true); trabajando('Publicando…');
    try {
      await createAnnouncement({
        title: titulo.trim(), message: mensaje.trim(), priority: urgente ? 'URGENT' : 'NORMAL',
        targetType: destino === 'GLOBAL' ? 'GLOBAL' : 'BRANCH', targetValue: destino === 'GLOBAL' ? null : destino,
      });
      listo('Aviso publicado', titulo.trim());
      setTitulo(''); setMensaje(''); setUrgente(false);
      onCerrar();
    } catch (e) { fallo('No se pudo publicar', e?.message || 'Vuelve a intentar.'); }
    setEnviando(false);
  };
  return (
    <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Nuevo aviso</Text>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text></Pressable>
            </View>
            <Seccion titulo="El aviso">
              <Campo multiline={false} value={titulo} onChangeText={setTitulo} placeholder="Título" />
              <Campo value={mensaje} onChangeText={setMensaje} placeholder="Mensaje" />
            </Seccion>
            <Seccion titulo="Para quién">
              <Opciones valor={destino} onCambiar={setDestino} opciones={[
                ...(salaFija ? [] : [{ id: 'GLOBAL', label: 'Todos' }]),
                ...salas.filter((b) => !salaFija || String(b.id) === String(salaFija)).map((b) => ({ id: String(b.id), label: b.name })),
              ]} />
            </Seccion>
            <Seccion titulo="Prioridad">
              <Segmentos activa={urgente ? 'u' : 'n'} onCambiar={(v) => setUrgente(v === 'u')} opciones={[{ id: 'n', label: 'Normal' }, { id: 'u', label: 'Urgente' }]} />
            </Seccion>
            <BotonGrande texto={enviando ? 'Publicando…' : 'Publicar'} color={urgente ? MARCA.rojo : MARCA.azul} deshabilitado={!listo_ || enviando} onPress={publicar} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

export default function GestionarAvisos() {
  const { user, hasPermission, getScope } = useAuth();
  const avisos = useStaffStore((s) => s.announcements);
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const archivar = useStaffStore((s) => s.archiveAnnouncement);
  const puedeEditar = hasPermission('announcements', 'can_edit');
  const deSala = getScope?.('announcements') === 'BRANCH';
  const [seccion, setSeccion] = useState('ACTIVE');
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [nuevo, setNuevo] = useState(false);

  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const procesados = useMemo(() => (avisos || []).map((a) => avisoConLectura(a, empleados, nombreDeSala))
    .filter((a) => !deSala || a.targetType === 'GLOBAL' || (a.targetType === 'BRANCH' && String(a.targetValue) === String(user?.branchId))), [avisos, empleados, nombreDeSala, deSala, user?.branchId]);
  const cuenta = (k) => procesados.filter((a) => seccionDeAviso(a) === k).length;
  const visibles = procesados.filter((a) => seccionDeAviso(a) === seccion && (!texto.trim() || tokenMatch(texto.trim(), a.title, a.message, a.badgeText)))
    .sort((a, b) => String(b.createdAt ?? b.created_at ?? '').localeCompare(String(a.createdAt ?? a.created_at ?? '')));

  const confirmarArchivar = async (a) => {
    trabajando('Archivando…');
    try { await archivar(a.id); listo('Archivado', a.title); setAbierto(null); } catch (e) { fallo('No se pudo archivar', e?.message || ''); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Gestionar avisos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Título, mensaje o destino', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {puedeEditar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Publicar un aviso" color={MARCA.azul} onPress={() => setNuevo(true)} /></View> : null}
        <Segmentos activa={seccion} onCambiar={(v) => { setSeccion(v); setAbierto(null); }} opciones={[
          { id: 'ACTIVE', label: cuenta('ACTIVE') ? `Activos · ${cuenta('ACTIVE')}` : 'Activos' },
          { id: 'SCHEDULED', label: cuenta('SCHEDULED') ? `Programados · ${cuenta('SCHEDULED')}` : 'Programados' },
          { id: 'ARCHIVED', label: 'Archivados' },
        ]} />
        {visibles.map((a) => {
          const urgente = a.priority === 'URGENT' && seccion !== 'SCHEDULED';
          const faltan = a.audience.filter((e) => !a.readSet.has(String(e.id)));
          const abiertoEste = abierto === a.id;
          return (
            <Pressable key={a.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(abiertoEste ? null : a.id); }} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} interactivo tinte={urgente && a.readPercentage < 100 ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pildora texto={a.badgeText} color={MARCA.azulClaro} />
                    {urgente ? <Pildora texto="Urgente" color={MARCA.rojo} /> : null}
                    {a.scheduledFor && seccion === 'SCHEDULED' ? <Pildora texto={`Sale ${fechaHora12(a.scheduledFor)}`} color={MARCA.violeta} /> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{a.title}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={abiertoEste ? undefined : 2}>{a.message}</Text>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${a.readPercentage}%`, height: 6, backgroundColor: a.readPercentage === 100 ? MARCA.verde : urgente ? MARCA.rojo : MARCA.azul }} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${a.readIds.length} de ${a.totalExpected} lo leyeron (${a.readPercentage}%)`}</Text>
                  {abiertoEste ? (
                    <View style={{ gap: 8, marginTop: 4 }}>
                      {faltan.length ? (
                        <>
                          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }}>{`Faltan por leer · ${faltan.length}`}</Text>
                          {faltan.slice(0, 25).map((e) => (
                            <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Avatar empleado={e} tamano={22} />
                              <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{shortEmployeeName(e)}</Text>
                            </View>
                          ))}
                        </>
                      ) : <Text style={{ color: MARCA.verde, fontSize: 14 }}>Todos lo leyeron.</Text>}
                      {puedeEditar && seccion !== 'ARCHIVED' ? <BotonGrande texto="Archivar" borde color={colorSistema.texto2} onPress={() => confirmarArchivar(a)} /> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin avisos en esta sección</Text> : null}
        {puedeEditar ? (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <BotonGrande texto="Programar o enviar a un cargo (portal)" borde color={colorSistema.texto2}
              onPress={() => router.push({ pathname: '/portal', params: { ruta: '/avisos', nombre: 'Gestionar avisos' } })} />
          </View>
        ) : null}
      </ScrollView>
      <Nuevo abierto={nuevo} onCerrar={() => setNuevo(false)} salas={salas} salaFija={deSala ? user?.branchId : null} />
    </>
  );
}
