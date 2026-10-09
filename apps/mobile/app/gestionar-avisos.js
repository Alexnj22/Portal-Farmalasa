// Gestionar avisos, NATIVO — `AnnouncementsView`: los avisos internos activos,
// programados y archivados, con su destino, la fecha en que se publicaron, si
// son urgentes y cuánta gente ya los leyó. Tocar uno abre su ficha en una hoja:
// quién lo CONFIRMÓ (con su cargo y la hora) y quién falta, como el reporte de
// lectores del portal; desde ahí se archiva o —si nadie lo ha leído— se elimina,
// las dos con confirmación (la misma regla del portal: un aviso que alguien ya
// leyó no se borra, se archiva).
//
// Publicar uno nuevo desde el teléfono, con los mismos destinos del portal:
// todos, una sala, un CARGO o PERSONAS sueltas; y programarlo para un día
// (desde mañana, como el portal). Y corregir uno que NADIE ha leído todavía
// (`updateAnnouncement`, con `editedAt`): uno ya leído se archiva, igual que en
// el portal. A quién le llega, la lectura y la sección
// salen del núcleo (`avisosInternos`).
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { audienciaDeAviso, avisoConLectura, seccionDeAviso } from '@nucleo/utils/avisosInternos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { Pildora } from '../componentes/avisos/Piezas';
import { MenuDeFiltros } from '../componentes/Filtros';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const manana = () => {
  const d = new Date(`${hoySV()}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Cabecera({ titulo, onCerrar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{titulo}</Text>
      <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text></Pressable>
    </View>
  );
}

// `editando`: el aviso que se corrige (sólo si nadie lo leyó, la misma regla
// del portal); sin él, es uno nuevo. Se monta de nuevo por aviso (`key`), así
// el estado inicial sale de él.
function Nuevo({ abierto, onCerrar, salas, salaFija, cargos, empleados, editando = null }) {
  const createAnnouncement = useStaffStore((s) => s.createAnnouncement);
  const updateAnnouncement = useStaffStore((s) => s.updateAnnouncement);
  const e0 = editando;
  const programadoAntes = e0?.scheduledFor && new Date(e0.scheduledFor) > new Date();
  const [titulo, setTitulo] = useState(e0?.title ?? '');
  const [mensaje, setMensaje] = useState(e0?.message ?? '');
  const [tipo, setTipo] = useState(e0?.targetType ?? (salaFija ? 'BRANCH' : 'GLOBAL'));
  const [sala, setSala] = useState(e0?.targetType === 'BRANCH' ? String(e0.targetValue) : salaFija ? String(salaFija) : '');
  const [cargo, setCargo] = useState(e0?.targetType === 'ROLE' ? String(e0.targetValue) : '');
  const [personas, setPersonas] = useState(new Set(e0?.targetType === 'EMPLOYEE' ? (e0.targetValue || []).map(String) : []));
  const [buscaPersona, setBuscaPersona] = useState('');
  const [urgente, setUrgente] = useState(e0?.priority === 'URGENT');
  const [programar, setProgramar] = useState(!!programadoAntes);
  const [dia, setDia] = useState(programadoAntes ? String(e0.scheduledFor).slice(0, 10) : manana());
  const [enviando, setEnviando] = useState(false);

  const destinoListo = tipo === 'GLOBAL' || (tipo === 'BRANCH' && sala) || (tipo === 'ROLE' && cargo) || (tipo === 'EMPLOYEE' && personas.size);
  const valido = titulo.trim() && mensaje.trim() && destinoListo && (!programar || dia > hoySV());
  const audiencia = audienciaDeAviso(empleados, tipo, tipo === 'BRANCH' ? sala : tipo === 'ROLE' ? cargo : [...personas]);
  const candidatos = (empleados || []).filter((e) => !buscaPersona.trim() || tokenMatch(buscaPersona.trim(), e.name, e.role)).slice(0, 40);

  const publicar = async () => {
    setEnviando(true); trabajando(e0 ? 'Guardando…' : 'Publicando…');
    try {
      const [y, m, d] = dia.split('-');
      const datos = {
        title: titulo.trim(), message: mensaje.trim(), priority: urgente ? 'URGENT' : 'NORMAL',
        targetType: salaFija ? 'BRANCH' : tipo,
        targetValue: salaFija ? String(salaFija) : tipo === 'GLOBAL' ? null : tipo === 'BRANCH' ? sala : tipo === 'ROLE' ? cargo : [...personas].map(String),
        // Como el portal: programado = a medianoche del día elegido.
        scheduledFor: programar ? new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).toISOString() : null,
      };
      if (e0) {
        await updateAnnouncement(e0.id, { ...datos, editedAt: new Date().toISOString() }, {});
        listo('Aviso actualizado', titulo.trim());
      } else {
        await createAnnouncement(datos);
        listo(programar ? 'Aviso programado' : 'Aviso publicado', titulo.trim());
        setTitulo(''); setMensaje(''); setUrgente(false); setPersonas(new Set()); setProgramar(false);
      }
      onCerrar();
    } catch (e) { fallo(e0 ? 'No se pudo guardar' : 'No se pudo publicar', e?.message || 'Vuelve a intentar.'); }
    setEnviando(false);
  };
  const alternarPersona = (id) => setPersonas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal visible={abierto} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <Cabecera titulo={e0 ? 'Editar aviso' : 'Nuevo aviso'} onCerrar={onCerrar} />
            <Seccion titulo="El aviso">
              <Campo multiline={false} value={titulo} onChangeText={setTitulo} placeholder="Título" />
              <Campo value={mensaje} onChangeText={setMensaje} placeholder="Mensaje" style={{ minHeight: 100 }} />
            </Seccion>
            {salaFija ? null : (
              <Seccion titulo="Para quién" pie={`Le llega a ${audiencia.length} persona${audiencia.length === 1 ? '' : 's'}.`}>
                <Segmentos activa={tipo} onCambiar={setTipo} opciones={[
                  { id: 'GLOBAL', label: 'Todos' }, { id: 'BRANCH', label: 'Sala' }, { id: 'ROLE', label: 'Cargo' }, { id: 'EMPLOYEE', label: 'Personas' },
                ]} />
                {tipo === 'BRANCH' ? <Opciones valor={sala} onCambiar={setSala} opciones={salas.map((b) => ({ id: String(b.id), label: b.name }))} /> : null}
                {tipo === 'ROLE' ? <Opciones valor={cargo} onCambiar={setCargo} opciones={cargos.map((r) => ({ id: r.name, label: r.name }))} /> : null}
                {tipo === 'EMPLOYEE' ? (
                  <>
                    <Campo multiline={false} value={buscaPersona} onChangeText={setBuscaPersona} placeholder="Buscar persona" />
                    {personas.size ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>{`${personas.size} elegida${personas.size === 1 ? '' : 's'}`}</Text> : null}
                    {candidatos.map((e, i) => (
                      <Pressable key={e.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); alternarPersona(String(e.id)); }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <Avatar empleado={e} tamano={28} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{shortEmployeeName(e)}</Text>
                          {e.role ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{e.role}</Text> : null}
                        </View>
                        {personas.has(String(e.id)) ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
                      </Pressable>
                    ))}
                  </>
                ) : null}
              </Seccion>
            )}
            <Seccion titulo="Prioridad">
              <Segmentos activa={urgente ? 'u' : 'n'} onCambiar={(v) => setUrgente(v === 'u')} opciones={[{ id: 'n', label: 'Normal' }, { id: 'u', label: 'Urgente' }]} />
            </Seccion>
            <Seccion titulo="Cuándo">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Programar para otro día</Text>
                <Switch value={programar} onValueChange={setProgramar} />
              </View>
              {programar ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Sale el</Text>
                  <Fecha valor={dia} onCambiar={setDia} desde={manana()} />
                </View>
              ) : null}
              {programar && dia <= hoySV() ? <Aviso tono="cuidado" texto="Programado tiene que ser desde mañana. Para hoy, publícalo de una vez." /> : null}
            </Seccion>
            <BotonGrande texto={enviando ? (e0 ? 'Guardando…' : 'Publicando…') : e0 ? 'Guardar cambios' : programar ? 'Programar' : 'Publicar'} color={urgente ? MARCA.rojo : MARCA.azul} deshabilitado={!valido || enviando} onPress={publicar} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

function Persona({ e, detalle, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 8 }}>
      <Avatar empleado={e} tamano={30} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[e.role, detalle].filter(Boolean).join(' · ') || '—'}</Text>
      </View>
    </View>
  );
}

function Ficha({ a, onCerrar, puedeEditar, onArchivar, onEliminar, onEditar }) {
  const [verPendientes, setVerPendientes] = useState(false);
  if (!a) return null;
  const leidoEl = new Map((a.readBy || []).filter((r) => typeof r === 'object').map((r) => [String(r.employeeId), r.readAt || r.read_at]));
  const confirmados = a.audience.filter((e) => a.readSet.has(String(e.id)));
  const pendientes = a.audience.filter((e) => !a.readSet.has(String(e.id)));
  const fecha = a.createdAt || a.created_at || a.date;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
          <Cabecera titulo="Aviso" onCerrar={onCerrar} />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pildora texto={a.badgeText} color={MARCA.azulClaro} />
            {a.priority === 'URGENT' ? <Pildora texto="Urgente" color={MARCA.rojo} /> : null}
            {a.isArchived ? <Pildora texto="Archivado" color={colorSistema.texto2} /> : null}
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{a.title}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 16, lineHeight: 22 }}>{a.message}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[fecha ? `Publicado ${fechaHora12(fecha)}` : null, a.scheduledFor ? `Programado para ${fechaTexto(String(a.scheduledFor).slice(0, 10), { day: 'numeric', month: 'long' })}` : null].filter(Boolean).join(' · ')}
          </Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
            <View style={{ width: `${a.readPercentage}%`, height: 8, backgroundColor: a.readPercentage === 100 ? MARCA.verde : MARCA.azul }} />
          </View>
          <Seccion titulo={`Confirmados · ${confirmados.length}`}>
            {confirmados.length ? confirmados.map((e, i) => (
              <Persona key={e.id} e={e} primero={i === 0} detalle={leidoEl.get(String(e.id)) ? `leyó ${fechaHora12(leidoEl.get(String(e.id)))}` : null} />
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie lo ha leído todavía.</Text>}
          </Seccion>
          <Seccion titulo={`Pendientes · ${pendientes.length}`}>
            {!pendientes.length ? <Text style={{ color: MARCA.verde, fontSize: 14 }}>Todos lo leyeron.</Text>
              : (verPendientes ? pendientes : pendientes.slice(0, 12)).map((e, i) => <Persona key={e.id} e={e} primero={i === 0} />)}
            {pendientes.length > 12 && !verPendientes ? (
              <Pressable onPress={() => setVerPendientes(true)}><Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Ver los ${pendientes.length}`}</Text></Pressable>
            ) : null}
          </Seccion>
          {puedeEditar && !a.isArchived && !a.readIds.length ? <BotonGrande texto="Editar" color={MARCA.azul} onPress={() => onEditar(a)} /> : null}
          {puedeEditar && !a.isArchived ? <BotonGrande texto="Archivar" borde color={colorSistema.texto2} onPress={() => onArchivar(a)} /> : null}
          {puedeEditar && !a.readIds.length ? <BotonGrande texto="Eliminar" borde color={MARCA.rojo} onPress={() => onEliminar(a)} /> : null}
          {puedeEditar && a.readIds.length ? <Aviso texto="Alguien ya lo leyó: no se edita ni se elimina. Se archiva y se publica uno nuevo." /> : null}
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}

export default function GestionarAvisos() {
  const { user, hasPermission, getScope } = useAuth();
  const avisos = useStaffStore((s) => s.announcements);
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const roles = useStaffStore((s) => s.roles);
  const archivar = useStaffStore((s) => s.archiveAnnouncement);
  const eliminar = useStaffStore((s) => s.deleteAnnouncement);
  const puedeEditar = hasPermission('announcements', 'can_edit');
  const deSala = getScope?.('announcements') === 'BRANCH';
  const [seccion, setSeccion] = useState('ACTIVE');
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState(null);
  const nombreDeSala = useMemo(() => new Map((sucursales || []).map((b) => [String(b.id), b.name])), [sucursales]);
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const cargos = useMemo(() => [...(roles || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')), [roles]);
  const procesados = useMemo(() => (avisos || []).map((a) => avisoConLectura(a, empleados, nombreDeSala))
    .filter((a) => !deSala || a.targetType === 'GLOBAL' || (a.targetType === 'BRANCH' && String(a.targetValue) === String(user?.branchId))), [avisos, empleados, nombreDeSala, deSala, user?.branchId]);
  const cuenta = (k) => procesados.filter((a) => seccionDeAviso(a) === k).length;
  const visibles = procesados.filter((a) => seccionDeAviso(a) === seccion && (!texto.trim() || tokenMatch(texto.trim(), a.title, a.message, a.badgeText)))
    .sort((a, b) => String(b.createdAt ?? b.created_at ?? '').localeCompare(String(a.createdAt ?? a.created_at ?? '')));
  const elegido = abierto ? procesados.find((a) => a.id === abierto) : null;

  const confirmarArchivar = (a) => Alert.alert('¿Archivar aviso?', `«${a.title}» deja de verse en la bandeja de todos.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Archivar', onPress: async () => {
      trabajando('Archivando…');
      try { await archivar(a.id); listo('Archivado', a.title); setAbierto(null); } catch (e) { fallo('No se pudo archivar', e?.message || ''); }
    } },
  ]);
  const confirmarEliminar = (a) => Alert.alert('¿Eliminar aviso?', `«${a.title}» se borra para siempre. Nadie lo ha leído todavía.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      trabajando('Eliminando…');
      try { await eliminar(a.id); listo('Eliminado', a.title); setAbierto(null); } catch (e) { fallo('No se pudo eliminar', e?.message || ''); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Gestionar avisos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Título, mensaje o destino', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={[]} extra={puedeEditar ? { icono: 'plus', etiqueta: 'Publicar un aviso', onPress: () => setNuevo(true) } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        <Segmentos activa={seccion} onCambiar={setSeccion} opciones={[
          { id: 'ACTIVE', label: cuenta('ACTIVE') ? `Activos · ${cuenta('ACTIVE')}` : 'Activos' },
          { id: 'SCHEDULED', label: cuenta('SCHEDULED') ? `Programados · ${cuenta('SCHEDULED')}` : 'Programados' },
          { id: 'ARCHIVED', label: 'Archivados' },
        ]} />
        {visibles.map((a) => {
          const urgente = a.priority === 'URGENT' && seccion !== 'SCHEDULED';
          const fecha = a.createdAt || a.created_at || a.date;
          return (
            <Pressable key={a.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(a.id); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo tinte={urgente && a.readPercentage < 100 ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pildora texto={a.badgeText} color={MARCA.azulClaro} />
                    {urgente ? <Pildora texto="Urgente" color={MARCA.rojo} /> : null}
                    {a.scheduledFor && seccion === 'SCHEDULED' ? <Pildora texto={`Sale ${fechaTexto(String(a.scheduledFor).slice(0, 10), { day: 'numeric', month: 'short' })}`} color={MARCA.violetaClaro} /> : null}
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{a.title}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={3}>{a.message}</Text>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
                    <View style={{ width: `${a.readPercentage}%`, height: 6, backgroundColor: a.readPercentage === 100 ? MARCA.verde : urgente ? MARCA.rojo : MARCA.azul }} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {[`${a.readIds.length} de ${a.totalExpected} lo leyeron (${a.readPercentage}%)`, fecha ? fechaHora12(fecha) : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin avisos en esta sección</Text> : null}
      </ScrollView>
      <Nuevo abierto={nuevo} onCerrar={() => setNuevo(false)} salas={salas} salaFija={deSala ? user?.branchId : null} cargos={cargos} empleados={empleados} />
      {editando ? <Nuevo key={editando.id} abierto editando={editando} onCerrar={() => setEditando(null)} salas={salas} salaFija={deSala ? user?.branchId : null} cargos={cargos} empleados={empleados} /> : null}
      {elegido && !editando ? <Ficha a={elegido} onCerrar={() => setAbierto(null)} puedeEditar={puedeEditar} onArchivar={confirmarArchivar} onEliminar={confirmarEliminar}
        onEditar={(a) => { setAbierto(null); setEditando(a); }} /> : null}
    </>
  );
}
