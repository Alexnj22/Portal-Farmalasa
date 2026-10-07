// Crear o editar una encuesta interna, NATIVO — el formulario de
// `EncuestaAdminView`: título, año, tipo (clima, satisfacción, desempeño,
// personalizada), estado, descripción, anónima, si comparte resultados y las
// fechas. Se guarda con `insertSurvey` / `actualizarEncuesta`, los mismos del
// portal, que anotan la bitácora solos.
//
// A quién va: todo el personal, unas sucursales, las jefaturas de sala o unas
// personas (con buscador). Los ids que se guardan los decide el núcleo
// (`idsDelAlcance`), la misma regla del portal.
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { actualizarEncuesta, insertSurvey } from '@nucleo/data/encuestas';
import { ALCANCES_DE_ENCUESTA, ESTADO_ENCUESTA, TIPO_ENCUESTA, idsDelAlcance } from '@nucleo/utils/climaLaboral';
import { hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { encuestaInternaAbierta } from '../../componentes/encuestas/interna';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';


function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Interruptor({ titulo, detalle, valor, onCambiar, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Switch value={valor} onValueChange={onCambiar} />
    </View>
  );
}

export default function EditarEncuestaInterna() {
  const { id } = useLocalSearchParams();
  const abierta = encuestaInternaAbierta();
  const e = id !== 'nueva' && abierta?.encuesta && String(abierta.encuesta.id) === String(id) ? abierta.encuesta : null;
  const [f, setF] = useState({
    nombre: e?.nombre ?? '', anio: String(e?.['año'] ?? new Date().getFullYear()), tipo: e?.tipo ?? 'clima',
    estado: e?.estado ?? 'activa', descripcion: e?.descripcion ?? '', anonima: e?.anonima ?? true,
    compartir: e?.compartir_resultados ?? false, inicio: e?.fecha_inicio ?? '', fin: e?.fecha_fin ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const [alcance, setAlcance] = useState(e?.scope_tipo ?? 'all');
  const [ids, setIds] = useState(e?.scope_ids ?? []);
  const [busca, setBusca] = useState('');
  const branches = useStaffStore((s) => s.branches);
  const employees = useStaffStore((s) => s.employees);
  const alternar = (id) => { Haptics.selectionAsync().catch(() => {}); setIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])); };
  const elegidos = useMemo(() => (employees || []).filter((p) => ids.includes(p.id)), [employees, ids]);
  const encontrados = useMemo(() => (busca.trim().length < 2 ? [] : (employees || [])
    .filter((p) => !ids.includes(p.id) && tokenMatch(busca, p.name, p.code)).slice(0, 15)), [employees, ids, busca]);

  const guardar = async () => {
    if (!f.nombre.trim()) { Alert.alert('Falta el título', 'El título de la encuesta es obligatorio.'); return; }
    const anio = Number(f.anio);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) { Alert.alert('Año', 'Escribe un año válido.'); return; }
    if (f.inicio && f.fin && f.fin < f.inicio) { Alert.alert('Fechas', 'La fecha de cierre es anterior a la de inicio.'); return; }
    if ((alcance === 'branches' || alcance === 'employees') && !ids.length) { Alert.alert('A quién va', alcance === 'branches' ? 'Elige al menos una sucursal.' : 'Elige al menos una persona.'); return; }
    setGuardando(true);
    const payload = {
      nombre: f.nombre.trim(), 'año': anio, tipo: f.tipo, estado: f.estado,
      descripcion: f.descripcion.trim() || null, anonima: f.anonima, compartir_resultados: f.compartir,
      fecha_inicio: f.inicio || null, fecha_fin: f.fin || null,
      scope_tipo: alcance, scope_ids: idsDelAlcance(alcance, ids),
    };
    const { error } = e ? await actualizarEncuesta(e.id, payload) : await insertSurvey(payload);
    setGuardando(false);
    if (error) { fallo(e ? 'No se pudo actualizar' : 'No se pudo crear', error.message || ''); return; }
    listo(e ? 'Encuesta actualizada' : 'Encuesta creada', f.nombre.trim());
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: e ? 'Editar encuesta' : 'Nueva encuesta', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="La encuesta">
            <Rotulo texto="Título" />
            <Campo multiline={false} value={f.nombre} onChangeText={cambiar('nombre')} maxLength={120} placeholder="Ej. Clima laboral 2026" />
            <Rotulo texto="Año" />
            <Campo multiline={false} value={f.anio} onChangeText={cambiar('anio')} keyboardType="number-pad" maxLength={4} />
            <Rotulo texto="Descripción (opcional)" />
            <Campo value={f.descripcion} onChangeText={cambiar('descripcion')} maxLength={600} style={{ minHeight: 80 }} />
          </Seccion>
          <Seccion titulo="Tipo">
            <Opciones opciones={Object.entries(TIPO_ENCUESTA).map(([k, v]) => ({ id: k, label: v }))} valor={f.tipo} onCambiar={cambiar('tipo')} />
          </Seccion>
          <Seccion titulo="Estado">
            <Opciones opciones={Object.entries(ESTADO_ENCUESTA).map(([k, v]) => ({ id: k, label: v }))} valor={f.estado} onCambiar={cambiar('estado')} />
          </Seccion>
          <Seccion titulo="Fechas (opcionales)">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Desde</Text>
              <Fecha valor={f.inicio || hoySV()} onCambiar={cambiar('inicio')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Hasta</Text>
              <Fecha valor={f.fin || f.inicio || hoySV()} onCambiar={cambiar('fin')} desde={f.inicio || undefined} />
            </View>
            {!f.inicio && !f.fin ? <Aviso texto="Sin fechas, la encuesta no tiene apertura ni cierre automáticos." /> : null}
          </Seccion>
          <Seccion>
            <Interruptor primero titulo="Anónima" detalle="Los resultados no muestran quién respondió." valor={f.anonima} onCambiar={cambiar('anonima')} />
            <Interruptor titulo="Compartir resultados" detalle="El personal puede ver el resultado general." valor={f.compartir} onCambiar={cambiar('compartir')} />
          </Seccion>
          <Seccion titulo="A quién va">
            <Segmentos activa={alcance} onCambiar={(v) => { setAlcance(v); setIds([]); setBusca(''); }} margen={0}
              opciones={ALCANCES_DE_ENCUESTA.map((a) => ({ id: a.id, label: a.label }))} />
            {alcance === 'all' ? <Aviso texto="Todo el personal puede responderla." /> : null}
            {alcance === 'roles' ? <Aviso texto="Solo aplicará a jefes/as de sala registrados en el sistema." /> : null}
            {alcance === 'branches' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(branches || []).map((b) => {
                  const on = ids.includes(b.id);
                  return (
                    <Pressable key={b.id} onPress={() => alternar(b.id)}
                      style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
                      <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{b.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {alcance === 'employees' ? (
              <View style={{ gap: 8 }}>
                {elegidos.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {elegidos.map((p) => (
                      <Pressable key={p.id} onPress={() => alternar(p.id)}
                        style={{ paddingHorizontal: 12, minHeight: 34, justifyContent: 'center', borderRadius: 999, backgroundColor: `${MARCA.azulClaro}33` }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`${shortEmployeeName(p)}  ✕`}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie elegido todavía.</Text>}
                <Campo multiline={false} value={busca} onChangeText={setBusca} placeholder="Buscar persona por nombre o código" />
                {encontrados.map((p) => (
                  <Pressable key={p.id} onPress={() => { alternar(p.id); setBusca(''); }} style={{ minHeight: 40, justifyContent: 'center' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{shortEmployeeName(p)}<Text style={{ color: colorSistema.texto2 }}>{p.role ? ` · ${p.role}` : ''}</Text></Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Seccion>
          <BotonGrande texto={guardando ? 'Guardando…' : e ? 'Guardar cambios' : 'Crear encuesta'} onPress={guardar} deshabilitado={guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
