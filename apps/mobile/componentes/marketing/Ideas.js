// Marketing · Ideas, NATIVO — `TabIdeas` del portal: el banco de ideas.
// Cualquiera con acceso deja una (queda quién y a qué hora). Quien diseña la
// toma («en trabajo») y la resuelve: crea la pieza (`marketing-editar` con lo
// de la idea; al guardarla la idea queda «usada»), la liga a una pieza del mes,
// o la descarta con su motivo. Soltar, reabrir; editar y quitar la propia
// mientras sigue nueva. Qué se puede con cada una sale del núcleo
// (`accionesDeIdea`), lo mismo del portal; las escrituras, las del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { crearIdea, editarIdea, fetchIdeas, fetchPersonas, moverIdea, quitarIdea } from '@nucleo/data/marketing';
import {
  ESTADOS_IDEA, FORMATOS, VISTAS_DE_IDEAS, accionesDeIdea, cuentaDeIdeas, formatoDe, ideasDeLaVista, prellenadoDeIdea,
} from '@nucleo/utils/marketing';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Segmentos from '../Segmentos';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';
import { fallo, listo } from '../Progreso';
import { guardar } from '../comercial/elegido';

const VACIA = { titulo: '', detalle: '', marca_id: '', formato: '' };
const ROTULO_ACCION = {
  tomar: 'Tomarla', crear_pieza: 'Crear pieza', ligar: 'Ligar a una pieza', soltar: 'Soltarla',
  descartar: 'Descartar', reabrir: 'Reabrir', editar: 'Editar', quitar: 'Quitar',
};
const hoja = (titulo, lista, onElegir, destructivo) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...lista.map((x) => x.label), 'Cancelar'], cancelButtonIndex: lista.length, destructiveButtonIndex: destructivo },
  (i) => { if (i < lista.length) onElegir(lista[i].value); });

export default function Ideas({ busqueda, marcas, piezasDelMes, mes, yoId, puedeEditar, puedeAprobar, recarga }) {
  const [ideas, setIdeas] = useState(null);
  const [personas, setPersonas] = useState({});
  const [vista, setVista] = useState('abiertas');
  const [form, setForm] = useState(VACIA);
  const [guardando, setGuardando] = useState(false);
  const gestiona = puedeEditar || puedeAprobar;

  const cargar = useCallback(async () => {
    try {
      const l = await fetchIdeas();
      setIdeas(l);
      setPersonas(await fetchPersonas(l.flatMap((i) => [i.autor_id, i.tomada_por, i.cerrada_por])).catch(() => ({})));
    } catch (e) { setIdeas((x) => x ?? []); fallo('No se pudieron cargar las ideas', mensajeAmigable(e)); }
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]); // eslint-disable-line react-hooks/set-state-in-effect -- carga de datos

  const cuenta = useMemo(() => cuentaDeIdeas(ideas), [ideas]);
  const visibles = useMemo(() => ideasDeLaVista(ideas, vista).filter((i) => !busqueda || tokenMatch(busqueda, i.titulo, i.detalle || '')), [ideas, vista, busqueda]);
  const marcasActivas = (marcas || []).filter((m) => m.activo);
  const nombre = (id) => (personas[id]?.name ? shortEmployeeName(personas[id]) : '—');

  const agregar = async () => {
    if (!form.titulo.trim()) return;
    setGuardando(true);
    try { await crearIdea(form, yoId); setForm(VACIA); setVista('abiertas'); listo('Idea guardada', 'Quien diseña ya la puede ver.'); cargar(); }
    catch (e) { fallo('No se pudo guardar la idea', mensajeAmigable(e)); }
    setGuardando(false);
  };
  const correr = async (fn, titulo) => {
    try { await fn(); if (titulo) listo(titulo, ''); cargar(); }
    catch (e) { fallo('No se pudo', mensajeAmigable(e)); }
  };
  const pedirNota = (titulo, mensaje, alListo) => Alert.prompt(titulo, mensaje, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Guardar', onPress: (t) => alListo(String(t ?? '').trim()) },
  ], 'plain-text');

  const accion = (idea, a) => {
    Haptics.selectionAsync().catch(() => {});
    if (a === 'tomar') correr(() => moverIdea(idea.id, 'en_trabajo'), 'Idea tomada');
    else if (a === 'soltar') correr(() => moverIdea(idea.id, 'nueva'), 'Idea soltada');
    else if (a === 'reabrir') correr(() => moverIdea(idea.id, 'nueva'), 'Idea reabierta');
    else if (a === 'crear_pieza') {
      guardar('marketing-prellenado', prellenadoDeIdea(idea));
      router.push({ pathname: '/marketing-editar', params: { mes, desde: 'idea' } });
    } else if (a === 'ligar') {
      if (!(piezasDelMes || []).length) { Alert.alert('Sin piezas', `${mes ? 'Este mes' : 'El mes'} no tiene piezas para ligar.`); return; }
      hoja('¿A qué pieza?', piezasDelMes.map((p) => ({ value: p.id, label: `${fechaTexto(p.fecha, { day: 'numeric', month: 'short' })} · ${p.titulo}` })), (piezaId) => {
        pedirNota('Ligar a la pieza', 'Nota (opcional):', (nota) => correr(() => moverIdea(idea.id, 'usada', { piezaId, nota }), 'Idea ligada'));
      });
    } else if (a === 'descartar') {
      pedirNota('Descartar la idea', '¿Por qué se descarta? (opcional)', (nota) => correr(() => moverIdea(idea.id, 'descartada', { nota }), 'Idea descartada'));
    } else if (a === 'editar') {
      Alert.prompt('Editar la idea', 'El título de la idea', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Guardar', onPress: (t) => { if (String(t ?? '').trim()) correr(() => editarIdea(idea.id, { titulo: t, detalle: idea.detalle, marca_id: idea.marca_id, formato: idea.formato }), 'Idea corregida'); } },
      ], 'plain-text', idea.titulo);
    } else if (a === 'quitar') {
      Alert.alert('¿Quitar la idea?', 'Se borra para todos.', [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Quitar', style: 'destructive', onPress: () => correr(() => quitarIdea(idea.id), 'Idea quitada') },
      ]);
    }
  };

  if (ideas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        <Seccion titulo="Deja una idea" pie="Un tema, una campaña, algo que viste en la sala. Quien diseña la toma y la convierte en publicación.">
          <Campo multiline={false} placeholder="Ej. Reel: cómo leer la etiqueta de un medicamento" value={form.titulo} onChangeText={(t) => setForm((f) => ({ ...f, titulo: t }))} />
          <Campo placeholder="Detalle (opcional): para qué, a quién, una referencia…" value={form.detalle} onChangeText={(t) => setForm((f) => ({ ...f, detalle: t }))} />
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
            <Pressable hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}
              onPress={() => hoja('Marca', [{ value: '', label: 'Cualquiera' }, ...marcasActivas.map((m) => ({ value: m.id, label: m.nombre }))], (v) => setForm((f) => ({ ...f, marca_id: v })))}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Marca: ${marcasActivas.find((m) => m.id === form.marca_id)?.nombre ?? 'cualquiera'} ▾`}</Text>
            </Pressable>
            <Pressable hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}
              onPress={() => hoja('Formato', [{ value: '', label: 'El que convenga' }, ...FORMATOS.map((x) => ({ value: x.value, label: x.label }))], (v) => setForm((f) => ({ ...f, formato: v })))}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Formato: ${form.formato ? formatoDe(form.formato).label : 'el que convenga'} ▾`}</Text>
            </Pressable>
          </View>
          <BotonGrande texto={guardando ? 'Guardando…' : 'Agregar idea'} deshabilitado={!form.titulo.trim() || guardando} onPress={agregar} />
        </Seccion>
      </View>
      <Segmentos activa={vista} onCambiar={setVista} opciones={VISTAS_DE_IDEAS.map((v) => ({ id: v.value, label: `${v.label} · ${cuenta[v.value] ?? 0}` }))} />
      {visibles.map((i) => {
        const est = ESTADOS_IDEA[i.estado] || ESTADOS_IDEA.nueva;
        const marca = (marcas || []).find((m) => m.id === i.marca_id);
        const acciones = accionesDeIdea(i, { gestiona, puedeEditar, yoId });
        return (
          <View key={i.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 6, opacity: i.estado === 'descartada' ? 0.7 : 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Pildora texto={est.label} color={colorDeVariante(est.variant)} />
                  {marca ? <Pildora texto={marca.nombre} color={colorSistema.texto2} /> : null}
                  {i.formato ? <Pildora texto={formatoDe(i.formato).label} color={colorSistema.texto2} /> : null}
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', textDecorationLine: i.estado === 'descartada' ? 'line-through' : 'none' }}>{i.titulo}</Text>
                {i.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{i.detalle}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Propuesta: ${nombre(i.autor_id)} · ${fechaHora12(i.created_at)}`}</Text>
                {i.tomada_at ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`En trabajo: ${nombre(i.tomada_por)} · ${fechaHora12(i.tomada_at)}`}</Text> : null}
                {i.estado === 'usada' || i.estado === 'descartada' ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${i.estado === 'usada' ? 'Usada' : 'Descartada'}: ${nombre(i.cerrada_por)} · ${i.cerrada_at ? fechaHora12(i.cerrada_at) : ''}`}</Text> : null}
                {i.estado === 'usada' && i.pieza ? <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '600' }}>{`Pieza: ${i.pieza.titulo} · ${fechaTexto(i.pieza.fecha, { day: 'numeric', month: 'short' })}`}</Text> : null}
                {i.nota_cierre ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{`«${i.nota_cierre}»`}</Text> : null}
                {acciones.length ? (
                  <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                    {acciones.map((a) => (
                      <Pressable key={a} onPress={() => accion(i, a)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                        <Text style={{ color: a === 'quitar' || a === 'descartar' ? MARCA.rojo : MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{ROTULO_ACCION[a]}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>{busqueda ? 'Sin ideas que coincidan' : 'Sin ideas aquí'}</Text> : null}
    </>
  );
}
