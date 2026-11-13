// Faltantes de bolsa, NATIVO — la pestaña Faltantes de Traslados en el portal
// (`FilasFaltante.jsx`): lo que no llegó en una bolsa y todavía no se aclara.
// Se cierra con «Apareció» (la sala) o «No apareció» (SÓLO supervisión, desde
// el 2026-11-12: dice a cargo de quién queda y el sistema lo descuenta de la
// sala que recibió). Si alguien ya lo había cerrado, se dice.
// «Apareció» en un envío marcado «no llegó» RECIBE el movimiento (lo resuelve
// `cerrarFaltante`); lo que se cerró así sin recibirse lo marca
// `falta_ingresar` y se ingresa con su propio botón.
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { Stack, useFocusEffect } from 'expo-router';
import { cerrarFaltante, fetchFaltantes, ingresarAparecido, RESPONSABLES_DE_FALTANTE } from '@nucleo/data/faltantes';
import { useStaffStore } from '@nucleo/store/staffStore';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { filtrar } from '@nucleo/utils/busqueda';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const ESTADO = { abierto: ['Sin resolver', MARCA.rojo], aparecio: ['Apareció', MARCA.verde], no_aparecio: ['No apareció', MARCA.ambar] };

// A quién se le carga: búsqueda corta sobre el personal activo. Seis
// resultados alcanzan — se escribe el nombre, no se recorre la lista.
function ElegirPersona({ elegida, onElegir }) {
  const empleados = useStaffStore((s) => s.employees);
  const [q, setQ] = useState('');
  const activos = useMemo(() => (empleados || []).filter((e) => e.status === 'ACTIVO'), [empleados]);
  const vistos = q.trim() ? filtrar(q, activos, (e) => [e.name]).resultados.slice(0, 6) : [];
  const actual = activos.find((e) => e.id === elegida);
  if (actual) {
    return (
      <Pressable onPress={() => onElegir('')} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>
          {`${shortEmployeeName(actual.name)} · cambiar`}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <Campo value={q} onChangeText={setQ} placeholder="¿Quién? Escribe el nombre" />
      {vistos.map((e) => (
        <Pressable key={e.id} onPress={() => { onElegir(e.id); setQ(''); }} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: colorSistema.acento, fontSize: 15 }}>{shortEmployeeName(e.name)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Faltante({ f, onHecho, supervisa }) {
  const [cerrando, setCerrando] = useState(false);
  const [nota, setNota] = useState('');
  const [responsable, setResponsable] = useState('origen');
  const [persona, setPersona] = useState('');
  const abierto = f.estado === 'abierto';
  const [rotulo, color] = ESTADO[f.estado] ?? [f.estado, MARCA.azulClaro];
  const cerrar = async (estado) => {
    trabajando(estado === 'aparecio' ? 'Cerrando el faltante…' : 'Descontando…');
    const r = await cerrarFaltante(f.id, estado, nota,
      estado === 'no_aparecio' ? { responsable, responsable_employee_id: responsable === 'persona' ? persona : null } : null);
    if (!r.ok) { fallo('No se pudo cerrar', r.error); if (r.codigo === 'YA_CERRADO') onHecho(); return; }
    listo(estado === 'aparecio' ? 'Apareció' : 'Cerrado y descontado', f.descripcion);
    onHecho();
  };
  const ingresar = async () => {
    trabajando('Ingresando a inventario…');
    const r = await ingresarAparecido(f);
    if (!r.ok) { fallo('No se pudo ingresar', r.error); return; }
    listo('Ingresado a inventario', f.descripcion);
    onHecho();
  };
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{f.descripcion}</Text>
            <Text style={{ color: MARCA.rojo, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`−${f.cantidad}`}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${f.origen_branch_name ?? '—'} → ${f.destino_branch_name ?? '—'}${f.codigo_bolsa ? ` · paquete ${f.codigo_bolsa}` : ''}${f.declarado_at ? ` · ${fechaTexto(String(f.declarado_at).slice(0, 10), { day: 'numeric', month: 'short' })}` : ''}${f.declarado_por_nombre ? ` · ${f.declarado_por_nombre}` : ''}`}
          </Text>
          {f.nota ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{f.nota}</Text> : null}
          {!abierto ? <Pildora texto={`${rotulo}${f.resuelto_por_nombre ? ` · ${f.resuelto_por_nombre}` : ''}`} color={color} /> : null}
          {f.resolucion ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Se resolvió: ${f.resolucion}`}</Text> : null}
          {f.estado === 'no_aparecio' && f.responsable_nombre ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
              {`A cargo de ${f.responsable === 'persona' ? shortEmployeeName(f.responsable_nombre) : f.responsable_nombre}`}
            </Text>
          ) : null}
          {abierto && f.incierto ? (
            <Aviso tono="freno" texto={`El descuento anterior quedó sin confirmar. Antes de volver a cerrarlo hay que revisar el movimiento de ${f.destino_branch_name ?? 'la sala'}.`} />
          ) : abierto && f.ajuste_error ? (
            <Aviso tono="freno" texto={`El último intento de cerrarlo no pasó: ${f.ajuste_error}`} />
          ) : null}
          {!abierto && f.falta_ingresar ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>
                {`Apareció, pero todavía no entró al inventario de ${f.destino_branch_name ?? 'la sala'}.`}
              </Text>
              <BotonGrande texto="Ingresar a inventario" color={MARCA.verde} onPress={ingresar} />
            </View>
          ) : null}
          {abierto && !cerrando && f.en_curso ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Supervisión lo está cerrando…</Text>
          ) : null}
          {abierto && !cerrando && !f.en_curso ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Apareció" color={MARCA.verde} onPress={() => cerrar('aparecio')} /></View>
                {supervisa ? (
                  <View style={{ flex: 1 }}><BotonGrande texto="No apareció" borde color={MARCA.ambar} deshabilitado={f.incierto} onPress={() => setCerrando(true)} /></View>
                ) : null}
              </View>
              {!supervisa ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si no aparece, lo cierra supervisión.</Text> : null}
            </View>
          ) : null}
          {abierto && cerrando ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>¿A cargo de quién queda?</Text>
              {/* Tres botones y no `Segmentos`: es una elección del formulario,
                  no las secciones de la pantalla (esas van en FijoArriba). */}
              {RESPONSABLES_DE_FALTANTE.map((r) => (
                <BotonGrande key={r.valor} texto={r.rotulo} color={MARCA.azulClaro} borde={responsable !== r.valor}
                  onPress={() => { setResponsable(r.valor); if (r.valor !== 'persona') setPersona(''); }} />
              ))}
              {responsable === 'persona' ? <ElegirPersona elegida={persona} onElegir={setPersona} /> : null}
              <Campo value={nota} onChangeText={setNota} placeholder="¿Qué se averiguó? Ej.: no estaba en ninguna sala" />
              <Aviso tono="cuidado" texto={`Se descontará ${f.cantidad} de ${f.descripcion ?? 'este producto'} del inventario de ${f.destino_branch_name ?? 'la sala que recibió'}${f.en_transito ? ', después de recibir lo que quedó en camino' : ''}.`} />
              <BotonGrande texto="Cerrar y descontar" color={MARCA.ambar}
                deshabilitado={!nota.trim() || (responsable === 'persona' && !persona)} onPress={() => cerrar('no_aparecio')} />
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
  const [supervisa, setSupervisa] = useState(false);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('abiertos');
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    const { faltantes, error: e, supervisa: s } = await fetchFaltantes();
    setError(e ? 'No se pudieron cargar los faltantes.' : null);
    setLista(faltantes || []);
    setSupervisa(s === true);
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const abiertos = (lista || []).filter((f) => f.estado === 'abierto');
  const visibles = vista === 'abiertos' ? abiertos : (lista || []).filter((f) => f.estado !== 'abierto');
  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Faltantes' }} />
      <FijoArriba>
        <Segmentos activa={vista} onCambiar={setVista}
          opciones={[{ id: 'abiertos', label: 'Sin resolver' }, { id: 'cerrados', label: 'Resueltos' }]} />
      </FijoArriba>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 40 }}
        contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {lista == null ? null : visibles.length ? visibles.map((f) => <Faltante key={f.id} f={f} onHecho={cargar} supervisa={supervisa} />) : (
          <Vacio titulo={vista === 'abiertos' ? 'No hay faltantes sin resolver.' : 'Todavía no hay faltantes resueltos.'} />
        )}
      </ScrollView>
    </>
  );
}
