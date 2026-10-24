// Reclamos de clientes, NATIVO — `ReclamosClientesView` (2026-10-24). Los
// reclamos sobre Puntos Salud, las reservas o la condición de Cliente Mayorista
// se registran en la sala donde se presentan, y los tres reglamentos dan diez
// días hábiles para responderlos.
//
// Por responder / respondidos; tocar uno lo abre con su tema y quién lo
// recibió, y quien aprueba el módulo escribe la respuesta y por dónde se le
// dio. «Registrar reclamo» arma el alta: la base compara la sala contra la de
// quien llama (`reclamo_registrar`), así que una sala sólo registra en la suya.
// Todo sale del núcleo (`data/reclamos`), lo mismo del portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import {
  PROGRAMAS, ROTULO_PROGRAMA, VIAS, ROTULO_VIA, plazoDeReclamo, respondidoATiempo,
  fetchReclamos, registrarReclamo, responderReclamo,
} from '@nucleo/data/reclamos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import Tocable from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const dia = (v) => (v ? fechaTexto(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const OP_PROGRAMAS = PROGRAMAS.map((p) => ({ id: p.value, label: p.label }));
const OP_VIAS = VIAS.map((v) => ({ id: v.value, label: v.label }));

function plazoTexto(r) {
  if (r.respondido_at) {
    const a = respondidoATiempo(r);
    return { texto: a ? 'A tiempo' : 'Fuera de plazo', color: a ? MARCA.verde : MARCA.ambar };
  }
  const p = plazoDeReclamo(r);
  return { texto: p.vencido ? `Vencido hace ${Math.abs(p.restan)} d.h.` : `${p.restan} d. hábiles`,
    color: p.vencido ? MARCA.rojo : p.apremia ? MARCA.ambar : colorSistema.texto2 };
}

export default function ReclamosClientes() {
  const { user, hasPermission, getScope } = useAuth();
  const puedeRegistrar = hasPermission('reclamos_clientes', 'can_edit');
  const puedeResponder = hasPermission('reclamos_clientes', 'can_approve');
  const deTodaLaRed = getScope('reclamos_clientes') === 'ALL';
  const branches = useStaffStore((s) => s.branches);
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('abiertos');
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [alta, setAlta] = useState(false);
  // Alta
  const [programa, setPrograma] = useState('puntos');
  const [sala, setSala] = useState(user?.branchId ?? null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tema, setTema] = useState('');
  // Respuesta
  const [respuesta, setRespuesta] = useState('');
  const [via, setVia] = useState('SALA');

  const cargar = useCallback(async () => {
    try { setFilas(await fetchReclamos()); setError(null); } catch (e) { setError(mensajeAmigable(e)); setFilas([]); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const visibles = useMemo(() => (filas ?? []).filter((r) => {
    if (pestana === 'abiertos' ? r.respondido_at : !r.respondido_at) return false;
    const q = texto.trim();
    return !q || tokenMatch(q, String(r.folio), r.cliente_nombre, r.cliente_telefono, r.tema, r.sala?.name);
  }), [filas, pestana, texto]);
  const vencidos = (filas ?? []).filter((r) => plazoDeReclamo(r)?.vencido).length;
  const opcionesSala = useMemo(() => (branches ?? []).map((b) => ({ id: b.id, label: b.name })), [branches]);

  const registrar = async () => {
    trabajando('Registrando el reclamo');
    try {
      const fila = await registrarReclamo({ programa, branchId: sala, tema, nombre, telefono: telefono || null });
      listo('Reclamo registrado', `Hay que responder a más tardar el ${dia(fila.vence)}.`);
      setAlta(false); setNombre(''); setTelefono(''); setTema('');
      await cargar();
    } catch (e) { fallo('No se pudo registrar', mensajeAmigable(e)); }
  };

  const responder = async (r) => {
    trabajando('Guardando la respuesta');
    try {
      await responderReclamo(r.id, respuesta, via);
      listo('Respuesta guardada');
      setRespuesta(''); setAbierto(null);
      await cargar();
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
  };

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Reclamos de clientes', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Cliente, número o tema', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
          <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'abiertos', label: 'Por responder' }, { id: 'respondidos', label: 'Respondidos' }]} />
          {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
          {vencidos ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`${vencidos === 1 ? 'Un reclamo pasó' : `${vencidos} reclamos pasaron`} de los diez días hábiles sin respuesta.`} /></View> : null}

          {puedeRegistrar && alta ? (
            <Seccion titulo="Registrar reclamo" pie="Los tres reglamentos dan diez días hábiles para responder.">
              <Opciones opciones={OP_PROGRAMAS} valor={programa} onCambiar={setPrograma} />
              {deTodaLaRed ? <Opciones opciones={opcionesSala} valor={sala} onCambiar={setSala} /> : null}
              <Campo multiline={false} placeholder="Nombre de quien reclama" value={nombre} onChangeText={setNombre} />
              <Campo multiline={false} placeholder="Teléfono" keyboardType="phone-pad" value={telefono} onChangeText={setTelefono} />
              <Campo placeholder="De qué se trata" value={tema} onChangeText={setTema} style={{ minHeight: 90 }} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" borde onPress={() => setAlta(false)} /></View>
                <View style={{ flex: 1 }}><BotonGrande texto="Registrar" deshabilitado={!sala || !nombre.trim() || !tema.trim()} onPress={registrar} /></View>
              </View>
            </Seccion>
          ) : null}

          {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((r) => {
            const p = plazoTexto(r);
            const esta = abierto === r.id;
            return (
              <Tocable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(esta ? null : r.id); setRespuesta(''); }} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={18} interactivo tinte={!r.respondido_at && plazoDeReclamo(r)?.vencido ? 'rgba(240,68,56,0.12)' : undefined}>
                  <View style={{ padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.folio}</Text>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{r.cliente_nombre}</Text>
                      <Pildora texto={p.texto} color={p.color} />
                    </View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }} numberOfLines={esta ? undefined : 2}>{r.tema}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      <Pildora texto={ROTULO_PROGRAMA[r.programa]} color={MARCA.violeta} />
                      {r.sala?.name ? <Pildora texto={r.sala.name} color={MARCA.azulClaro} /> : null}
                    </View>
                    {esta ? (
                      <View style={{ marginTop: 4, gap: 8 }}>
                        <Dato rotulo="Recibido" valor={`${dia(r.recibido_at)}${r.recibio ? ` · ${shortEmployeeName(r.recibio)}` : ''}`} primero />
                        <Dato rotulo="Vence" valor={dia(r.vence)} />
                        {r.cliente_telefono ? <Dato rotulo="Teléfono" valor={r.cliente_telefono} /> : null}
                        {r.respondido_at ? (
                          <>
                            <Dato rotulo="Respondido" valor={`${dia(r.respondido_at)} · ${ROTULO_VIA[r.respuesta_via] ?? ''}${r.respondio ? ` · ${shortEmployeeName(r.respondio)}` : ''}`} />
                            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{r.respuesta}</Text>
                          </>
                        ) : puedeResponder ? (
                          <>
                            <Campo placeholder="Respuesta que se le dio" value={respuesta} onChangeText={setRespuesta} style={{ minHeight: 90 }} />
                            <Opciones opciones={OP_VIAS} valor={via} onCambiar={setVia} />
                            <BotonGrande texto="Guardar la respuesta" deshabilitado={!respuesta.trim()} onPress={() => responder(r)} />
                          </>
                        ) : <Aviso texto={`Lo responde administración a más tardar el ${dia(r.vence)}.`} />}
                      </View>
                    ) : null}
                  </View>
                </Vidrio>
              </Tocable>
            );
          })}
          {filas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{texto.trim() ? 'Sin coincidencias' : pestana === 'abiertos' ? 'No hay reclamos por responder' : 'Sin reclamos respondidos'}</Text> : null}
          {puedeRegistrar && !alta ? (
            <View style={{ marginHorizontal: 16, marginTop: 8 }}>
              <BotonGrande texto="Registrar reclamo" onPress={() => { setSala(user?.branchId ?? null); setAlta(true); }} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
