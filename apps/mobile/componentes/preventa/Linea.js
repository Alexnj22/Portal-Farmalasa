// Un producto de la preventa, como tarjeta — el `Linea` de `PreventaView` del
// portal: foto, nombre, Bajo Receta y existencia; de qué lote sale (con el
// cambio de lote); presentación, cantidad y precio; el subtotal, y si tiene un
// problema, qué pasa y qué hacer con sus botones. Las cuentas son del núcleo
// (`opcionesDePresentacion`, `opcionesDePrecio`, `planDeLotes`).
import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import {
  mesDeVencimiento, mismoLote, montoDelCorreo, nombreDeLista, opcionesDePrecio, opcionesDePresentacion, planDeLotes, vencePronto,
} from '@nucleo/utils/preventaDirecta';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { Presionable as Pressable } from '../Tocable';
import { MARCA } from '../inicio/marca';
import { Eleccion } from '../torogoz/venta/Piezas';
import { Pildora } from '../avisos/Piezas';
import IconoFijo from '../IconoFijo';
import FotoMiniatura from '../producto/Miniatura';
import { iconoDe } from '../../tema/iconos';

const conMayuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
// Las pistas de teclado del portal («(F3)») no van en el teléfono.
export const sinTeclas = (t) => String(t ?? '').replace(/\s*\((F\d+|Supr)\)/g, '');

export function Miniatura({ src, tamano = 44 }) {
  const [rota, setRota] = useState(false);
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      {src && !rota
        ? <FotoMiniatura uri={src} style={{ width: tamano, height: tamano }} onError={() => setRota(true)} />
        : <IconoFijo name={iconoDe('Package')} size={tamano * 0.45} color={colorSistema.texto2} />}
    </View>
  );
}

function Paso({ texto, onPress, deshabilitado, etiqueta }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} hitSlop={6}
      accessibilityRole="button" accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.35 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

export function BotonChico({ texto, onPress, color, deshabilitado }) {
  const c = color ?? MARCA.azulClaro;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} accessibilityRole="button" hitSlop={4}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center',
        backgroundColor: `${c}22`, opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color: c, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

// De qué lote sale: el primero (o los que hacen falta) a la vista, y al tocar,
// todos con lo que tiene cada uno. La caja usa primero GENERICO y después el
// que vence antes; elegir uno lo pide, si alcanza.
function Lotes({ lotes, cantidad, factor, presentacion, elegido, onElegir }) {
  if (!lotes?.length) return null;
  const hoy = hoySV();
  const vigente = lotes.some((l) => mismoLote(l, elegido)) ? elegido : null;
  const plan = planDeLotes(lotes, cantidad, factor, vigente);
  const usados = plan.lotes.filter((l) => l.enteras || l.sueltas);
  const primero = usados[0] ?? plan.lotes[0];
  const vencido = (l) => Boolean(l.vence) && l.vence < hoy;
  const cuando = (l) => (!l.vence ? 'sin fecha' : vencido(l) ? `venció ${mesDeVencimiento(l.vence)}` : `vence ${mesDeVencimiento(l.vence)}`);
  const color = (l) => (vencido(l) ? MARCA.rojo : vencePronto(l.vence, hoy) ? MARCA.ambar : colorSistema.texto2);
  const pres = String(presentacion || 'presentación').toLowerCase();
  const cuanto = (l) => [l.enteras ? `${l.enteras} ${pres}` : '', l.sueltas ? `${l.sueltas} u.` : ''].filter(Boolean).join(' + ');
  const f = Math.max(1, Number(factor) || 1);
  const aporte = (l) => {
    const p = planDeLotes(lotes, cantidad, factor, l).lotes.find((x) => mismoLote(x, l));
    return (p?.enteras ?? 0) + (p?.sueltas ?? 0);
  };
  const elegidoNoDa = Boolean(vigente) && !usados.some((l) => mismoLote(l, vigente));
  const elegidoNoAlcanza = Boolean(vigente) && (elegidoNoDa || usados.length > 1);
  const otros = usados.filter((l) => !mismoLote(l, vigente)).map((l) => l.lote);
  const nombresDe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '');
  const opciones = [
    { value: '', label: 'Automático · primero el que vence antes' },
    ...plan.lotes.map((l) => {
      const da = aporte(l);
      return {
        value: `${l.lote}|${l.vence ?? ''}`,
        label: `${l.lote} · ${cuando(l)} · ${l.unidades} u.${da === 0 ? ' · no completa' : ''}`,
        deshabilitada: da === 0 && !mismoLote(l, vigente),
      };
    }),
  ];
  return (
    <View style={{ gap: 4 }}>
      {(usados.length ? usados : [primero]).map((l) => (
        <Text key={`${l.lote}-${l.vence}`} style={{ fontSize: 13, color: colorSistema.texto2 }}>
          Lote <Text style={{ fontWeight: '800', color: colorSistema.texto }}>{l.lote}</Text>
          {' · '}<Text style={{ color: color(l), fontWeight: color(l) === colorSistema.texto2 ? '400' : '700' }}>{cuando(l)}</Text>
          {cuanto(l) ? <Text style={{ color: MARCA.azulClaro, fontWeight: '700' }}>{` · sale ${cuanto(l)}`}</Text> : null}
        </Text>
      ))}
      {plan.armada ? <Text style={{ fontSize: 12, color: MARCA.azulClaro, fontWeight: '700' }}>Armada con unidades de varios lotes</Text> : null}
      {elegidoNoAlcanza ? (
        <Text style={{ fontSize: 13, color: MARCA.ambar, fontWeight: '700' }}>
          {elegidoNoDa
            ? `El lote ${vigente.lote} no completa ${Number(cantidad) || 0} ${pres}. Sale del lote ${nombresDe(otros)}: trae ese.`
            : `El lote ${vigente.lote} no alcanza. Lo demás sale del lote ${nombresDe(otros)}: trae también ese.`}
        </Text>
      ) : null}
      {plan.faltan > 0 ? <Text style={{ fontSize: 13, color: MARCA.rojo, fontWeight: '700' }}>Con estos lotes no se completan {plan.faltan}.</Text> : null}
      {lotes.length > 1 ? (
        <Eleccion rotulo="Lote" valor={vigente ? `${vigente.lote}|${vigente.vence ?? ''}` : ''} opciones={opciones}
          mensaje={f > 1 ? `Por ${pres}` : 'Primero vence, primero sale.'}
          onCambiar={(v) => {
            if (!v) return onElegir(null);
            const [lote, vence] = String(v).split('|');
            return onElegir({ lote, vence: vence || null });
          }} />
      ) : null}
    </View>
  );
}

export default function Linea({ linea, fila, foto, lotes, cotizando, problema, puedeAutorizar, listaCliente, onCambiar, onQuitar, onResolver }) {
  const pres = opcionesDePresentacion(fila, linea);
  const cant = Number(linea.cantidad) || 0;
  const opciones = opcionesDePrecio(fila?.precios, fila?.lista_auto);
  const opcionesPrecio = opciones.map((o) => ({ value: o.lista, label: `${o.nombre} · ${formatMoney(o.precio)}` }));
  const listaElegida = (linea.lista && opciones.some((o) => o.lista === linea.lista) ? linea.lista : null)
    ?? fila?.lista ?? listaCliente ?? '';
  const nombre = fila?.nombre ?? linea.nombre;
  const malaCantidad = problema && (problema.tipo === 'existencia' || problema.tipo === 'cantidad');
  const conMonto = Boolean(fila?.cobro_con_monto);
  return (
    <Vidrio radio={20} tinte={problema ? `${MARCA.rojo}1A` : undefined}>
      <View style={{ padding: 14, gap: 10, borderLeftWidth: problema ? 3 : 0, borderLeftColor: MARCA.rojo }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Miniatura src={foto} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{nombre}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {fila?.bajo_receta ? <Pildora texto="Bajo Receta" color={MARCA.ambar} /> : null}
              {fila ? <Text style={{ fontSize: 13, color: malaCantidad ? MARCA.rojo : colorSistema.texto2, fontWeight: malaCantidad ? '700' : '400' }}>Existencia {fila.existencia}</Text> : null}
              {fila?.lista && !linea.lista && fila.lista !== listaCliente ? <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>· {nombreDeLista(fila.lista)} aquí</Text> : null}
            </View>
          </View>
          <Text style={{ color: cotizando ? colorSistema.texto2 : problema ? MARCA.rojo : colorSistema.texto, fontSize: 18, fontWeight: '900',
            fontVariant: ['tabular-nums'], textDecorationLine: problema ? 'line-through' : 'none' }}>{fila ? formatMoney(fila.subtotal) : '…'}</Text>
        </View>

        <Lotes lotes={lotes} cantidad={cant} factor={linea.factor} elegido={linea.lote}
          presentacion={fila?.tipo ?? pres.options.find((p) => p.value === pres.value)?.label}
          onElegir={(lote) => onCambiar({ lote })} />

        {pres.options.length > 1 ? (
          <Eleccion rotulo="Presentación" valor={pres.value} opciones={pres.options} onCambiar={(v) => onCambiar(pres.leer(v))} />
        ) : (
          <View style={{ flexDirection: 'row', minHeight: 32, alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Presentación</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{pres.options[0]?.label}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Cantidad</Text>
          <Paso texto="−" etiqueta="Una menos" deshabilitado={conMonto || cant <= 1} onPress={() => onCambiar({ cantidad: Math.max(1, cant - 1) })} />
          <Campo multiline={false} keyboardType="number-pad" value={String(linea.cantidad)} selectTextOnFocus editable={!conMonto}
            accessibilityLabel={`Cantidad de ${nombre}`} onChangeText={(t) => onCambiar({ cantidad: t.replace(/\D/g, '').slice(0, 3) })}
            style={{ width: 72, textAlign: 'center', fontWeight: '800', borderWidth: malaCantidad ? 1 : 0, borderColor: MARCA.rojo }} />
          <Paso texto="+" etiqueta="Una más" deshabilitado={conMonto} onPress={() => onCambiar({ cantidad: Math.min(999, cant + 1) })} />
        </View>

        {conMonto ? (
          // Un cobro con monto: lo escribe administración (neto + IVA), o pega el correo.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Monto (neto + IVA)</Text>
            <Campo multiline={false} keyboardType="decimal-pad" value={linea.monto ?? ''} placeholder="$0.00" accessibilityLabel={`Monto de ${nombre}`}
              onChangeText={(t) => {
                const m = montoDelCorreo(t);
                onCambiar({ monto: m ? m.monto : t.replace(/[^\d.]/g, '').replace(/^(\d{0,5})(\.\d{0,2})?.*$/, '$1$2') });
              }}
              style={{ width: 120, textAlign: 'right', borderWidth: problema?.tipo === 'precio' ? 1 : 0, borderColor: MARCA.rojo }} />
          </View>
        ) : fila && !opcionesPrecio.length ? (
          <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '700' }}>Sin precio</Text>
        ) : puedeAutorizar && opcionesPrecio.length > 1 ? (
          <Eleccion rotulo="Precio" valor={listaElegida} opciones={opcionesPrecio}
            onCambiar={(v) => onCambiar({ lista: !v || v === (fila?.lista_auto ?? (fila?.lista && !linea.lista ? fila.lista : listaCliente)) ? null : v })} />
        ) : (
          <View style={{ flexDirection: 'row', minHeight: 32, alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Precio</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 16, fontVariant: ['tabular-nums'] }}>
              {fila?.precio != null ? `${formatMoney(fila.precio)} · ${nombreDeLista(fila?.lista)}` : '…'}
            </Text>
          </View>
        )}

        {problema ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 14, lineHeight: 19 }}>
              <Text style={{ color: MARCA.rojo, fontWeight: '700' }}>{conMayuscula(sinTeclas(problema.titulo).replace(/^[^:]+:\s*/, ''))} </Text>
              <Text style={{ color: colorSistema.texto2 }}>{sinTeclas(problema.ayuda)}</Text>
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {problema.acciones.map((a) => (
                <BotonChico key={`${a.id}-${a.label}`} texto={a.label} color={a.id === 'quitar' ? MARCA.rojo : undefined} onPress={() => onResolver(problema, a)} />
              ))}
            </View>
          </View>
        ) : null}

        <Pressable onPress={onQuitar} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} accessibilityRole="button"
          accessibilityLabel={`Quitar ${nombre}`}>
          <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
        </Pressable>
      </View>
    </Vidrio>
  );
}
