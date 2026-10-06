// Las diferencias de un pedido en una sala, NATIVO y de SÓLO LECTURA — lo que
// muestra `DifSection` del portal: cada renglón con su clase (faltante,
// sobrante, dañado, vencido…), solicitado → enviado → contado, en qué punto va
// la conversación (contesta bodega, contesta la sala, lo ve supervisión,
// resuelta), la salida acordada y la actividad con quién y cuándo.
//
// Decidir —proponer, aceptar, escalar, devolver— sigue en el portal: acá se
// mira. Los rótulos y las cuentas salen del núcleo, los mismos de allá.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fetchOpcionesDiferencia, opcionElegida } from '@nucleo/data/diferencias';
import {
  cifrasDelRenglon, estadoDeDiferencia, EVENTO_DE_DIFERENCIA, fmtDia, fmtHM, RESOLUCION_DE_DIFERENCIA, TIPO_DE_DIFERENCIA,
} from '@nucleo/utils/tableroDePedidos';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { FONDO, Pildora } from '../avisos/Piezas';
import Avatar from '../Avatar';

const COLOR_TIPO = { danger: MARCA.rojo, success: MARCA.verde, warning: MARCA.ambar, neutral: colorSistema.texto2 };

function Cifra({ rotulo, valor, color }) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>{rotulo}</Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor ?? '—'}</Text>
    </View>
  );
}

function Diferencia({ item, eventos, catalogo, quien }) {
  const [verActividad, setVerActividad] = useState(false);
  const tipo = TIPO_DE_DIFERENCIA[item.error_tipo] ?? TIPO_DE_DIFERENCIA.diferencia;
  const { solicitado, enviado, contado, delta } = cifrasDelRenglon(item);
  const estado = estadoDeDiferencia(item);
  const resuelta = item.resolucion_status === 'confirmada';
  const salida = item.resolucion_tipo
    ? (opcionElegida(catalogo, item.error_tipo, item.resolucion_tipo)?.rotulo ?? RESOLUCION_DE_DIFERENCIA[item.resolucion_tipo] ?? null)
    : null;
  const suyos = eventos.filter((e) => e.pedido_item_id === item.id);
  return (
    <View style={{ borderRadius: 16, backgroundColor: FONDO, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{item.products?.nombre ?? `Producto ${item.erp_product_id}`}</Text>
        <Pildora texto={tipo.label} color={COLOR_TIPO[tipo.variante] ?? MARCA.ambar} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
        {solicitado != null ? <Cifra rotulo="PEDIDO" valor={solicitado} color={colorSistema.texto2} /> : null}
        <Cifra rotulo="ENVIADO" valor={enviado} />
        <Text style={{ color: colorSistema.texto2, fontSize: 16, marginBottom: 2 }}>→</Text>
        <Cifra rotulo="CONTADO" valor={contado} color={delta == null || delta === 0 ? undefined : delta < 0 ? MARCA.rojo : MARCA.verde} />
        {delta != null && delta !== 0 ? <Pildora texto={delta < 0 ? `Faltan ${-delta}` : `${delta} de más`} color={delta < 0 ? MARCA.rojo : MARCA.verde} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pildora texto={estado} color={resuelta ? MARCA.verde : MARCA.ambar} />
        {salida ? <Pildora texto={salida} color={MARCA.azulClaro} /> : null}
      </View>
      {item.nota_diferencia ? <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{`“${item.nota_diferencia}”`}</Text> : null}
      {item.resolucion_nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{item.resolucion_nota}</Text> : null}
      {suyos.length ? (
        <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setVerActividad((v) => !v); }} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{verActividad ? 'Ocultar la actividad' : `Ver la actividad · ${suyos.length}`}</Text>
        </Pressable>
      ) : null}
      {verActividad ? suyos.map((ev) => {
        const p = quien(ev.hecho_por);
        const opcion = ev.resolucion_tipo ? (opcionElegida(catalogo, item.error_tipo, ev.resolucion_tipo)?.rotulo ?? RESOLUCION_DE_DIFERENCIA[ev.resolucion_tipo]) : null;
        return (
          <View key={ev.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Avatar empleado={p ?? { name: '?' }} tamano={24} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 13 }}>
                <Text style={{ fontWeight: '700' }}>{p ? shortEmployeeName(p) : 'Alguien'}</Text>
                {` ${EVENTO_DE_DIFERENCIA[ev.tipo] ?? 'anotó un cambio'}${opcion ? `: ${opcion}` : ''}`}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${fmtDia(ev.created_at)} · ${fmtHM(ev.created_at)}`}</Text>
              {ev.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`“${ev.nota}”`}</Text> : null}
            </View>
          </View>
        );
      }) : null}
    </View>
  );
}

export default function Diferencias({ items, eventos = [], quien }) {
  const [catalogo, setCatalogo] = useState({});
  useEffect(() => {
    let vivo = true;
    fetchOpcionesDiferencia().then((c) => { if (vivo) setCatalogo(c); });
    return () => { vivo = false; };
  }, []);
  if (!items?.length) return null;
  const abiertas = items.filter((d) => d.resolucion_status !== 'confirmada');
  const orden = [...abiertas, ...items.filter((d) => d.resolucion_status === 'confirmada')];
  return (
    <View style={{ gap: 10 }}>
      {abiertas.length ? (
        <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>
          {`${abiertas.length} sin resolver. Proponer o aceptar una salida se hace en el portal.`}
        </Text>
      ) : <Text style={{ color: MARCA.verde, fontSize: 13, fontWeight: '600' }}>{items.length === 1 ? 'La diferencia está resuelta.' : `Las ${items.length} diferencias están resueltas.`}</Text>}
      {orden.map((d) => <Diferencia key={d.id} item={d} eventos={eventos} catalogo={catalogo} quien={quien} />)}
    </View>
  );
}
