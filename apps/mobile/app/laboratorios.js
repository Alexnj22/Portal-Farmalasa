// Laboratorios, NATIVO — «¿dónde está este laboratorio en la sala?»
// (`LaboratoriosView` › Ubicaciones): cada laboratorio con su vitrina o
// estante y su peldaño en la sala, y su estante en la bodega. Tocar uno deja
// corregir la ubicación ahí mismo, de pie frente al mueble.
//
// La sala por defecto es la propia; quien ve todas elige en el menú de filtros.
// Leer y guardar salen del núcleo (`ubicacionLaboratorio`), igual que el
// portal. Arriba, las tarjetas del portal (laboratorios, con ubicación en la
// sala, salas cubiertas) y cada laboratorio dice en cuántas salas está
// ubicado. La segunda pestaña es la política de vencimiento
// (`componentes/fiscal/PoliticaVencimiento`), editable como en el portal.
//
// Al abrir un laboratorio, además de su ubicación, se ajusta cómo sale en la
// app de clientes, como en el portal (`TabLaboratorios` › fila abierta): la
// foto en la tienda (`subirFotoLaboratorio`, tomada o elegida con `Fotos`),
// el nombre en la app, «Sugerir primero» en «Mismo principio activo» y
// «Ocultar de la lista». Cada cambio se guarda en el acto con las funciones
// del núcleo, que dejan su huella en la bitácora.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import PoliticaVencimiento from '../componentes/fiscal/PoliticaVencimiento';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  fetchLaboratoriosBasic, fetchLabLocations, guardarFotoLaboratorio, guardarNombreAppLaboratorio, guardarOcultarLaboratorio,
  guardarSugerirLaboratorio, subirFotoLaboratorio, upsertLabLocation,
} from '@nucleo/data/laboratorios';
import {
  filaDeUbicacion, rotuloDeUbicacion, SECCIONES_DE_LABORATORIO, seccionDeLaboratorio, tieneUbicacion, ubicacionVacia,
} from '@nucleo/utils/ubicacionLaboratorio';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { ErrorConReintento, useColumnas } from '../componentes/ListaPaginada';
import ConAurora from '../componentes/ConAurora';
import EncabezadoDeHoja from '../componentes/EncabezadoDeHoja';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import Fotos from '../componentes/formulario/Fotos';
import Interruptor from '../componentes/Interruptor';

// Un ajuste con interruptor: el rótulo, lo que explica y el interruptor.
function Ajuste({ titulo, explica, valor, ocupado, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{titulo}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{explica}</Text>
      </View>
      <Interruptor value={valor} disabled={ocupado} onValueChange={onCambiar} />
    </View>
  );
}

// Cómo sale el laboratorio en la app de clientes: lo mismo que la fila
// abierta del portal (foto, nombre, sugerir, ocultar). Cada cambio se guarda
// solo y devuelve la fila cambiada con `onCambio`.
function EnLaApp({ lab, onCambio }) {
  const [nombre, setNombre] = useState(lab.nombre_app || '');
  const [ocupado, setOcupado] = useState(null);
  const contexto = { lab: lab.nombre, desde: 'app' };
  const correr = async (cual, fn, exito) => {
    setOcupado(cual);
    try { await fn(); if (exito) listo('Guardado', exito); } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setOcupado(null); }
  };
  const subir = (f) => correr('foto', async () => {
    trabajando('Guardando la foto…');
    const ref = await ImageManipulator.manipulate(f.uri).resize({ width: 800 }).renderAsync();
    const hecha = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    const datos = await (await fetch(hecha.uri)).arrayBuffer();
    onCambio({ foto: await subirFotoLaboratorio(lab.id, datos, contexto) });
  }, 'Foto del laboratorio actualizada.');
  const quitar = () => correr('foto', async () => {
    await guardarFotoLaboratorio(lab.id, null, contexto);
    onCambio({ foto: null });
  }, 'Foto quitada.');
  const guardarNombre = () => correr('nombre', async () => {
    const fila = await guardarNombreAppLaboratorio(lab.id, nombre, contexto);
    onCambio(fila);
    setNombre(fila?.nombre_app || '');
  }, 'Nombre en la app actualizado.');
  return (<>
    <Seccion titulo="Foto en la tienda" pie="La ven los clientes en la app.">
      {lab.foto ? (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Image source={{ uri: lab.foto }} resizeMode="contain" accessibilityLabel={`Foto de ${lab.nombre}`}
            style={{ width: 140, height: 140, borderRadius: 70, backgroundColor: '#fff' }} />
          <BotonGrande texto="Quitar foto" color={MARCA.rojo} borde deshabilitado={!!ocupado} onPress={quitar} />
        </View>
      ) : null}
      {ocupado === 'foto' ? <Cargando /> : <Fotos fotos={[]} max={1} onCambiar={(f) => { if (f[0]) subir(f[0]); }} />}
    </Seccion>
    <Seccion titulo="Nombre en la app"
      pie={`Los clientes lo ven como «${lab.nombre_tienda || lab.nombre}». Si le pones el mismo nombre que a otro laboratorio, en la app salen juntos.`}>
      <Campo multiline={false} value={nombre} onChangeText={setNombre} placeholder={lab.nombre_tienda || lab.nombre} />
      <BotonGrande texto={ocupado === 'nombre' ? 'Guardando…' : 'Guardar nombre'} borde
        deshabilitado={!!ocupado || nombre.trim() === (lab.nombre_app || '')} onPress={guardarNombre} />
    </Seccion>
    <Seccion titulo="En la app de clientes">
      <Ajuste titulo="Sugerir primero en la app" explica="Sus productos salen antes en «Mismo principio activo», ordenados por precio."
        valor={!!lab.sugerir_en_app} ocupado={!!ocupado}
        onCambiar={(v) => correr('sugerir', async () => { await guardarSugerirLaboratorio(lab.id, v, contexto); onCambio({ sugerir_en_app: v }); })} />
      <Ajuste titulo="Ocultar de la lista en la app" explica="No aparece como laboratorio. Sus productos siguen a la venta."
        valor={!!lab.ocultar_en_app} ocupado={!!ocupado}
        onCambiar={(v) => correr('ocultar', async () => { await guardarOcultarLaboratorio(lab.id, v, contexto); onCambio({ ocultar_en_app: v }); })} />
    </Seccion>
  </>);
}

function Editar({ lab, sala, nombreSala, inicial, onCerrar, onGuardado, onCambioEnApp }) {
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
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onCerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={lab.nombre} subtitulo={`Ubicación en ${nombreSala}`} onCerrar={onCerrar} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <Seccion titulo="En la sucursal">
              <Segmentos activa={tipo} onCambiar={setTipo} opciones={[{ id: 'estante', label: 'Estante' }, { id: 'vitrina', label: 'Vitrina' }]} />
              <Campo multiline={false} value={tipo === 'vitrina' ? d.vitrina : d.estante} onChangeText={campo(tipo)} placeholder={tipo === 'vitrina' ? 'Número de vitrina' : 'Número de estante'} autoCapitalize="characters" />
              <Campo multiline={false} value={d.peldano} onChangeText={campo('peldano')} placeholder="Peldaño" autoCapitalize="characters" />
            </Seccion>
            <Seccion titulo="En la bodega de la sucursal">
              <Campo multiline={false} value={d.bodega_numero} onChangeText={campo('bodega_numero')} placeholder="Estante" autoCapitalize="characters" />
              <Campo multiline={false} value={d.bodega_peldano} onChangeText={campo('bodega_peldano')} placeholder="Peldaño" autoCapitalize="characters" />
            </Seccion>
            <BotonGrande texto={enviando ? 'Guardando…' : 'Guardar ubicación'} color={MARCA.azul} deshabilitado={enviando} onPress={guardar} />
            <EnLaApp lab={lab} onCambio={onCambioEnApp} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

// ~300 laboratorios: lista virtualizada y tarjeta memoizada.
const TarjetaLab = memo(function TarjetaLab({ l, d, cubiertas, totalSalas, onAbrir, columnas }) {
  const r = rotuloDeUbicacion(d);
  return (
    <Pressable onPress={() => onAbrir(l)}
      style={({ pressed }) => ({ ...(columnas > 1 ? { flex: 1 / columnas } : { marginHorizontal: 16 }), marginTop: 10, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{l.nombre}</Text>
            {l.sugerir_en_app ? <Pildora texto="Sugerido en la app" color={MARCA.verde} /> : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${cubiertas} de ${totalSalas} sucursales`}</Text>
          </View>
          {tieneUbicacion(d) ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {r.sala ? <Pildora texto={r.sala} color={MARCA.azulClaro} /> : null}
              {r.bodega ? <Pildora texto={`Bodega · ${r.bodega}`} color={MARCA.ambar} /> : null}
            </View>
          ) : <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>Sin ubicación. Toca para agregar.</Text>}
        </View>
      </Vidrio>
    </Pressable>
  );
});

export default function Laboratorios() {
  const { user, getScope, hasPermission } = useAuth();
  const [pestana, setPestana] = useState('ubicaciones');
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
  const columnas = useColumnas();

  const cargar = useCallback(async () => {
    const [{ data: l, error: e1 }, { data: u, error: e2 }] = await Promise.all([fetchLaboratoriosBasic(), fetchLabLocations()]);
    setLabs(l || []);
    const m = {};
    for (const r of u || []) { (m[r.lab_id] ||= {})[r.branch_id] = r; }
    setUbic(m);
    setError(e1 || e2 ? mensajeAmigable(e1 || e2) : null);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreSala = (sucursales || []).find((b) => String(b.id) === sala)?.name ?? 'la sucursal';
  const q = texto.trim();
  const visibles = useMemo(() => (labs || []).filter((l) => (q ? true : seccionDeLaboratorio(l.nombre) === seccion))
    .filter((l) => {
      if (!q) return true;
      const r = rotuloDeUbicacion(ubic[l.id]?.[sala]);
      return tokenMatch(q, l.nombre, r.sala, r.bodega);
    }), [labs, ubic, sala, q, seccion]);
  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const conUbicacion = useMemo(() => (labs || []).filter((l) => tieneUbicacion(ubic[l.id]?.[sala])).length, [labs, ubic, sala]);
  const salasCubiertas = (labId) => Object.values(ubic[labId] || {}).filter(tieneUbicacion).length;
  const abrir = useCallback((l) => { Haptics.selectionAsync().catch(() => {}); setEditando(l); }, []);
  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sucursal', activa: sala, porDefecto: String(user?.branchId ?? (sucursales || [])[0]?.id ?? ''), onCambiar: setSala,
      opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : []),
    ...(!q ? [{ id: 'seccion', titulo: 'Sección', activa: seccion, porDefecto: 'principales', onCambiar: setSeccion,
      opciones: SECCIONES_DE_LABORATORIO.map((s) => ({ id: s.key, label: s.key === 'principales' ? 'Principales' : s.key === 'insumos' ? 'Insumos' : 'Cosméticos' })) }] : []),
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_FIJA, title: 'Laboratorios',
        headerSearchBarOptions: {
          placeholder: 'Laboratorio, vitrina o estante', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length && pestana === 'ubicaciones' ? <MenuDeFiltros grupos={grupos} /> : null}
      <FijoArriba><Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'ubicaciones', label: 'Ubicaciones' }, { id: 'vencimiento', label: 'Política de vencimiento' }]} /></FijoArriba>
      <FlatList key={`c${columnas}`} numColumns={columnas} columnWrapperStyle={columnas > 1 ? { gap: 10, paddingHorizontal: 16 } : undefined}
        data={pestana === 'ubicaciones' && labs ? visibles : []} keyExtractor={(l) => String(l.id)}
        renderItem={({ item: l }) => <TarjetaLab l={l} d={ubic[l.id]?.[sala]} cubiertas={salasCubiertas(l.id)} totalSalas={salas.length} onAbrir={abrir} columnas={columnas} />}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" initialNumToRender={12} windowSize={9}
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: 48 }}
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
        ListHeaderComponent={(
          <View style={{ gap: 10 }}>
            {pestana === 'vencimiento' ? <PoliticaVencimiento texto={texto} canEdit={hasPermission('laboratorios', 'can_edit')} /> : null}
            {pestana === 'ubicaciones' ? (<>
              {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
              {labs ? (
                <FilaDeKpis>
                  <Kpi icono="FlaskConical" rotulo="Laboratorios" valor={String(labs.length)} color={MARCA.azulClaro} apoyo={`${salas.length} sucursales`} />
                  <Kpi icono="Check" rotulo="Con ubicación" valor={String(conUbicacion)} color={conUbicacion === labs.length ? MARCA.verde : MARCA.ambar} apoyo={`en ${nombreSala}`} />
                </FilaDeKpis>
              ) : null}
              {error ? <ErrorConReintento mensaje={error} onReintentar={cargar} /> : null}
              {labs == null ? <Cargando /> : null}
            </>) : null}
          </View>
        )}
        ListEmptyComponent={pestana === 'ubicaciones' && labs ? (
          <Vacio>Ningún laboratorio con esa búsqueda</Vacio>
        ) : null} />
      {editando ? (
        <Editar lab={(labs || []).find((l) => l.id === editando.id) ?? editando} sala={sala} nombreSala={nombreSala}
          onCambioEnApp={(cambio) => setLabs((ls) => (ls || []).map((l) => (l.id === editando.id ? { ...l, ...cambio } : l)))}
          inicial={{ ...ubicacionVacia(), ...Object.fromEntries(Object.entries(ubic[editando.id]?.[sala] || {}).map(([k, v]) => [k, v ?? ''])) }}
          onCerrar={() => setEditando(null)}
          onGuardado={(labId, fila) => { setUbic((m) => ({ ...m, [labId]: { ...(m[labId] || {}), [fila.branch_id]: fila } })); setEditando(null); }} />
      ) : null}
    </>
  );
}
