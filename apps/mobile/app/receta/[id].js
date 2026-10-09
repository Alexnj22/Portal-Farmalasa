// Completar un renglón del libro bajo receta, NATIVO — el «Completar» de
// Recetas pendientes del portal (`CompletarRenglon.jsx`), con las mismas reglas
// del núcleo (`data/bitacoras`):
//
//   · el PACIENTE: se propone el cliente de la factura sólo si es una persona
//     (`CLASE_CLIENTE[...].sirve`); un genérico o una empresa no es paciente;
//   · el MÉDICO no se escribe a mano: se busca por N.º de junta o por nombre,
//     primero en el portal y después en el registro del Consejo
//     (`consultarConsejo`); el del Consejo se guarda verificado al terminar;
//   · cuánto RECETÓ (no puede ser menos de lo que se entregó) y la fecha;
//   · la FOTO de la receta va al bucket privado `recetas`; sin ella se puede
//     guardar, pero el renglón sigue pidiéndola.
//
// La firma la pone el servidor (`completar_dispensacion` guarda quién y
// cuándo); rechaza un renglón anulado o de un mes cerrado.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import {
  BUCKET_RECETAS, CLASE_CLIENTE, JUNTAS_QUE_PRESCRIBEN, buscarMedicoLocal, buscarMedicosLocalPorNombre,
  completarRenglon, consultarConsejo, fetchLibro, guardarMedicoDelConsejo,
} from '@nucleo/data/bitacoras';
import { subirArchivo } from '@nucleo/utils/storageFiles';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { loadDraft, saveDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Fotos from '../../componentes/formulario/Fotos';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const num = (t) => (String(t).trim() === '' ? null : Number(String(t).replace(',', '.')));

export default function CompletarReceta() {
  const { id, sala, fecha } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puede = hasPermission('bitacoras', 'can_edit');
  const [renglon, setRenglon] = useState(undefined);
  const clave = `bitacora-renglon-${id}`;

  const [paciente, setPaciente] = useState('');
  const [edad, setEdad] = useState('');
  const [documento, setDocumento] = useState('');
  const [junta, setJunta] = useState('P01');
  const [modo, setModo] = useState('numero');
  const [numero, setNumero] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [medico, setMedico] = useState(null);
  const [candidatos, setCandidatos] = useState([]);
  const [avisoBusqueda, setAvisoBusqueda] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [prescrita, setPrescrita] = useState('');
  const [fechaReceta, setFechaReceta] = useState('');
  const [notas, setNotas] = useState('');
  const [fotos, setFotos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const f = String(fecha || hoySV()).slice(0, 10);
    fetchLibro(sala, { desde: f, hasta: f, estado: 'pendiente' }).then((r) => {
      if (!vivo) return;
      const fila = (r.renglones || []).find((x) => String(x.id) === String(id)) ?? null;
      setRenglon(fila);
      if (!fila) return;
      const borrador = loadDraft(clave);
      const sirve = CLASE_CLIENTE[fila.clase_cliente]?.sirve;
      setPaciente(borrador?.paciente ?? (sirve ? fila.cliente || '' : ''));
      setEdad(borrador?.edad ?? ''); setDocumento(borrador?.documento ?? '');
      setPrescrita(borrador?.prescrita ?? String(fila.cantidad ?? ''));
      setFechaReceta(borrador?.fechaReceta ?? String(fila.fecha).slice(0, 10));
      setNotas(borrador?.notas ?? '');
      if (borrador?.medico) setMedico(borrador.medico);
    });
    return () => { vivo = false; };
  }, [id, sala, fecha, clave]);

  // El formulario es largo y la sesión se cierra sola: se guarda borrador
  // (sin la foto, como en el portal).
  useEffect(() => {
    if (!renglon) return;
    saveDraft(clave, { paciente, edad, documento, prescrita, fechaReceta, notas, medico });
  }, [renglon, clave, paciente, edad, documento, prescrita, fechaReceta, notas, medico]);

  const buscar = async () => {
    setBuscando(true); setAvisoBusqueda(null); setCandidatos([]);
    const porNumero = modo === 'numero';
    const n = numero.trim(); const nom = nombres.trim(); const ape = apellidos.trim();
    if (porNumero) {
      const { medico: m } = await buscarMedicoLocal(n, junta);
      if (m) { setMedico(m); setBuscando(false); return; }
    } else {
      const { medicos } = await buscarMedicosLocalPorNombre(nom, ape, junta);
      if (medicos.length) { setCandidatos(medicos); setBuscando(false); return; }
    }
    const { profesionales, total, recortado, error } = await consultarConsejo({ junta, numero: porNumero ? n : '', nombres: nom, apellidos: ape });
    setBuscando(false);
    if (error) { setAvisoBusqueda(error); return; }
    if (!profesionales.length) { setAvisoBusqueda('No aparece en el registro del Consejo. Revisa el número o el nombre.'); return; }
    if (porNumero && profesionales.length === 1) {
      const p = profesionales[0];
      setMedico({ nombre: p.nombre, numero_junta: p.numero_junta, carrera: p.carrera, delConsejo: true });
      return;
    }
    setCandidatos(profesionales.map((p) => ({ ...p, delConsejo: true })));
    if (recortado) setAvisoBusqueda(`El Consejo encontró ${total} y muestra ${profesionales.length}. Agrega el nombre además del apellido, o busca por número.`);
  };

  const entregada = Number(renglon?.cantidad ?? 0);
  const p = num(prescrita);
  const entregoDeMas = p != null && p < entregada;
  const puedeGuardar = puede && paciente.trim() && medico && p > 0 && !entregoDeMas;

  const guardar = async () => {
    setEnviando(true); trabajando('Guardando el renglón…');
    try {
      let medicoId = medico.id;
      if (!medicoId) {
        const r = await guardarMedicoDelConsejo({ numeroJunta: medico.numero_junta, nombre: medico.nombre, junta, carrera: medico.carrera ?? null });
        if (r.error) throw new Error(r.error);
        medicoId = r.id;
      }
      let fotoUrl = null;
      if (fotos[0]) {
        const f = fotos[0];
        const ext = (f.nombre.split('.').pop() || 'jpg').toLowerCase();
        const datos = await (await fetch(f.uri)).arrayBuffer();
        fotoUrl = await subirArchivo(BUCKET_RECETAS, `${renglon.branch_id ?? sala}/${hoySV().slice(0, 7)}/${Date.now()}-${renglon.id}.${ext}`, datos, { contentType: f.tipo });
      }
      const { error } = await completarRenglon({
        dispensacionId: renglon.id, pacienteNombre: paciente.trim(), medicoId, cantidadPrescrita: p,
        fechaPrescripcion: fechaReceta || null, pacienteEdad: edad === '' ? null : Number(edad),
        pacienteDocumento: documento.trim() || null, fotoUrl, notas: notas.trim() || null,
      });
      if (error) throw new Error(error);
      clearDraft(clave);
      listo('Renglón completo', fotoUrl ? renglon.producto_nombre : `${renglon.producto_nombre} · falta la foto de la receta`);
      router.back();
    } catch (e) {
      fallo('No se pudo guardar', e?.message);
    } finally {
      setEnviando(false);
    }
  };

  if (renglon === undefined) return <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Completar receta' }} />;
  if (!renglon) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Completar receta' }} />
        <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 120 }}>Este renglón ya no está pendiente.</Text>
      </>
    );
  }
  const clase = CLASE_CLIENTE[renglon.clase_cliente];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Completar receta' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Seccion titulo="La venta">
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{renglon.producto_nombre}</Text>
            <Dato primero rotulo="Entregado" valor={`${entregada}`} fuerte />
            <Dato rotulo="Fecha" valor={fechaTexto(String(renglon.fecha).slice(0, 10), { day: 'numeric', month: 'long' })} />
            {renglon.folio_txt ? <Dato rotulo="Folio" valor={renglon.folio_txt} /> : null}
            {renglon.lote ? <Dato rotulo="Lote" valor={renglon.lote} /> : null}
            {renglon.vendedor ? <Dato rotulo="Vendió" valor={renglon.vendedor} /> : null}
          </Seccion>

          <Seccion titulo="Paciente">
            {clase && !clase.sirve ? <Aviso tono="cuidado" texto={`${clase.titulo} ${clase.aviso}`} /> : null}
            <Campo multiline={false} value={paciente} onChangeText={setPaciente} placeholder="Nombre de quien se lleva el medicamento" autoCapitalize="words" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Campo multiline={false} value={edad} onChangeText={(t) => setEdad(t.replace(/\D/g, '').slice(0, 3))} placeholder="Edad (opcional)" keyboardType="number-pad" /></View>
              <View style={{ flex: 1.4 }}><Campo multiline={false} value={documento} onChangeText={setDocumento} placeholder="DUI (opcional)" /></View>
            </View>
          </Seccion>

          <Seccion titulo="Médico">
            {medico ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{medico.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`N.º ${medico.numero_junta ?? '—'}${medico.carrera ? ` · ${medico.carrera}` : ''}${medico.delConsejo ? ' · del Consejo' : ''}`}</Text>
                </View>
                <Tocable onPress={() => { setMedico(null); setCandidatos([]); }} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                </Tocable>
              </View>
            ) : (
              <>
                <Opciones opciones={JUNTAS_QUE_PRESCRIBEN.map((j) => ({ id: j.value, label: j.label }))} valor={junta} onCambiar={setJunta} />
                <Segmentos margen={0} activa={modo} onCambiar={(v) => { setModo(v); setCandidatos([]); setAvisoBusqueda(null); }}
                  opciones={[{ id: 'numero', label: 'Por número' }, { id: 'nombre', label: 'Por nombre' }]} />
                {modo === 'numero' ? (
                  <Campo multiline={false} value={numero} onChangeText={(t) => setNumero(t.replace(/\D/g, ''))} placeholder="N.º de junta (JVPM)" keyboardType="number-pad" />
                ) : (
                  <View style={{ gap: 8 }}>
                    <Campo multiline={false} value={nombres} onChangeText={setNombres} placeholder="Nombres" autoCapitalize="words" />
                    <Campo multiline={false} value={apellidos} onChangeText={setApellidos} placeholder="Apellidos" autoCapitalize="words" />
                  </View>
                )}
                <BotonGrande texto={buscando ? 'Buscando…' : 'Buscar'} borde deshabilitado={buscando || (modo === 'numero' ? !numero.trim() : !(nombres.trim() || apellidos.trim()))} onPress={buscar} />
                {avisoBusqueda ? <Aviso tono="cuidado" texto={avisoBusqueda} /> : null}
                {candidatos.map((c, i) => (
                  <Tocable key={`${c.numero_junta}-${i}`} onPress={() => { Haptics.selectionAsync().catch(() => {}); setMedico(c); setCandidatos([]); }}
                    style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{c.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`N.º ${c.numero_junta}${c.carrera ? ` · ${c.carrera}` : ''}${c.id ? ' · ya está en el portal' : ''}`}</Text>
                  </Tocable>
                ))}
              </>
            )}
          </Seccion>

          <Seccion titulo="La receta">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Cuánto recetó</Text>
              <View style={{ width: 110 }}><Campo multiline={false} value={prescrita} onChangeText={setPrescrita} keyboardType="decimal-pad" style={{ textAlign: 'center' }} /></View>
            </View>
            {entregoDeMas ? <Aviso tono="freno" texto={`Se entregaron ${entregada}: lo recetado no puede ser menos.`} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Fecha de la receta</Text>
              <Fecha valor={fechaReceta} onCambiar={setFechaReceta} hasta={hoySV()} />
            </View>
            <Fotos fotos={fotos} onCambiar={setFotos} max={1} />
            <Campo value={notas} onChangeText={setNotas} placeholder="Notas (opcional)" />
          </Seccion>

          {!puede ? <Aviso tono="freno" texto="Tu cargo puede ver el libro pero no completarlo." /> : null}
          <BotonGrande texto={enviando ? 'Guardando…' : fotos.length ? 'Guardar' : 'Guardar sin la foto'} color={MARCA.violeta}
            deshabilitado={enviando || !puedeGuardar} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
