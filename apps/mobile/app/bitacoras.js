// Bitácoras — la pestaña «Registro diario» del portal, NATIVA. Tiene la misma
// información que la versión de teléfono del portal (TabHoy): las cuatro
// cifras del día, un bloque por momento con lo hecho y lo que falta, las áreas
// en pausa y la ronda para anotar. Las otras pestañas (bajo receta, cierre,
// configuración) se abren como el portal, con la misma sesión.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { bloquesDeLaRonda, fetchBitacoraDia, pendientesDelDia } from '@nucleo/data/bitacoras';
import { momentosDelDia, resumenDelMomento, rotularDia, salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { rango12 } from '@nucleo/utils/hora';
import Boton from '../componentes/Boton';
import Ronda from '../componentes/bitacoras/Ronda';
import { Aviso, BotonChico, Insignia, Tarjeta, Texto, Titulo } from '../componentes/comunes';
import { useTema } from '../tema/tema';

const VACIO = [];
const METRICAS = [
  { clave: 'abiertas', label: 'Tocan ahora', color: 'avisoTexto' },
  { clave: 'vencidas', label: 'Se pasaron', color: 'peligroTexto' },
  { clave: 'hechas', label: 'Anotadas hoy', color: 'exitoTexto' },
  { clave: 'desvios', label: 'Fuera de rango', color: 'peligroTexto' },
];

function BandaDelMomento({ momento, areas, puedeAnotar, cerrado, onRonda }) {
  const t = useTema();
  const r = resumenDelMomento(momento, areas);
  if (!r.bloques.length) return null;
  return (
    <Tarjeta tono={r.tono || undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Titulo>{momento.label}</Titulo>
        <Texto tenue>{rango12(momento.desde, momento.hasta)}</Texto>
        <View style={{ flex: 1 }} />
        <Insignia tono={r.tono || undefined}>{r.hechos} de {r.bloques.length}</Insignia>
      </View>
      {r.bloques.map(({ area, bloque, tipo }) => {
        const listo = bloque.lectura || bloque.registro;
        return (
          <View key={`${area.id}-${tipo}-${bloque.clave}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 16, color: listo ? t.color.exitoTexto : t.color.texto3, fontWeight: '900' }}>{listo ? '✓' : '○'}</Text>
            <Text numberOfLines={1} style={{ flex: 1, color: listo ? t.color.texto3 : t.color.texto, fontWeight: listo ? '400' : '700', fontSize: t.texto.cuerpo + 2 }}>
              {area.nombre}{tipo === 'limpieza' ? <Text style={{ color: t.color.texto3 }}> · limpieza</Text> : null}
            </Text>
            {bloque.lectura ? (
              <Text style={{ fontWeight: '800', fontVariant: ['tabular-nums'], color: bloque.lectura.fuera_de_rango ? t.color.peligroTexto : t.color.texto2, fontSize: t.texto.cuerpo + 2 }}>
                {Number(bloque.lectura.temperatura)} °C
              </Text>
            ) : null}
          </View>
        );
      })}
      {puedeAnotar && !cerrado && !r.completo && (r.abiertos > 0 || r.vencidos > 0)
        ? <Boton onPress={onRonda}>Anotar {r.bloques.length - r.hechos}</Boton> : null}
    </Tarjeta>
  );
}

export default function Bitacoras() {
  const t = useTema();
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const puedeAnotar = hasPermission('bitacoras', 'can_edit');
  const alcanceTodas = getScope('bitacoras') === 'ALL';
  const miSala = salaDelUsuario(user);
  const [sala, setSala] = useState(miSala ? String(miSala) : '');
  const [fecha, setFecha] = useState(hoySV);
  const [dia, setDia] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [enRonda, setEnRonda] = useState(false);

  const salas = useMemo(() => salasDeBitacora(branches), [branches]);
  const salaValida = Boolean(sala) && salas.some(o => o.value === String(sala));
  const nombreSala = branches.find(b => String(b.id) === String(sala))?.name || '';

  const cargar = useCallback(async () => {
    if (!sala) { setDia(null); setCargando(false); return; }
    setCargando(true);
    const { dia: d, error: e } = await fetchBitacoraDia(sala, fecha);
    setDia(d); setError(e); setCargando(false);
  }, [sala, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const areas = dia?.areas || VACIO;
  const activas = useMemo(() => areas.filter(a => a.aplica_hoy !== false), [areas]);
  const enPausa = useMemo(() => areas.filter(a => a.aplica_hoy === false), [areas]);
  const momentos = useMemo(() => momentosDelDia(activas), [activas]);
  const ronda = useMemo(() => bloquesDeLaRonda(dia), [dia]);
  const resumen = useMemo(() => pendientesDelDia(dia), [dia]);
  const cerrado = Boolean(dia?.cerrado);
  const esHoy = fecha === hoySV();

  // Las otras pestañas, las que el cargo puede ver: se abren en el portal.
  const otras = [
    hasPermission('bitacoras_tab_libro', 'can_view') && { tab: 'libro', label: 'Libro bajo receta' },
    hasPermission('bitacoras_tab_cierre', 'can_view') && { tab: 'cierre', label: 'Cierre de mes' },
    hasPermission('bitacoras_configurar', 'can_edit') && { tab: 'config', label: 'Configuración' },
  ].filter(Boolean);

  return (
    <>
      <Stack.Screen options={{ title: 'Bitácoras' }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={cargando && !!dia} onRefresh={cargar} />}>
        {/* La sala: sólo quien ve todas las salas elige. */}
        {alcanceTodas ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {salas.map(o => {
              const activa = o.value === String(sala);
              return (
                <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: activa }} onPress={() => setSala(o.value)}
                  style={{ minHeight: t.tam.toque, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: activa ? t.color.marca : t.color.borde, backgroundColor: activa ? t.color.marca : t.color.tarjeta }}>
                  <Text style={{ color: activa ? '#fff' : t.color.texto, fontWeight: '700' }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {/* El día: la bitácora de mañana no existe, por eso no se avanza de hoy. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <BotonChico etiqueta="Día anterior" onPress={() => setFecha(f => sumarDias(f, -1))}>‹</BotonChico>
          <Text style={{ minWidth: 180, textAlign: 'center', color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 3 }}>{rotularDia(fecha)}</Text>
          <BotonChico etiqueta="Día siguiente" deshabilitado={esHoy} onPress={() => setFecha(f => sumarDias(f, 1))}>›</BotonChico>
          {!esHoy ? <BotonChico onPress={() => setFecha(hoySV())}>Hoy</BotonChico> : null}
        </View>

        {!salaValida ? (
          <Aviso tono="warning">{!sala ? 'Elige una sucursal para ver su bitácora.' : `${nombreSala || 'Esa sucursal'} no almacena medicamentos, así que no lleva bitácora de ambiente.`}</Aviso>
        ) : cargando && !dia ? (
          <ActivityIndicator color={t.color.marca} style={{ marginTop: 32 }} />
        ) : error ? (
          <Aviso tono="danger">{error.code === '42501' ? 'Tu cargo no tiene el módulo de bitácoras. Hay que otorgarlo en Permisos.' : (error.message || 'No se pudo cargar la bitácora.')}</Aviso>
        ) : !areas.length ? (
          <Aviso tono="warning">Esta sucursal todavía no tiene áreas. Se definen en Configuración.</Aviso>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {METRICAS.map(m => (
                <View key={m.clave} style={{ width: '48%', flexGrow: 1, padding: 12, borderRadius: t.radio.tarjeta, backgroundColor: t.color.tarjeta, borderWidth: 1, borderColor: t.color.borde }}>
                  <Texto tenue>{m.label}</Texto>
                  <Text style={{ color: t.color[m.color], fontSize: t.texto.titulo + 4, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{resumen[m.clave]}</Text>
                </View>
              ))}
            </View>
            {cerrado ? <Aviso tono="warning">El mes de este día ya se cerró: no se puede anotar.</Aviso> : null}
            {momentos.map(m => (
              <BandaDelMomento key={m.clave} momento={m} areas={activas} puedeAnotar={puedeAnotar} cerrado={cerrado} onRonda={() => setEnRonda(true)} />
            ))}
            {/* Las áreas de sólo limpieza cuyos turnos no caen en ningún momento
                de temperatura quedarían invisibles: su vuelta es la ronda. */}
            {puedeAnotar && !cerrado && ronda.length > 0 ? <Boton onPress={() => setEnRonda(true)}>Pasar la ronda · {ronda.length}</Boton> : null}
            {enPausa.length ? (
              <Texto tenue>Hoy no se lleva bitácora en {enPausa.map(a => a.nombre).join(', ')} — así está configurada el área. No cuentan como faltantes al cerrar el mes.</Texto>
            ) : null}
          </>
        )}

        {otras.length ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            {otras.map(o => (
              <Pressable key={o.tab} accessibilityRole="button"
                onPress={() => router.push({ pathname: '/portal', params: { ruta: `/bitacoras?tab=${o.tab}`, nombre: o.label } })}
                style={({ pressed }) => ({ minHeight: t.tam.toque + 4, paddingHorizontal: 14, justifyContent: 'center', borderRadius: t.radio.tarjeta, borderWidth: 1, borderColor: t.color.borde, backgroundColor: t.color.tarjeta, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: t.color.texto, fontWeight: '700', fontSize: t.texto.cuerpo + 2 }}>{o.label}  ›</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {enRonda && dia ? (
        <Ronda fecha={dia.fecha} bloques={ronda} onCerrar={(cambio) => { setEnRonda(false); if (cambio) cargar(); }} />
      ) : null}
    </>
  );
}
