// Bitácoras — la pestaña «Registro diario» del portal, NATIVA y en vidrio. La
// misma información que la versión de teléfono del portal (TabHoy): las cuatro
// cifras del día, un bloque por momento con lo hecho y lo que falta, las áreas
// en pausa y la ronda para anotar. El Libro bajo receta también es nativo
// (`app/libro-receta.js`), igual que el Cierre de mes (`bitacoras-cierre`) y
// la Configuración (`bitacoras-config`).
//
// La sala va en el menú de filtros de la barra (sólo con alcance todas) y el
// día con el selector del sistema; la bitácora de mañana no existe, así que no
// se avanza de hoy.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { bloquesDeLaRonda, fetchBitacoraDia, pendientesDelDia } from '@nucleo/data/bitacoras';
import { momentosDelDia, resumenDelMomento, salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { rango12 } from '@nucleo/utils/hora';
import Ronda from '../componentes/bitacoras/Ronda';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Fecha from '../componentes/formulario/Fecha';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const VACIO = [];
const METRICAS = [
  { clave: 'abiertas', label: 'Tocan ahora', color: MARCA.ambar },
  { clave: 'vencidas', label: 'Se pasaron', color: MARCA.rojo },
  { clave: 'hechas', label: 'Anotadas hoy', color: MARCA.verde },
  { clave: 'desvios', label: 'Fuera de rango', color: MARCA.rojo },
];
const TONO = { warning: MARCA.ambar, danger: MARCA.rojo, success: MARCA.verde };

function Momento({ momento, areas, puedeAnotar, cerrado, onRonda }) {
  const r = resumenDelMomento(momento, areas);
  if (!r.bloques.length) return null;
  const color = TONO[r.tono] ?? (r.completo ? MARCA.verde : MARCA.azulClaro);
  return (
    <Vidrio radio={22}>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{momento.label}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{rango12(momento.desde, momento.hasta)}</Text>
          </View>
          <Pildora texto={`${r.hechos} de ${r.bloques.length}`} color={color} />
        </View>
        {r.bloques.map(({ area, bloque, tipo }, i) => {
          const listo = bloque.lectura || bloque.registro;
          return (
            <View key={`${area.id}-${tipo}-${bloque.clave}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Text style={{ width: 18, color: listo ? MARCA.verde : colorSistema.texto2, fontSize: 16, fontWeight: '800' }}>{listo ? '✓' : '○'}</Text>
              <Text numberOfLines={1} style={{ flex: 1, color: listo ? colorSistema.texto2 : colorSistema.texto, fontSize: 15, fontWeight: listo ? '400' : '600' }}>
                {area.nombre}{tipo === 'limpieza' ? <Text style={{ color: colorSistema.texto2 }}> · limpieza</Text> : null}
              </Text>
              {bloque.lectura ? (
                <Text style={{ fontWeight: '800', fontVariant: ['tabular-nums'], fontSize: 15, color: bloque.lectura.fuera_de_rango ? MARCA.rojo : colorSistema.texto }}>
                  {`${Number(bloque.lectura.temperatura)} °C`}
                </Text>
              ) : null}
            </View>
          );
        })}
        {puedeAnotar && !cerrado && !r.completo && (r.abiertos > 0 || r.vencidos > 0)
          ? <BotonGrande texto={`Anotar ${r.bloques.length - r.hechos}`} color={MARCA.azul} onPress={onRonda} /> : null}
      </View>
    </Vidrio>
  );
}

function Fila({ texto, onPress, primero }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{texto}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

export default function Bitacoras() {
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const puedeAnotar = hasPermission('bitacoras', 'can_edit');
  const alcanceTodas = getScope('bitacoras') === 'ALL';
  const miSala = salaDelUsuario(user);
  const [elegida, setSala] = useState(null);
  const sala = elegida ?? (miSala ? String(miSala) : '');
  const [fecha, setFecha] = useState(hoySV);
  const [dia, setDia] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enRonda, setEnRonda] = useState(false);

  const salas = useMemo(() => salasDeBitacora(branches), [branches]);
  const salaValida = Boolean(sala) && salas.some((o) => o.value === String(sala));
  const nombreSala = branches.find((b) => String(b.id) === String(sala))?.name || '';

  const cargar = useCallback(async () => {
    if (!sala) { setDia(null); setCargando(false); return; }
    setCargando(true);
    const { dia: d, error: e } = await fetchBitacoraDia(sala, fecha);
    setDia(d); setError(e); setCargando(false);
  }, [sala, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const areas = dia?.areas || VACIO;
  const activas = useMemo(() => areas.filter((a) => a.aplica_hoy !== false), [areas]);
  const enPausa = useMemo(() => areas.filter((a) => a.aplica_hoy === false), [areas]);
  const momentos = useMemo(() => momentosDelDia(activas), [activas]);
  const ronda = useMemo(() => bloquesDeLaRonda(dia), [dia]);
  const resumen = useMemo(() => pendientesDelDia(dia), [dia]);
  const cerrado = Boolean(dia?.cerrado);
  const esHoy = fecha === hoySV();

  const otras = [
    hasPermission('bitacoras_tab_libro', 'can_view') && { id: 'libro', label: 'Libro bajo receta', abrir: () => router.push({ pathname: '/libro-receta', params: { sala } }) },
    hasPermission('bitacoras_tab_cierre', 'can_view') && { id: 'cierre', label: 'Cierre de mes', abrir: () => router.push({ pathname: '/bitacoras-cierre', params: { sala, fecha } }) },
    hasPermission('bitacoras_configurar', 'can_edit') && { id: 'config', label: 'Configuración', abrir: () => router.push({ pathname: '/bitacoras-config', params: { sala } }) },
  ].filter(Boolean);

  const grupos = alcanceTodas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: miSala ? String(miSala) : sala, onCambiar: setSala, opciones: salas.map((o) => ({ id: o.value, label: o.label })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Bitácoras', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={cargando && !!dia} onRefresh={cargar} />}>
        <FiltrosActivos grupos={grupos} />
        {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 4 }}>{nombreSala}</Text> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Paso texto="‹" onPress={() => setFecha((f) => sumarDias(f, -1))} />
          <View style={{ flex: 1, alignItems: 'center' }}><Fecha valor={fecha} hasta={hoySV()} onCambiar={setFecha} /></View>
          <Paso texto="›" deshabilitado={esHoy} onPress={() => setFecha((f) => sumarDias(f, 1))} />
        </View>
        {!esHoy ? <Pressable onPress={() => setFecha(hoySV())} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}><Text style={{ color: colorSistema.acento, fontSize: 15 }}>Volver a hoy</Text></Pressable> : null}

        {!salaValida ? (
          <Aviso tono="cuidado" texto={!sala ? 'Elige una sucursal para ver su bitácora.' : `${nombreSala || 'Esa sucursal'} no almacena medicamentos, así que no lleva bitácora de ambiente.`} />
        ) : cargando && !dia ? (
          <ActivityIndicator style={{ marginTop: 32 }} />
        ) : error ? (
          <Aviso tono="freno" texto={error.code === '42501' ? 'Tu cargo no tiene el módulo de bitácoras. Hay que otorgarlo en Permisos.' : (error.message || 'No se pudo cargar la bitácora.')} />
        ) : !areas.length ? (
          <Aviso tono="cuidado" texto="Esta sucursal todavía no tiene áreas. Se definen en Configuración." />
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {METRICAS.map((m) => (
                <View key={m.clave} style={{ width: '47%', flexGrow: 1 }}>
                  <Vidrio radio={18}>
                    <View style={{ padding: 12, gap: 2 }}>
                      <Text style={{ color: m.color, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{resumen[m.clave]}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{m.label}</Text>
                    </View>
                  </Vidrio>
                </View>
              ))}
            </View>
            {cerrado ? <Aviso tono="cuidado" texto="El mes de este día ya se cerró: no se puede anotar." /> : null}
            {puedeAnotar && !cerrado && ronda.length > 0 ? <BotonGrande texto={`Pasar la ronda · ${ronda.length}`} color={MARCA.azul} onPress={() => setEnRonda(true)} /> : null}
            {momentos.map((m) => (
              <Momento key={m.clave} momento={m} areas={activas} puedeAnotar={puedeAnotar} cerrado={cerrado} onRonda={() => setEnRonda(true)} />
            ))}
            {enPausa.length ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
                {`Hoy no se lleva bitácora en ${enPausa.map((a) => a.nombre).join(', ')} — así está configurada el área. No cuentan como faltantes al cerrar el mes.`}
              </Text>
            ) : null}
          </>
        )}

        {otras.length ? (
          <Seccion titulo="Más">
            {otras.map((o, i) => <Fila key={o.id} primero={!i} texto={o.label} onPress={o.abrir} />)}
          </Seccion>
        ) : null}
      </ScrollView>
      {enRonda && dia ? (
        <Ronda fecha={dia.fecha} bloques={ronda} onCerrar={(cambio) => { setEnRonda(false); if (cambio) cargar(); }} />
      ) : null}
    </>
  );
}

function Paso({ texto, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}
