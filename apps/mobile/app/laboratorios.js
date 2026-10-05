// Laboratorios, NATIVO — «¿dónde está este laboratorio en la sala?»
// (`LaboratoriosView` › Ubicaciones): cada laboratorio con su vitrina o
// estante y su peldaño en la sala, y su estante en la bodega. Tocar uno deja
// corregir la ubicación ahí mismo, de pie frente al mueble.
//
// La sala por defecto es la propia; quien ve todas elige en el menú de filtros.
// Leer y guardar salen del núcleo (`ubicacionLaboratorio`), igual que el
// portal. La política de vencimiento se edita en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchLaboratoriosBasic, fetchLabLocations, upsertLabLocation } from '@nucleo/data/laboratorios';
import {
  filaDeUbicacion, rotuloDeUbicacion, SECCIONES_DE_LABORATORIO, seccionDeLaboratorio, tieneUbicacion, ubicacionVacia,
} from '@nucleo/utils/ubicacionLaboratorio';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

function Editar({ lab, sala, nombreSala, inicial, onCerrar, onGuardado }) {
  const [d, setD] = useState(inicial);
  const [tipo, setTipo] = useState(inicial.vitrina?.trim() ? 'vitrina' : 'estante');
  const [enviando, setEnviando] = useState(false);
  const campo = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    setEnviando(true); trabajando('Guardando…');
    const campos = { ...d, vitrina: tipo === 'vitrina' ? d.vitrina : '', estante: tipo === 'estante' ? d.estante : '' };
    const fila = filaDeUbicacion(lab.id, Number(sala), campos);
    const { error } = await upsertLabLocation(fila, { lab: lab.nombre, desde: 'app' });
    setEnviando(false);
    if (error) { fallo('No se pudo guardar', mensajeAmigable(error)); return; }
    listo('Ubicación guardada', lab.nombre);
    onGuardado(lab.id, fila);
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{lab.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Ubicación en ${nombreSala}`}</Text>
              </View>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cancelar</Text>
              </Pressable>
            </View>
            <Seccion titulo="En la sala">
              <Segmentos activa={tipo} onCambiar={setTipo} opciones={[{ id: 'estante', label: 'Estante' }, { id: 'vitrina', label: 'Vitrina' }]} />
              <Campo multiline={false} value={tipo === 'vitrina' ? d.vitrina : d.estante} onChangeText={campo(tipo)} placeholder={tipo === 'vitrina' ? 'Número de vitrina' : 'Número de estante'} autoCapitalize="characters" />
              <Campo multiline={false} value={d.peldano} onChangeText={campo('peldano')} placeholder="Peldaño" autoCapitalize="characters" />
            </Seccion>
            <Seccion titulo="En la bodega de la sala">
              <Campo multiline={false} value={d.bodega_numero} onChangeText={campo('bodega_numero')} placeholder="Estante" autoCapitalize="characters" />
              <Campo multiline={false} value={d.bodega_peldano} onChangeText={campo('bodega_peldano')} placeholder="Peldaño" autoCapitalize="characters" />
            </Seccion>
            <BotonGrande texto={enviando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} deshabilitado={enviando} onPress={guardar} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

export default function Laboratorios() {
  const { user, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const todas = getScope?.('laboratorios') === 'ALL' || getScope?.('productos') === 'ALL';
  const [salaElegida, setSala] = useState(null);
  const sala = String(salaElegida ?? user?.branchId ?? (sucursales || [])[0]?.id ?? '');
  const [labs, setLabs] = useState(null);
  const [ubic, setUbic] = useState({});
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [seccion, setSeccion] = useState('principales');
  const [editando, setEditando] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: l, error: e1 }, { data: u, error: e2 }] = await Promise.all([fetchLaboratoriosBasic(), fetchLabLocations()]);
    setLabs(l || []);
    const m = {};
    for (const r of u || []) { (m[r.lab_id] ||= {})[r.branch_id] = r; }
    setUbic(m);
    setError(e1 || e2 ? mensajeAmigable(e1 || e2) : null);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreSala = (sucursales || []).find((b) => String(b.id) === sala)?.name ?? 'la sala';
  const q = texto.trim();
  const visibles = useMemo(() => (labs || []).filter((l) => (q ? true : seccionDeLaboratorio(l.nombre) === seccion))
    .filter((l) => {
      if (!q) return true;
      const r = rotuloDeUbicacion(ubic[l.id]?.[sala]);
      return tokenMatch(q, l.nombre, r.sala, r.bodega);
    }), [labs, ubic, sala, q, seccion]);
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: String(user?.branchId ?? ''), onCambiar: setSala,
    opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Laboratorios', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Laboratorio, vitrina o estante', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`Ubicaciones en ${nombreSala}`}</Text>
        {!q ? <Segmentos activa={seccion} onCambiar={setSeccion} opciones={SECCIONES_DE_LABORATORIO.map((s) => ({ id: s.key, label: s.key === 'principales' ? 'Principales' : s.key === 'insumos' ? 'Insumos' : 'Cosméticos' }))} /> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {labs == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((l) => {
          const d = ubic[l.id]?.[sala];
          const r = rotuloDeUbicacion(d);
          return (
            <Pressable key={l.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setEditando(l); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={18} interactivo>
                <View style={{ padding: 12, gap: 6 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{l.nombre}</Text>
                  {tieneUbicacion(d) ? (
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {r.sala ? <Pildora texto={r.sala} color={MARCA.azulClaro} /> : null}
                      {r.bodega ? <Pildora texto={`Bodega · ${r.bodega}`} color={MARCA.ambar} /> : null}
                    </View>
                  ) : <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>Sin ubicación — tocar para agregar</Text>}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {labs && !visibles.length ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Ningún laboratorio con esa búsqueda</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Política de vencimiento (portal)" borde color={colorSistema.texto2}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/laboratorios?tab=vencimiento', nombre: 'Laboratorios' } })} />
        </View>
      </ScrollView>
      {editando ? (
        <Editar lab={editando} sala={sala} nombreSala={nombreSala}
          inicial={{ ...ubicacionVacia(), ...Object.fromEntries(Object.entries(ubic[editando.id]?.[sala] || {}).map(([k, v]) => [k, v ?? ''])) }}
          onCerrar={() => setEditando(null)}
          onGuardado={(labId, fila) => { setUbic((m) => ({ ...m, [labId]: { ...(m[labId] || {}), [fila.branch_id]: fila } })); setEditando(null); }} />
      ) : null}
    </>
  );
}
