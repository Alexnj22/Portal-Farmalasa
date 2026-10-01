// Faltantes de bolsa, NATIVO — la pestaña Faltantes de Traslados en el portal
// (`FilasFaltante.jsx`): lo que no llegó en una bolsa y todavía no se aclara.
// Se cierra con «Apareció» o «No apareció» (`cerrarFaltante`); «No apareció»
// exige la nota de qué se hizo. Si alguien ya lo había cerrado, se dice.
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { cerrarFaltante, fetchFaltantes } from '@nucleo/data/faltantes';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const ESTADO = { abierto: ['Sin resolver', MARCA.rojo], aparecio: ['Apareció', MARCA.verde], no_aparecio: ['No apareció', MARCA.ambar] };

function Faltante({ f, onHecho }) {
  const [cerrando, setCerrando] = useState(false);
  const [nota, setNota] = useState('');
  const abierto = f.estado === 'abierto';
  const [rotulo, color] = ESTADO[f.estado] ?? [f.estado, MARCA.azulClaro];
  const cerrar = async (estado) => {
    trabajando('Cerrando el faltante…');
    const r = await cerrarFaltante(f.id, estado, nota);
    if (!r.ok) { fallo('No se pudo cerrar', r.error); if (r.codigo === 'YA_CERRADO') onHecho(); return; }
    listo(estado === 'aparecio' ? 'Apareció' : 'Cerrado como no apareció', f.descripcion);
    onHecho();
  };
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.descripcion}</Text>
            <Text style={{ color: MARCA.rojo, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`−${f.cantidad}`}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${f.origen_branch_name ?? '—'} → ${f.destino_branch_name ?? '—'}${f.codigo_bolsa ? ` · bolsa ${f.codigo_bolsa}` : ''}${f.declarado_at ? ` · ${fechaTexto(String(f.declarado_at).slice(0, 10), { day: 'numeric', month: 'short' })}` : ''}${f.declarado_por_nombre ? ` · ${f.declarado_por_nombre}` : ''}`}
          </Text>
          {f.nota ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{f.nota}</Text> : null}
          {!abierto ? <Pildora texto={`${rotulo}${f.resuelto_por_nombre ? ` · ${f.resuelto_por_nombre}` : ''}`} color={color} /> : null}
          {f.resolucion ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se resolvió: ${f.resolucion}`}</Text> : null}
          {abierto && !cerrando ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Apareció" color={MARCA.verde} onPress={() => cerrar('aparecio')} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="No apareció" borde color={MARCA.ambar} onPress={() => setCerrando(true)} /></View>
            </View>
          ) : null}
          {abierto && cerrando ? (
            <View style={{ gap: 8 }}>
              <Campo value={nota} onChangeText={setNota} placeholder="¿Qué se hizo? Ej.: se descontó, se repuso…" />
              <BotonGrande texto="Cerrar como no apareció" color={MARCA.ambar} deshabilitado={!nota.trim()} onPress={() => cerrar('no_aparecio')} />
              <Pressable onPress={() => setCerrando(false)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cancelar</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}

export default function Faltantes() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('abiertos');
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    const { faltantes, error: e } = await fetchFaltantes();
    setError(e ? 'No se pudieron cargar los faltantes.' : null);
    setLista(faltantes || []);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const abiertos = (lista || []).filter((f) => f.estado === 'abierto');
  const visibles = vista === 'abiertos' ? abiertos : (lista || []).filter((f) => f.estado !== 'abierto');
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Faltantes', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'abiertos', label: abiertos.length ? `Sin resolver · ${abiertos.length}` : 'Sin resolver' }, { id: 'cerrados', label: 'Resueltos' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {lista == null ? null : visibles.length ? visibles.map((f) => <Faltante key={f.id} f={f} onHecho={cargar} />) : (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 60, fontSize: 15 }}>
            {vista === 'abiertos' ? 'No hay faltantes sin resolver.' : 'Todavía no hay faltantes resueltos.'}
          </Text>
        )}
      </ScrollView>
    </>
  );
}
