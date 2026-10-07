// Encuesta en la app (2026-10-07): las que el portal publica con el canal
// «app». Las preguntas siguen las mismas condiciones que valida la base
// (`encuesta_cliente_cumple`), y al enviar se acreditan los puntos solos.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Boton, Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { Confeti } from '../componentes/animacion';
import { useSesion } from '../lib/sesion';
import { entero } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

// El mismo juez que `public.encuesta_cliente_cumple`.
function cumple(cond, r) {
  if (!cond || typeof cond !== 'object' || !cond.pregunta) return true;
  const v = r[cond.pregunta];
  if (v === undefined || v === null || v === '') return false;
  switch (cond.operador) {
    case '<=': return typeof v === 'number' && v <= Number(cond.valor);
    case '>=': return typeof v === 'number' && v >= Number(cond.valor);
    case '=': return typeof cond.valor === 'boolean' ? v === cond.valor : typeof v === 'number' && v === Number(cond.valor);
    case 'incluye': return Array.isArray(v) ? v.includes(cond.valor) : v === cond.valor;
    default: return true;
  }
}
const vacia = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

export default function Encuesta() {
  const { id } = useLocalSearchParams();
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [r, setR] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(null);
  const inicio = useRef(Date.now());
  useFocusEffect(useCallback(() => { pedir('mis_encuestas').then(setD); }, [pedir]));
  const enc = d?.ok ? (d.encuestas.find((e) => e.id === id) ?? d.encuestas[0]) : null;

  // Visibles en orden, evaluando cada condición con lo ya contestado (igual que la base).
  const visibles = useMemo(() => {
    if (!enc) return [];
    const salida = []; const validas = {};
    for (const s of enc.cuestionario?.secciones ?? []) for (const p of s.preguntas ?? []) {
      if (!cumple(p.condicion, validas)) continue;
      salida.push(p);
      if (!vacia(r[p.id])) validas[p.id] = r[p.id];
    }
    return salida;
  }, [enc, r]);
  const poner = (pid, v) => setR((x) => ({ ...x, [pid]: v }));

  const enviar = async () => {
    const falta = visibles.findIndex((p) => p.obligatoria && vacia(r[p.id]));
    if (falta >= 0) { Alert.alert('Falta una respuesta', `Contesta la pregunta ${falta + 1}.`); return; }
    const limpias = Object.fromEntries(visibles.filter((p) => !vacia(r[p.id])).map((p) => [p.id, r[p.id]]));
    setEnviando(true);
    const res = await pedir('responder_encuesta', { id: enc.id, respuestas: limpias, duracion: Math.round((Date.now() - inicio.current) / 1000) });
    setEnviando(false);
    if (!res?.ok) { Alert.alert('No se pudo enviar', res?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setHecho(res);
  };

  if (!d) return <Cargando />;
  if (hecho) return (
    <Pantalla conPestanas={false}>
      <Confeti />
      <Tarjeta estilo={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
        <Text style={{ fontSize: 44 }}>🎉</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>¡Gracias por tu opinión!</Text>
        <Text style={{ fontSize: 16, color: colorSistema.texto2, textAlign: 'center' }}>
          {hecho.estado === 'acreditado' ? `Te acreditamos ${entero(hecho.puntos)} puntos.` : `Tus ${entero(hecho.puntos)} puntos se acreditarán en breve.`}
        </Text>
        {hecho.cierre ? <Text style={{ fontSize: 15, color: colorSistema.texto2, textAlign: 'center' }}>{hecho.cierre}</Text> : null}
      </Tarjeta>
      <Boton alTocar={() => router.back()}>Listo</Boton>
    </Pantalla>
  );
  if (!enc) return <Pantalla conPestanas={false}><Vacio titulo="Sin encuestas por ahora">Cuando tengamos una nueva, te avisamos aquí. ¡Gracias!</Vacio></Pantalla>;

  return (
    <Pantalla conPestanas={false}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colorSistema.texto }}>{enc.nombre}</Text>
        <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>{enc.bienvenida || 'Tu opinión nos ayuda a atenderte mejor.'} Ganas {entero(enc.puntos)} puntos al terminar.</Text>
      </View>
      {visibles.map((p, i) => (
        <Tarjeta key={p.id} estilo={{ gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{i + 1}. {p.texto}{p.obligatoria ? '' : '  (opcional)'}</Text>
          <Pregunta p={p} valor={r[p.id]} alCambiar={(v) => poner(p.id, v)} />
        </Tarjeta>
      ))}
      <Boton alTocar={enviar} cargando={enviando}>{`Enviar y ganar ${entero(enc.puntos)} puntos`}</Boton>
    </Pantalla>
  );
}

function Opcion({ texto, activa, alTocar, ancho }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button" accessibilityState={{ selected: activa }}
      style={({ pressed }) => ({ minHeight: 44, minWidth: ancho, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: activa ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'), transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: activa ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}

function Pregunta({ p, valor, alCambiar }) {
  const t = useTema();
  const ops = (p.opciones ?? []).filter((o) => String(o.texto ?? '').trim());
  switch (p.tipo) {
    case 'nps':
      return (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {Array.from({ length: 11 }, (_, n) => <Opcion key={n} texto={String(n)} ancho={44} activa={valor === n} alTocar={() => alCambiar(n)} />)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: colorSistema.texto2 }}>Nada probable</Text>
            <Text style={{ fontSize: 12, color: colorSistema.texto2 }}>Muy probable</Text>
          </View>
        </View>
      );
    case 'csat': case 'likert': {
      const caras = p.tipo === 'csat' ? ['😞', '🙁', '😐', '🙂', '😄'] : ['1', '2', '3', '4', '5'];
      return (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {caras.map((c, k) => <View key={k} style={{ flex: 1 }}><Opcion texto={c} activa={valor === k + 1} alTocar={() => alCambiar(k + 1)} /></View>)}
        </View>
      );
    }
    case 'si_no':
      return (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Opcion texto="Sí" activa={valor === true} alTocar={() => alCambiar(true)} /></View>
          <View style={{ flex: 1 }}><Opcion texto="No" activa={valor === false} alTocar={() => alCambiar(false)} /></View>
        </View>
      );
    case 'unica':
      return <View style={{ gap: 6 }}>{ops.map((o) => <Opcion key={o.id} texto={o.texto} activa={valor === o.id} alTocar={() => alCambiar(o.id)} />)}</View>;
    case 'multiple': {
      const sel = Array.isArray(valor) ? valor : [];
      return <View style={{ gap: 6 }}>{ops.map((o) => <Opcion key={o.id} texto={o.texto} activa={sel.includes(o.id)}
        alTocar={() => alCambiar(sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id])} />)}</View>;
    }
    case 'ranking': {
      // Tocar en orden de preferencia; tocar otra vez lo quita.
      const sel = Array.isArray(valor) ? valor : [];
      return (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>Toca en orden, del que más al que menos te importa.</Text>
          {ops.map((o) => { const k = sel.indexOf(o.id); return (
            <Opcion key={o.id} texto={k >= 0 ? `${k + 1}. ${o.texto}` : o.texto} activa={k >= 0}
              alTocar={() => alCambiar(k >= 0 ? sel.filter((x) => x !== o.id) : [...sel, o.id])} />); })}
        </View>
      );
    }
    case 'numero':
      return <Campo t={t} teclado="number-pad" valor={valor == null ? '' : String(valor)} alCambiar={(x) => { const n = x.replace(/[^\d]/g, ''); alCambiar(n === '' ? null : Number(n)); }} />;
    default:
      return <Campo t={t} multilinea valor={valor ?? ''} alCambiar={(x) => alCambiar(x.slice(0, 2000))} />;
  }
}

function Campo({ t, valor, alCambiar, teclado, multilinea }) {
  return (
    <TextInput value={valor} onChangeText={alCambiar} keyboardType={teclado} multiline={multilinea} placeholder="Escribe aquí"
      placeholderTextColor={colorSistema.texto3 ?? colorSistema.texto2}
      style={{ minHeight: multilinea ? 88 : 44, borderRadius: 12, padding: 12, fontSize: 16, color: colorSistema.texto, textAlignVertical: 'top',
        backgroundColor: suave(t.color.magenta, t.oscuro ? 0.12 : 0.06) }} />
  );
}
