// Un registro de cumplimiento, NATIVO — gemelo de
// `src/views/cumplimiento/RegistroModal.jsx` (2026-11-13, «dejemos TODO
// completamente nativo»). Los campos salen de `TIPOS` (núcleo), que es la
// gemela de lo que la base exige: la pantalla marca lo que falta antes de
// mandar, y si la base igual rechaza, su mensaje se muestra tal cual.
//
// Dos modos: crear/corregir (los campos de alta) y cerrar (sólo los de
// cierre). Un retiro de lote puede anotarse una vez para todas las salas. Lo
// escrito se guarda como borrador: la sesión se cierra sola por inactividad.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { avisarRetiroATodas, cerrarRegistroDeCumplimiento, guardarRegistroDeCumplimiento, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import {
  TIPOS, camposAlCerrar, camposAlCrear, datosIniciales, datosParaGuardar, faltantes, listaDe, nombreDelSemestre, puntuarLista, semestresRecientes,
} from '@nucleo/utils/cumplimiento';
import { hoySV } from '@nucleo/utils/fecha';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion, Vacio } from '../componentes/formulario/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import Tocable from '../componentes/Tocable';
import { MARCA, tintaSobre } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

const VACIO = [];
const RESPUESTAS = [
  { value: 'si', label: 'Cumple', color: MARCA.verde },
  { value: 'no', label: 'No cumple', color: MARCA.rojo },
  { value: 'na', label: 'No aplica', color: MARCA.gris },
];

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Ayuda({ texto }) {
  return texto ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginTop: -4 }}>{texto}</Text> : null;
}

function Elegir({ rotulo, valor, opciones, onElegir }) {
  const abrir = () => ActionSheetIOS.showActionSheetWithOptions(
    { title: rotulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
    (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
  );
  return (
    <Tocable onPress={abrir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ flex: 1, color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16, textAlign: 'right' }} numberOfLines={2}>
        {opciones.find((o) => o.value === valor)?.label ?? 'Elegir'}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}

function Pastilla({ texto, activa, color = colorSistema.acento, onPress }) {
  return (
    <Tocable accessibilityRole="button" accessibilityState={{ selected: activa }}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: activa ? color : `${MARCA.gris}2E` }}>
      <Text style={{ color: activa ? tintaSobre(color) : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
}

export default function RegistroDeCumplimiento() {
  const entrada = useMemo(() => leer('cumplimiento-registro'), []);
  if (!entrada?.tipo || !TIPOS[entrada.tipo]) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Registro', headerLargeTitle: false }} />
        <Vacio>Vuelve a Cumplimiento y elige qué anotar.</Vacio>
      </>
    );
  }
  return <Formulario {...entrada} />;
}

function Formulario({ tipo, modo = 'crear', registro = null, branchId, sala, aTodas = false }) {
  const employees = useStaffStore((s) => s.employees) || VACIO;
  const def = TIPOS[tipo];
  const cerrando = modo === 'cerrar';
  const campos = cerrando ? camposAlCerrar(tipo) : camposAlCrear(tipo);
  const clave = `cumplimiento:${tipo}:${modo}:${registro?.id ?? branchId ?? 'todas'}`;
  const [fecha, setFecha] = useState(() => loadDraft(clave)?.fecha || registro?.fecha || hoySV());
  const [datos, setDatos] = useState(() => loadDraft(clave)?.datos || (cerrando ? {} : datosIniciales(tipo, registro)));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { saveDraft(clave, { fecha, datos }); }, [clave, fecha, datos]);
  const poner = (k, v) => setDatos((d) => ({ ...d, [k]: v }));
  const falta = faltantes(tipo, datos, campos);

  // Para la capacitación: el personal activo de la sala.
  const personal = useMemo(() => employees
    .filter((e) => e.status !== 'INACTIVO' && e.status !== 'LIQUIDADO')
    .filter((e) => !branchId || String(e.branchId ?? e.branch_id ?? '') === String(branchId))
    .map((e) => ({ value: e.id, label: shortEmployeeName(e) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [employees, branchId]);

  const lista = listaDe(tipo);
  const puntaje = lista.length ? puntuarLista(lista, datos.respuestas) : null;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    const limpio = datosParaGuardar(tipo, datos);
    let r;
    if (cerrando) r = await cerrarRegistroDeCumplimiento(registro.id, limpio);
    else if (aTodas) r = await avisarRetiroATodas(fecha, limpio);
    else r = await guardarRegistroDeCumplimiento({ id: registro?.id, branchId, tipo, fecha, datos: limpio });
    setGuardando(false);
    if (r.error) { const t = mensajeDeCumplimiento(r.error); setError(t); fallo('No se pudo guardar', t); return; }
    clearDraft(clave);
    listo(cerrando ? 'Registro cerrado' : 'Registro guardado', aTodas ? `Llegó a ${r.salas} salas` : sala);
    volver('/cumplimiento');
  };

  const campo = (c) => {
    const v = datos[c.key];
    const etiqueta = `${c.label}${c.requerido ? '' : ' (opcional)'}`;
    switch (c.tipo) {
      case 'fijo': return null;
      case 'area':
        return (
          <View key={c.key} style={{ gap: 8 }}>
            <Rotulo texto={etiqueta} />
            <Campo value={v || ''} onChangeText={(t) => poner(c.key, t.slice(0, 1500))} style={{ minHeight: 80 }} />
            <Ayuda texto={c.ayuda} />
          </View>
        );
      case 'lista':
        return (
          <View key={c.key} style={{ gap: 8 }}>
            <Rotulo texto={etiqueta} />
            <Campo value={(v || []).join('\n')} style={{ minHeight: 110 }}
              onChangeText={(t) => poner(c.key, t.slice(0, 4000).split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i < a.length - 1))} />
            <Ayuda texto={c.ayuda} />
          </View>
        );
      case 'fecha':
        return (
          <View key={c.key} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{etiqueta}</Text>
              {v ? <Fecha valor={v} hasta={hoySV()} onCambiar={(x) => poner(c.key, x)} /> : (
                <Tocable onPress={() => poner(c.key, hoySV())} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: colorSistema.acento, fontSize: 16 }}>Elegir</Text>
                </Tocable>
              )}
            </View>
            <Ayuda texto={c.ayuda} />
          </View>
        );
      case 'opciones':
        return <Elegir key={c.key} rotulo={etiqueta} valor={v} opciones={c.opciones} onElegir={(x) => poner(c.key, x)} />;
      case 'semestre':
        return <Elegir key={c.key} rotulo={etiqueta} valor={v}
          opciones={semestresRecientes(hoySV()).map((s) => ({ value: s, label: nombreDelSemestre(s) }))} onElegir={(x) => poner(c.key, x)} />;
      case 'personas':
        return (
          <View key={c.key} style={{ gap: 8 }}>
            <Rotulo texto={`${etiqueta} · ${(v || []).length}`} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {personal.map((p) => {
                const activo = (v || []).some((x) => x.id === p.value);
                return (
                  <Pastilla key={p.value} texto={p.label} activa={activo}
                    onPress={() => poner(c.key, activo ? (v || []).filter((x) => x.id !== p.value) : [...(v || []), { id: p.value, nombre: p.label }])} />
                );
              })}
              {!personal.length ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>No hay personal activo en esta sala.</Text> : null}
            </View>
          </View>
        );
      case 'checklist':
        return (
          <View key={c.key} style={{ gap: 16 }}>
            {lista.map((s) => (
              <Seccion key={s.seccion} titulo={s.seccion}>
                {s.items.map((it, i) => (
                  <View key={it.id} style={{ gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>
                      {it.texto}
                      {it.peso === 'C' ? <Text style={{ color: MARCA.rojo, fontWeight: '700' }}>  · Crítico</Text> : null}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {RESPUESTAS.map((r) => (
                        <Pastilla key={r.value} texto={r.label} color={r.color} activa={v?.[it.id] === r.value}
                          onPress={() => poner(c.key, { ...(v || {}), [it.id]: r.value })} />
                      ))}
                    </View>
                  </View>
                ))}
              </Seccion>
            ))}
          </View>
        );
      case 'numero':
        return (
          <View key={c.key} style={{ gap: 8 }}>
            <Rotulo texto={etiqueta} />
            <Campo multiline={false} keyboardType="decimal-pad" value={v === '' || v == null ? '' : String(v)}
              onChangeText={(t) => { const x = t.replace(',', '.').replace(/[^\d.]/g, ''); poner(c.key, x === '' ? '' : Number(x)); }} />
            <Ayuda texto={c.ayuda} />
          </View>
        );
      default:
        return (
          <View key={c.key} style={{ gap: 8 }}>
            <Rotulo texto={etiqueta} />
            <Campo multiline={false} value={v || ''} onChangeText={(t) => poner(c.key, t)} />
            <Ayuda texto={c.ayuda} />
          </View>
        );
    }
  };

  const titulo = cerrando
    ? (tipo === 'farmacovigilancia' ? 'Anotar la notificación' : `Cerrar ${def.corto.toLowerCase()}`)
    : registro ? `Corregir ${def.corto.toLowerCase()}` : def.titulo;
  const checklist = campos.filter((c) => c.tipo === 'checklist');
  const otros = campos.filter((c) => c.tipo !== 'checklist');
  const bloqueado = guardando || falta.length > 0 || (puntaje && puntaje.sinResponder > 0);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: titulo, headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{aTodas ? 'Para todas las salas y la bodega' : sala}</Text>
          {/* Con lista de verificación, lo escrito (plan de acción, notas) va
              después de responderla, como se llena en papel. */}
          <Seccion>
            {!cerrando ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{tipo === 'destruccion' ? 'Fecha prevista de la destrucción' : 'Fecha'}</Text>
                <Fecha valor={fecha} hasta={tipo === 'destruccion' ? undefined : hoySV()} onCambiar={setFecha} />
              </View>
            ) : null}
            {!checklist.length ? otros.map(campo) : null}
          </Seccion>
          {checklist.map(campo)}
          {checklist.length && otros.some((c) => c.tipo !== 'fijo') ? <Seccion>{otros.map(campo)}</Seccion> : null}
          {puntaje ? (
            <Aviso tono={puntaje.aprueba ? 'nota' : 'cuidado'}
              texto={`${puntaje.si} de ${puntaje.total - puntaje.na} cumplen (${puntaje.porcentaje} %).${puntaje.fallas.C > 0 ? ` ${puntaje.fallas.C} crítico${puntaje.fallas.C === 1 ? '' : 's'} sin cumplir: no aprueba.` : ''}${puntaje.sinResponder > 0 ? ` Faltan ${puntaje.sinResponder} por responder.` : ''}`} />
          ) : null}
          {falta.length ? <Aviso tono="cuidado" texto={`Falta: ${falta.join(', ')}.`} /> : null}
          {error ? <Aviso tono="freno" texto={error} /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : cerrando ? 'Guardar y cerrar' : 'Guardar'} color={MARCA.azul} deshabilitado={bloqueado} onPress={guardar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
