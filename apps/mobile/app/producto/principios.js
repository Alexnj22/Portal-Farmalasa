// Los principios activos de un producto, NATIVO — el `PrincipiosEditor` del
// catálogo del portal: cada principio con su concentración, o una de las dos
// respuestas que no son un principio («Insumo», «No aplica»). Lo que se guarda
// (`principiosParaGuardar`) y cómo (`guardarPrincipiosActivos`, que borra,
// inserta, escribe el texto del producto y anota) son del núcleo.
//
// Debajo, como en el portal, el buscador del registro sanitario (SRS) para
// consultar el principio y la concentración registrados (`buscarEnSrs`, leído
// con `resultadoDeSrs`). Tocar un resultado lo copia como principio.
import { volver } from '../../componentes/volver';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPrincipiosDeProducto, guardarPrincipiosActivos } from '@nucleo/data/productos';
import { PRINCIPIO_PRESETS, editorDePrincipios, principiosParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { buscarEnSrs } from '@nucleo/data/srs';
import { resultadoDeSrs } from '@nucleo/utils/srs';
import { Pildora } from '../../componentes/avisos/Piezas';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

/* El buscador del SRS: consulta, de a 10, con espera al escribir. */
function BuscadorSrs({ inicial, onUsar }) {
  const [q, setQ] = useState(inicial ?? '');
  const [res, setRes] = useState(null);   // { filas, total, pagina, ultima }
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const espera = useRef(null);
  const buscar = async (texto, pagina = 1) => {
    if (!texto.trim()) { setRes(null); return; }
    setCargando(true); setError(null);
    try {
      const j = await buscarEnSrs(texto.trim(), { pagina, porPagina: 10 });
      setRes({ filas: j.data || [], total: j.total || 0, pagina: j.current_page || pagina, ultima: j.last_page || 1 });
    } catch (e) { setError(mensajeAmigable(e)); setRes(null); }
    finally { setCargando(false); }
  };
  useEffect(() => () => clearTimeout(espera.current), []);
  const escribir = (t) => { setQ(t); clearTimeout(espera.current); espera.current = setTimeout(() => buscar(t, 1), 450); };
  return (
    <Seccion titulo="Registro sanitario (SRS)" pie="Consulta el principio y la concentración registrados. Tocar uno lo copia arriba: revísalo antes de guardar.">
      <Campo multiline={false} value={q} onChangeText={escribir} placeholder="Buscar en el registro SRS" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => buscar(q, 1)} />
      {!res && !cargando && q.trim() ? (
        <Pressable onPress={() => buscar(q, 1)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Buscar «${q.trim()}»`}</Text>
        </Pressable>
      ) : null}
      {cargando ? <ActivityIndicator /> : null}
      {error ? <Aviso tono="freno" texto={error} /> : null}
      {res && !res.filas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Sin resultados para «${q.trim()}».`}</Text> : null}
      {res?.filas.map((crudo, i) => {
        const r = resultadoDeSrs(crudo);
        return (
          <Pressable key={crudo.id ?? `${r.noregistro}-${i}`} disabled={!r.principio}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onUsar(r); }}
            style={({ pressed }) => ({ gap: 3, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.nombre || 'Sin nombre'}</Text>
              {r.estatus ? <Pildora texto={r.activo ? 'Activo' : 'Inactivo'} color={r.activo ? MARCA.verde : colorSistema.texto2} /> : null}
            </View>
            {r.principio ? <Text style={{ color: MARCA.violetaClaro, fontSize: 13, fontWeight: '600' }}>{[r.principio, r.conc].filter(Boolean).join(' · ')}</Text> : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[r.lab, r.forma, r.noregistro ? `Reg. ${r.noregistro}` : null].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        );
      })}
      {res && res.ultima > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable disabled={res.pagina <= 1 || cargando} onPress={() => buscar(q, res.pagina - 1)} style={{ minHeight: 44, justifyContent: 'center', opacity: res.pagina <= 1 ? 0.4 : 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>‹ Anterior</Text>
          </Pressable>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${res.pagina} de ${res.ultima} · ${res.total} registros`}</Text>
          <Pressable disabled={res.pagina >= res.ultima || cargando} onPress={() => buscar(q, res.pagina + 1)} style={{ minHeight: 44, justifyContent: 'center', opacity: res.pagina >= res.ultima ? 0.4 : 1 }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Siguiente ›</Text>
          </Pressable>
        </View>
      ) : null}
    </Seccion>
  );
}

export default function PrincipiosDelProducto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id);
  const [ed, setEd] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    Promise.resolve(fetchPrincipiosDeProducto(productId)).then((d) => setEd(editorDePrincipios(d))).catch((e) => { fallo('No se pudo cargar', mensajeAmigable(e)); setEd(editorDePrincipios([])); });
  }, [productId]);
  if (!ed) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Principios activos' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const set = (i, campo, v) => setEd((e) => ({ ...e, items: e.items.map((p, j) => (j === i ? { ...p, [campo]: v } : p)) }));
  const { rows, text } = principiosParaGuardar(productId, ed);
  const guardar = () => Alert.alert('Guardar principios activos', text ? `«${text}»` : 'El producto queda sin principios activos.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      setGuardando(true);
      try {
        const r = await guardarPrincipiosActivos(productId, rows, text, { desde: 'app' });
        if (r?.error) throw r.error;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Guardado', 'Principios activos actualizados.');
        volver('/productos');
      } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setGuardando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Principios activos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', marginHorizontal: 4 }}>{nombre}</Text>
        <Seccion titulo="No es un principio activo">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PRINCIPIO_PRESETS.map((p) => (
              <Pressable key={p} onPress={() => setEd((e) => (e.preset === p ? editorDePrincipios([]) : { preset: p, items: [] }))}
                style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: ed.preset === p ? MARCA.violetaClaro : 'rgba(127,127,127,0.16)' }}>
                <Text style={{ color: ed.preset === p ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </Seccion>
        {!ed.preset ? (
          <Seccion titulo="Principios activos">
            {ed.items.map((p, i) => (
              <View key={p._key} style={{ gap: 6, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Campo multiline={false} value={p.nombre} onChangeText={(t) => set(i, 'nombre', t)} placeholder="Nombre (ej. Amoxicilina)" />
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}><Campo multiline={false} value={p.concentracion ?? ''} onChangeText={(t) => set(i, 'concentracion', t)} placeholder="Concentración (ej. 500mg)" /></View>
                  {ed.items.length > 1 ? (
                    <Pressable hitSlop={8} onPress={() => setEd((e) => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
            <Pressable onPress={() => setEd((e) => ({ ...e, items: [...e.items, { nombre: '', concentracion: '', orden: e.items.length, _key: Date.now() }] }))} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Agregar otro principio</Text>
            </Pressable>
          </Seccion>
        ) : null}
        {!ed.preset ? (
          <BuscadorSrs inicial={nombre} onUsar={(r) => setEd((e) => {
            // Ocupa el primer renglón vacío; si no hay, agrega uno.
            const vacio = e.items.findIndex((x) => !String(x.nombre ?? '').trim());
            const nuevo = { nombre: r.principio, concentracion: r.conc };
            if (vacio >= 0) return { ...e, items: e.items.map((x, j) => (j === vacio ? { ...x, ...nuevo } : x)) };
            return { ...e, items: [...e.items, { ...nuevo, orden: e.items.length, _key: Date.now() }] };
          })} />
        ) : null}
        <Aviso texto={text ? `Quedará: ${text}` : 'Sin principios: el producto sale de la clasificación regulada hasta que se le ponga uno.'} />
        <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.violetaClaro} deshabilitado={guardando} onPress={guardar} />
      </ScrollView>
    </>
  );
}
