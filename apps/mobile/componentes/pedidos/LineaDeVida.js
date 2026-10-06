// La línea de vida de un pedido en una sala, NATIVA — `LifecycleTimeline` del
// portal: Confirmado → Inicio → Listo → En ruta → Entregado → Llegada →
// Finalizado, y después los extras (la caja que faltó, cada reenvío y su
// llegada, la diferencia y su corrección). Cada paso con su día y hora, y la
// cara + el nombre corto de quien lo hizo.
//
// Los pasos salen del núcleo (`pasosDelPedido`), los mismos del portal. Igual
// que allá, el carril se desliza: siete pasos no entran en 390 puntos y
// comprimirlos deja de leerse.
//
// Entre paso y paso, cuánto tardó — y, como en el portal, la sala no ve los
// tiempos de Bodega ni Bodega los de la sala. Las pausas de la preparación van
// en píldoras ámbar con su motivo, quién y cuánto duró.
import { ScrollView, Text, View } from 'react-native';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { elapsed, fmtDia, fmtHM, fmtMin, PASO_DE_LA_ETAPA, pasosDelPedido } from '@nucleo/utils/tableroDePedidos';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { FONDO } from '../avisos/Piezas';
import Avatar from '../Avatar';

const ANCHO = 78;
const hoy = () => new Date().toDateString();

function Pausa({ p, quien, activa }) {
  const min = elapsed(p.pausado_at, p.reanudado_at ?? undefined);
  const de = quien(p.pausado_por);
  return (
    <View style={{ borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: activa ? `${MARCA.ambar}33` : FONDO, gap: 2 }}>
      <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '700' }}>
        {`${activa ? 'En pausa' : 'Pausa'} · ${fmtMin(min) ?? '—'}${p.razon ? ` · ${p.razon}` : ''}`}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
        {[`${fmtHM(p.pausado_at)}${de ? ` · ${shortEmployeeName(de)}` : ''}`,
          p.reanudado_at ? `reanudó ${fmtHM(p.reanudado_at)}${quien(p.reanudado_por) ? ` · ${shortEmployeeName(quien(p.reanudado_por))}` : ''}` : null].filter(Boolean).join('  →  ')}
      </Text>
    </View>
  );
}

export default function LineaDeVida({ row, etapa, quien, entrega = null, conductor = null, esSala = false, apoyoRecepcion = [] }) {
  const pasos = pasosDelPedido(row, { quien, entrega, conductor });
  const activo = PASO_DE_LA_ETAPA[etapa] ?? 0;
  const pausado = etapa === 'pausado';
  const pausas = row?.pauses ?? [];

  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
        {pasos.map((n, i) => {
          const extra = i >= 7;
          const hecho = n.time != null && (extra || n.isRutaNode || i < activo);
          const actual = !extra && !n.isRutaNode && i === activo;
          const futuro = !hecho && !actual;
          const sig = pasos[i + 1];
          const tramo = hecho && sig?.time ? fmtMin(elapsed(n.time, sig.time)) : null;
          const deBodega = ['confirmado', 'iniciado', 'preparado'].includes(n.key);
          const deSala = n.key === 'llegada' || n.key.startsWith('seg_llegada');
          const verTramo = !!tramo && (esSala ? !deBodega : !deSala);
          const color = actual && pausado ? MARCA.ambar : MARCA.violetaClaro;
          const otroDia = n.time && new Date(n.time).toDateString() !== hoy();
          return (
            <View key={n.key} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ width: ANCHO, alignItems: 'center', gap: 3 }}>
                <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: hecho ? color : actual ? 'transparent' : FONDO, borderWidth: actual ? 2 : 0, borderColor: color }}>
                  {hecho ? <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</Text> : null}
                  {actual && !pausado ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} /> : null}
                  {actual && pausado ? <Text style={{ color, fontSize: 9, fontWeight: '900' }}>II</Text> : null}
                </View>
                <Text style={{ color: futuro ? colorSistema.texto2 : colorSistema.texto, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
                  {actual && pausado ? 'Pausado' : n.label}
                </Text>
                {otroDia ? <Text style={{ color: colorSistema.texto, fontSize: 11, fontWeight: '700' }}>{fmtDia(n.time)}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 11, fontVariant: ['tabular-nums'] }}>{n.time ? fmtHM(n.time) : '——'}</Text>
                {n.emp ? (
                  <View style={{ alignItems: 'center', gap: 2, marginTop: 2 }}>
                    <Avatar empleado={n.emp} tamano={28} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 11, textAlign: 'center' }}>{shortEmployeeName(n.emp)}</Text>
                  </View>
                ) : null}
              </View>
              {i < pasos.length - 1 ? (
                <View style={{ width: verTramo ? 40 : 12, marginTop: 8, alignItems: 'center' }}>
                  <View style={{ height: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: hecho ? `${MARCA.violetaClaro}66` : FONDO }} />
                  {verTramo ? <Text style={{ color: colorSistema.texto2, fontSize: 10, fontWeight: '700', marginTop: 3 }}>{tramo}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {pausas.length ? (
        <View style={{ gap: 6 }}>
          {pausas.map((p, i) => <Pausa key={`${p.pausado_at}-${i}`} p={p} quien={quien} activa={pausado && i === pausas.length - 1 && !p.reanudado_at} />)}
        </View>
      ) : (row?.min_pausado_total ?? 0) > 0 ? (
        <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>{`En pausa ${fmtMin(row.min_pausado_total)} en total`}</Text>
      ) : null}
      {apoyoRecepcion.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700' }}>APOYÓ AL RECIBIR</Text>
          {apoyoRecepcion.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Avatar empleado={a} tamano={22} />
              <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{shortEmployeeName(a)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
