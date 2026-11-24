// Un renglón de la compra armada, NATIVO — la tarjeta de cada producto en la
// `Propuesta` del portal: qué producto es y de dónde salió, cómo se carga
// (presentación o unidades), lote, vencimiento, precio regular, si llegó todo,
// lo que va a vencidos o a sucursales, y cómo entra después de revisar. Las
// cuentas son del núcleo (`@nucleo/utils/cargaDeCompra`); la pantalla dueña
// (`app/propuesta-compra/[id].js`) guarda los ajustes y decide.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { venceCorto, venceTexto } from '@nucleo/utils/venceCorto';
import {
  MOTIVOS_VENCIDOS, cantidadSospechosa, cargarAyuda, cargarDe, nombreConTamano, nombrePres, presDelCatalogo, tamanoAprendible,
  unidadesQueEntran, unidadesQueLlegaron, vinetaActual,
  LOTE_VACIO, decisionDeRenglon, hayVariosLotes, lotesDelRenglon, problemaDeLotes, vencesDeDecision,
} from '@nucleo/utils/cargaDeCompra';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Campo, Ficha } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import BuscadorProducto from './BuscadorProducto';
import { Accion, CampoVence, Rotulo, fmtFecha } from './carga';

const ORIGEN = { codigo_barras: ['Código de barras', 'verde'], aprendido: ['Ya confirmado', 'verde'], parecido: ['Por parecido', 'ambar'] };
const r3 = (n) => Math.round(n * 1000) / 1000;
const nombreDe = (x) => x.nombre ?? (x.factor > 1 ? 'CAJA' : 'UNIDAD');
const Nota = ({ children, color, fuerte = true }) => <Text style={{ color: color ?? colorSistema.texto2, fontSize: 13, fontWeight: fuerte ? '700' : '400' }}>{children}</Text>;

/** Una nota con una acción a la derecha (sugerencias de la revisión). */
function Sugerencia({ texto, color, accion, onPress }) {
  return (
    <View style={{ gap: 2, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <Nota color={color} fuerte={false}>{texto}</Nota>
      <Accion texto={accion} onPress={onPress} />
    </View>
  );
}

/** «Se carga como»: la presentación de Bodega, o «Otra cantidad» en unidades. */
function SeCargaComo({ r, aj, presentaciones, juicio, puedeEditar, onCargar }) {
  const cant = Number(r.cantidad) || 0;
  const f = Number(aj.factor) || 0;
  const unidades = aj.cargar ?? cargarDe(r, aj.factor);
  const pres = [...presentaciones].filter((x) => x.factor > 0).sort((a, b) => a.factor - b.factor);
  const coincide = pres.some((x) => x.factor === f);
  const [otra, setOtra] = useState(false);
  const abierta = otra || !coincide || pres.length === 0;
  const aviso = cargarAyuda(r, aj);
  const u = Number(unidades) || 0;
  let linea;
  if (!abierta || pres.length === 0) {
    linea = (
      <>
        <Nota fuerte={false}>{`Entran ${u} ${u === 1 ? 'unidad' : 'unidades'}${f > 1 && Number.isInteger(r3(f)) ? ` · ${r3(f)} por cada una` : ''}`}</Nota>
        {aviso ? <Nota color={MARCA.ambar}>{aviso}</Nota> : null}
      </>
    );
  } else if (!(u > 0)) linea = <Nota fuerte={false}>Escribe cuántas unidades entran en total.</Nota>;
  else if (!Number.isInteger(r3(f))) {
    const abajo = Math.floor(f) * cant, arriba = Math.ceil(f) * cant;
    linea = <Nota color={MARCA.rojo}>{u < cant
      ? `La factura cobra ${r3(cant)}: se cargan las ${r3(cant)}. Si llegaron ${u}, márcalo en «¿Llegó todo? → Faltó».`
      : `${u} no se reparte entre las ${r3(cant)} de la factura (saldrían ${Math.round(f * 100) / 100} por cada una). Tiene que ser múltiplo de ${r3(cant)}: ${abajo > 0 ? `${abajo} o ` : ''}${arriba}.`}</Nota>;
  } else {
    const exacta = pres.find((x) => x.factor === r3(f));
    const suelta = pres.find((x) => x.factor === 1);
    linea = exacta ? <Nota fuerte={false}>{`Entra como ${r3(cant)} × ${nombreDe(exacta)} (${exacta.factor}) · ${u} unidades`}</Nota>
      : suelta ? <Nota fuerte={false}>{`Entran ${u} × ${nombreDe(suelta)} · ${r3(f)} por cada una de la factura`}</Nota>
      : <Nota color={MARCA.rojo}>{`No se puede cargar así. Este producto solo se vende como ${pres.map((x) => `${nombreDe(x)} (${x.factor})`).join(', ')}, y ${u} unidades no caben en ninguna. Elige una de la lista o pide que creen la presentación de 1 unidad.`}</Nota>;
  }
  const tam = Number(r.tamano_factura) || null;
  const fr = r3(f);
  const ojo = !(fr > 1) ? null
    : tam && fr !== tam && juicio?.aviso ? `Ojo: la factura dice caja de ${tam}, y aquí van ${fr} por cada una.`
    : !tam && pres.length > 0 && !pres.some((x) => x.factor === fr) ? `Ojo: Bodega no vende de a ${fr}. Revisa que cada una de la factura traiga ${fr}.` : null;
  return (
    <View style={{ gap: 6 }}>
      <Rotulo>Se carga como</Rotulo>
      {pres.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {pres.map((x) => (
            <Ficha key={x.factor} texto={`${r3(cant)} × ${nombreDe(x)} (${x.factor})`} activa={!abierta && f === x.factor} deshabilitada={!puedeEditar}
              onPress={() => { setOtra(false); onCargar(String(cant * x.factor)); }} />
          ))}
          <Ficha texto="Otra cantidad" activa={abierta} deshabilitada={!puedeEditar} onPress={() => setOtra(true)} />
        </View>
      ) : null}
      {abierta ? <Campo multiline={false} keyboardType="number-pad" editable={puedeEditar} placeholder="Unidades que entran" value={String(unidades)} onChangeText={onCargar} /> : null}
      {linea}
      {ojo ? <Nota color={MARCA.ambar}>{ojo}</Nota> : null}
    </View>
  );
}

/** ¿Llegó todo lo facturado? Sólo con «Faltó» se pide cuántas llegaron. */
function Llegaron({ total, valor, onChange, puedeEditar }) {
  const conNumero = valor !== '' && valor != null;
  const [falto, setFalto] = useState(conNumero);
  const n = conNumero ? Number(valor) : null;
  return (
    <View style={{ gap: 6 }}>
      <Rotulo>¿Llegó todo?</Rotulo>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Ficha texto="Sí, todo" activa={!falto} deshabilitada={!puedeEditar} onPress={() => { setFalto(false); onChange(''); }} />
        <Ficha texto="Faltó" activa={falto} deshabilitada={!puedeEditar} onPress={() => setFalto(true)} />
      </View>
      {falto ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 100 }}><Campo multiline={false} keyboardType="number-pad" editable={puedeEditar} placeholder="0" value={valor ?? ''} onChangeText={(v) => onChange(v.replace(/[^\d]/g, ''))} /></View>
          <Nota fuerte={false}>{`llegaron, de ${total}`}</Nota>
        </View>
      ) : null}
      {falto && n != null && n < total ? <Nota color={MARCA.ambar}>{`Faltan ${total - n}. Quedan «por llegar».`}</Nota> : null}
    </View>
  );
}

/** «A vencidos de Bodega»: todas o algunas unidades, con motivo obligatorio. */
function AVencidos({ valor, total, onChange, puedeEditar }) {
  const poner = (k, v) => onChange({ ...valor, [k]: v });
  const n = Number(valor.unidades);
  const algunas = valor.modo === 'algunas';
  const malo = algunas && valor.unidades !== '' && (!Number.isInteger(n) || n < 1 || n > total);
  return (
    <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Rotulo>A vencidos de Bodega</Rotulo>
        {puedeEditar ? <Accion texto="Quitar" color={colorSistema.texto2} onPress={() => onChange(null)} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Ficha texto={`Todas (${total})`} activa={!algunas} deshabilitada={!puedeEditar} onPress={() => poner('modo', 'todo')} />
        <Ficha texto="Algunas" activa={algunas} deshabilitada={!puedeEditar} onPress={() => poner('modo', 'algunas')} />
      </View>
      {algunas ? <Campo multiline={false} keyboardType="number-pad" placeholder={`Unidades, de ${total}`} value={valor.unidades} onChangeText={(v) => poner('unidades', v.replace(/[^\d]/g, ''))} /> : null}
      <Rotulo>Motivo</Rotulo>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {MOTIVOS_VENCIDOS.map((m) => <Ficha key={m.value} texto={m.label} activa={valor.motivo === m.value} deshabilitada={!puedeEditar} onPress={() => poner('motivo', m.value)} />)}
      </View>
      {valor.motivo === 'otro' ? <Campo multiline={false} maxLength={200} placeholder="Escribe el motivo" value={valor.detalle} onChangeText={(v) => poner('detalle', v)} /> : null}
      {malo ? <Nota color={MARCA.rojo}>{`Tiene que ser un número entero entre 1 y ${total}.`}</Nota> : null}
      <Nota fuerte={false}>{`Se carga con su nombre y, al terminar, ${algunas && n > 0 ? `${n} ${n === 1 ? 'unidad pasa' : 'unidades pasan'}` : 'todas pasan'} al área de vencidos de Bodega. Queda en «Productos erróneos» con su motivo.`}</Nota>
    </View>
  );
}

/**
 * Varios lotes en un renglón (2026-11-24): el primero es el de Lote/Vence de
 * arriba y se queda con el resto, así el total cuadra con la factura.
 */
function OtrosLotes({ r, aj, onChange, puedeEditar }) {
  const lotes = lotesDelRenglon(r, aj);
  if (!lotes) return null;
  const problema = problemaDeLotes(r, aj);
  const total = lotes.reduce((a, l) => a + l.unidades, 0);
  const poner = (k, cambio) => onChange(aj.otrosLotes.map((l, j) => (j === k ? { ...l, ...cambio } : l)));
  return (
    <View style={{ gap: 8 }}>
      <Nota fuerte={false}>{`Lote 1${aj.lote ? ` (${aj.lote})` : ''}: ${Math.max(lotes[0].unidades, 0)} unidades, el resto de las ${total}.`}</Nota>
      {aj.otrosLotes.map((l, k) => (
        <View key={k} style={{ gap: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Rotulo>{`Lote ${k + 2}`}</Rotulo>
            {puedeEditar ? <Accion texto="Quitar" color={colorSistema.texto2} onPress={() => { const n = aj.otrosLotes.filter((_, j) => j !== k); onChange(n.length ? n : undefined); }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1.3, gap: 4 }}><Rotulo>Lote</Rotulo><Campo multiline={false} editable={puedeEditar} autoCapitalize="characters" value={l.lote} onChangeText={(v) => poner(k, { lote: v })} /></View>
            <View style={{ flex: 1, gap: 4 }}><Rotulo>Vence</Rotulo><CampoVence editable={puedeEditar} valor={l.vence} onCambiar={(v) => poner(k, { vence: v })} /></View>
            <View style={{ flex: 0.8, gap: 4 }}><Rotulo>Unidades</Rotulo><Campo multiline={false} keyboardType="number-pad" editable={puedeEditar} value={l.unidades} onChangeText={(v) => poner(k, { unidades: v.replace(/[^\d]/g, '') })} /></View>
          </View>
        </View>
      ))}
      {problema ? <Nota color={MARCA.rojo}>{problema}</Nota> : null}
    </View>
  );
}

/** «Enviar a sucursales»: cuánto va a cada farmacia, en la presentación elegida. */
function RepartoASalas({ salas, total, valor, presentaciones, onChange, puedeEditar }) {
  if (!valor) return null;
  const pres = presDelCatalogo(presentaciones);
  const por = Number(valor.por) || 1;
  const cuantas = Object.entries(valor).filter(([b]) => b !== 'por').reduce((t, [, v]) => t + (Number(v) || 0), 0);
  const suma = cuantas * por;
  const quedan = total - suma;
  const elegida = pres.find((x) => x.factor === por);
  const enPres = (k) => (por > 1 && elegida ? `${k} × ${nombrePres(elegida)} = ${k * por} unidades` : `${k}`);
  return (
    <View style={{ gap: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Rotulo>Enviar a sucursales</Rotulo>
        {puedeEditar ? <Accion texto="No enviar" color={colorSistema.texto2} onPress={() => onChange(null)} /> : null}
      </View>
      {pres.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {pres.map((x) => <Ficha key={x.factor} texto={nombrePres(x)} activa={por === x.factor} deshabilitada={!puedeEditar} onPress={() => onChange({ ...valor, por: x.factor })} />)}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {salas.map((sala) => (
          <View key={sala.id} style={{ width: '31%', gap: 2 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={1}>{sala.name}</Text>
            <Campo multiline={false} keyboardType="number-pad" editable={puedeEditar} placeholder="0" value={valor[sala.id] ?? ''}
              onChangeText={(v) => onChange({ ...valor, [sala.id]: String(v).replace(/[^\d]/g, '') })} />
          </View>
        ))}
      </View>
      {suma > 0 ? (
        <Nota color={quedan < 0 ? MARCA.rojo : quedan > 0 ? MARCA.ambar : colorSistema.texto2}>
          {quedan < 0 ? `Se envían ${enPres(cuantas)} y entran ${total}: no se puede enviar más de lo que entra.`
            : quedan > 0 ? `Se envían ${enPres(cuantas)} · quedan ${quedan} unidades en Bodega.`
            : `Se envían ${enPres(cuantas)}: no queda nada en Bodega.`}
        </Nota>
      ) : null}
    </View>
  );
}

/** Cómo entra después de revisar: unidades, costo contra el anterior y margen. */
function ComoEntra({ sim, costo }) {
  const cambio = costo?.cambio;
  const parejo = cambio == null || Math.abs(cambio) < 0.5;
  const notaCosto = costo?.antes == null ? 'sin costo anterior' : parejo ? 'igual que antes'
    : `${cambio > 0 ? 'sube' : 'baja'} ${Math.abs(cambio).toFixed(1)} % · antes ${formatMoney(costo.antes, { decimales: 4 })}`;
  return (
    <View style={{ gap: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
      <Nota color={colorSistema.texto}>{`Entran al inventario: ${sim.existencias} unidades`}</Nota>
      {sim.vence_pendiente ? <Nota fuerte={false}>El vencimiento lo pone la sucursal.</Nota> : null}
      {costo ? (
        <>
          <Text style={{ color: colorSistema.texto, fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {`Costo por unidad ${formatMoney(costo.nuevo, { decimales: 4 })} · `}
            <Text style={{ color: parejo ? colorSistema.texto2 : cambio > 0 ? MARCA.ambar : MARCA.verde }}>{notaCosto}</Text>
          </Text>
          <Text style={{ color: colorSistema.texto, fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {`Precio regular ${formatMoney(costo.venta)}`}
            {costo.ventaAntes > 0 && Math.abs(costo.venta - costo.ventaAntes) >= 0.005 ? <Text style={{ color: MARCA.ambar, fontWeight: '700' }}>{` antes ${formatMoney(costo.ventaAntes)}`}</Text> : null}
            <Text style={{ color: costo.alerta ? MARCA.rojo : colorSistema.texto2 }}>{` · ${costo.margen != null ? `margen ${Math.round(costo.margen)} %` : 'sin margen'}${costo.alerta ? ` · ${costo.alerta.label}` : ''}`}</Text>
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * Props: `r`, `i`, `aj` (ajuste), `elegido`, `uso`, `puedeEditar`, `conProducto`,
 * `vinetas`, `juicio`, `sim`, `costo`, `salas`, `guardando`, `buscando`, `duda`,
 * y las acciones de la pantalla (`on*`).
 */
export default function RenglonDeCarga(props) {
  const { r, aj, elegido, uso, puedeEditar, conProducto, vinetas, juicio, sim, costo, salas, guardando, buscando, duda, factorCambio } = props;
  const o = ORIGEN[elegido ? 'aprendido' : r.match_origen] ?? null;
  const venta = uso === 'venta';
  const total = unidadesQueEntran(r, aj);
  const llegan = unidadesQueLlegaron(r, aj);
  const pres = presDelCatalogo(vinetas);
  const cambioPres = !!juicio?.aviso;
  const tam = Number(r.tamano_factura) || null;
  const difs = elegido ? elegido.numeros : r.numeros_distintos;
  const actual = vinetaActual(r, aj, sim, vinetas);
  const nueva = Number(aj.venta);
  const cambiaVineta = nueva > 0 && actual != null && Math.abs(nueva - actual) >= 0.005;
  const saldo = elegido && 'saldo' in elegido ? elegido.saldo : (elegido && elegido.product_id !== r.producto_id ? null : r.saldo_sugerido);
  const sospecha = sim?.linea ? cantidadSospechosa(sim, costo) : null;
  const raro = !tamanoAprendible(aj.factor, vinetas, r);
  const venceProximo = vencesDeDecision(decisionDeRenglon(aj, null, r)).sort()[0];
  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>
          {uso === 'consumo' || aj.servicio ? r.descripcion : aj.erroneo && !conProducto ? 'PRODUCTO ERRONEO DE PROVEEDOR' : (elegido?.nombre ?? r.producto ?? 'Sin producto')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {venta && !aj.servicio && o ? <Pildora texto={`${elegido ? 'Confirmado' : o[0]}${r.match_origen === 'parecido' && !elegido && r.match_similitud != null ? ` · ${Math.round(r.match_similitud * 100)}%` : ''}`} color={elegido ? MARCA.verde : o[1] === 'verde' ? MARCA.verde : MARCA.ambar} /> : null}
          {r.parte ? <Pildora texto={`Parte ${r.parte.indice} de ${r.parte.total}`} color={MARCA.azulClaro} /> : null}
        </View>
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`${r.cantidad} × ${formatMoney(r.costo)} = ${formatMoney(Number(r.cantidad) * Number(r.costo))}`}</Text>
        {venta && !aj.servicio ? <Nota fuerte={false}>{`En la factura: ${r.descripcion}`}</Nota> : null}
        {venta && !aj.servicio && !aj.erroneo && conProducto && pres.length ? (
          <Nota fuerte={false}>{`${tam ? `La factura trae caja de ${tam} · ` : ''}En Bodega: ${pres.map(nombrePres).join(', ')}`}</Nota>
        ) : null}
        {venta && !aj.servicio && !aj.erroneo && conProducto && cambioPres ? (
          <Nota color={MARCA.ambar}>
            {`${juicio.aviso === 'confirmado'
              ? `Cambió la presentación. La factura trae caja de ${tam}, no de ${juicio.tamanoBodega}. Cargada así, cada unidad queda ${Math.round(Math.abs(juicio.sube))} % más ${juicio.sube > 0 ? 'cara' : 'barata'}.`
              : `¿Cambió la presentación? La factura trae caja de ${tam} y Bodega no la tiene.`} Si es así, hay que crear la presentación de ${tam}${nombreConTamano(elegido?.nombre ?? r.producto, tam) ? ` y cambiar el nombre del producto a «${nombreConTamano(elegido?.nombre ?? r.producto, tam)}»` : ''}.${pres.some((x) => x.factor === 1) ? ' Mientras tanto entra en unidades.' : ''}`}
          </Nota>
        ) : null}
        {venta && !aj.servicio && !aj.erroneo && difs?.length ? <Nota color={MARCA.ambar}>{`¿Es el mismo producto? ${difs.join(' · ')}.${!elegido ? ' Confírmalo o elige el correcto.' : ''}`}</Nota> : null}
        {venta && aj.servicio ? <Nota>Flete / servicio: suma al costo de la compra y a su total. No entra al inventario.</Nota> : null}
        {venta && !aj.servicio && !aj.erroneo && !conProducto && !r.producto_id ? <Nota color={MARCA.ambar}>No está en Bodega: ¿es nuevo, o es uno que ya tenemos con otro nombre? ¿O vino por error?</Nota> : null}
        {venta && aj.erroneo ? <Nota color={MARCA.rojo}>Error del proveedor: entra con la compra y pasa a Bodega de vencidos hasta que llegue la nota de crédito.</Nota> : null}
        {venta && !aj.servicio && !aj.erroneo && venceCorto(venceProximo) ? <Nota color={MARCA.ambar}>{`Vence en 6 meses o menos (${venceTexto(venceProximo)}).`}</Nota> : null}

        {venta && !aj.servicio ? (
          <View style={{ gap: 10, paddingTop: 4 }}>
            {r.parte ? <Nota color={colorSistema.texto}>{`Entran ${r.cantidad} unidades · ${r.parte.unidades} por cada una de la factura`}</Nota>
              : <SeCargaComo r={r} aj={aj} puedeEditar={puedeEditar} juicio={juicio} presentaciones={[...new Map(vinetas.map((x) => [x.factor, x])).values()]} onCargar={props.onCargar} />}
            {!r.parte && factorCambio && puedeEditar && Number.isInteger(Number(aj.factor)) ? (
              duda ? (
                <View style={{ gap: 2 }}>
                  <Nota color={MARCA.ambar}>{`Bodega no vende de a ${Number(aj.factor)}. ¿Seguro que cada una trae ${Number(aj.factor)}?`}</Nota>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Accion texto="Sí, guardar" color={MARCA.ambar} ocupado={guardando} onPress={props.onRecordar} />
                    <Accion texto="No" color={colorSistema.texto2} onPress={props.onSinDuda} />
                  </View>
                </View>
              ) : <Accion texto={`Siempre así: ${Number(aj.factor)} por cada una`} ocupado={guardando} onPress={raro ? props.onDudar : props.onRecordar} />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, gap: 4 }}><Rotulo>Lote</Rotulo><Campo multiline={false} editable={puedeEditar} autoCapitalize="characters" value={aj.lote} onChangeText={(v) => props.onAjustar('lote', v)} /></View>
              <View style={{ flex: 1, gap: 4 }}><Rotulo>Vence</Rotulo><CampoVence editable={puedeEditar} valor={aj.vence} onCambiar={(v) => props.onAjustar('vence', v)} /></View>
            </View>
            <View style={{ gap: 4 }}>
              <Rotulo>Precio regular ($)</Rotulo>
              <Campo multiline={false} keyboardType="decimal-pad" editable={puedeEditar && !aj.erroneo} placeholder={actual != null ? actual.toFixed(2) : 'sin cambio'}
                value={aj.venta ?? ''} onChangeText={(v) => props.onAjustar('venta', v.replace(/[^\d.]/g, ''))} />
              {cambiaVineta ? <Nota color={nueva > actual ? MARCA.ambar : MARCA.verde}>{`${nueva > actual ? 'Sube' : 'Baja'} ${Math.abs((nueva - actual) / actual * 100).toFixed(1)} % · antes ${formatMoney(actual)}`}</Nota> : null}
            </View>
            {!aj.erroneo ? <OtrosLotes r={r} aj={aj} puedeEditar={puedeEditar} onChange={(v) => props.onAjustar('otrosLotes', v)} /> : null}
            {!aj.erroneo ? <Llegaron puedeEditar={puedeEditar} total={total} valor={aj.llegaron} onChange={(v) => props.onAjustar('llegaron', v)} /> : null}
          </View>
        ) : null}

        {venta && conProducto && !aj.erroneo && !aj.servicio && aj.vencidos ? <AVencidos valor={aj.vencidos} puedeEditar={puedeEditar} total={llegan} onChange={(v) => props.onAjustar('vencidos', v)} /> : null}
        {venta && conProducto && !aj.erroneo && !aj.servicio ? <RepartoASalas salas={salas} puedeEditar={puedeEditar} total={llegan} presentaciones={vinetas} valor={aj.reparto} onChange={(v) => props.onAjustar('reparto', v)} /> : null}
        {sim?.linea && !aj.servicio ? <ComoEntra sim={sim} costo={costo} /> : null}
        {sim?.linea && puedeEditar && !aj.erroneo && !aj.servicio && costo?.sugerida && !sospecha ? (
          <Sugerencia color={MARCA.ambar} accion={`Usar ${formatMoney(costo.sugerida)}`} onPress={() => props.onAjustar('venta', costo.sugerida.toFixed(2))}
            texto={`El costo sube ${costo.cambio.toFixed(1)} % y la viñeta sigue en ${formatMoney(costo.ventaAntes)}. ¿La caja trae precio nuevo? Con el mismo margen de antes (${Math.round(costo.margenAntes)} %) sería ${formatMoney(costo.sugerida)}.`} />
        ) : null}
        {venta && puedeEditar && conProducto && !aj.servicio && !aj.erroneo && saldo && String(aj.cargar ?? '') !== String(saldo.unidades) ? (
          <Sugerencia accion={`Usar ${saldo.unidades}`} onPress={() => props.onCargar(String(saldo.unidades))}
            texto={`Sugerencia. Revisa que cuadre con la factura. El saldo se carga en unidades de $1 y la factura no dice cuántos dólares trae. Con lo pagado (${formatMoney(saldo.pagado)}) y el costo de la última compra${saldo.de?.mismo_proveedor ? ' a este proveedor' : ` (${saldo.de?.proveedor ?? 'otro proveedor'})`} (${formatMoney(saldo.costo_referencia, { decimales: 4 })} por cada $1, ${fmtFecha(saldo.de?.fecha)}), serían ${saldo.unidades}${saldo.exacto ? '' : ' aproximadamente'}.`} />
        ) : null}
        {sospecha && puedeEditar && !aj.servicio ? (
          <Sugerencia color={MARCA.rojo} accion={`Cargar ${sospecha.unidades}`} onPress={() => props.onCargar(String(sospecha.unidades))}
            texto={`El costo queda ${sospecha.veces} veces ${sospecha.sube ? 'más caro' : 'más barato'} que antes: casi siempre es la cantidad. ¿Entran ${sospecha.unidades} y no ${sim.existencias}?`} />
        ) : null}

        {venta && puedeEditar ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            {!aj.servicio && r.producto_id && !elegido && (r.match_origen === 'parecido' || r.numeros_distintos?.length > 0)
              ? <Accion texto="Es correcto" color={MARCA.verde} ocupado={guardando} onPress={props.onEsCorrecto} /> : null}
            {!aj.servicio && !conProducto && !aj.erroneo ? <Accion texto="Es nuevo" onPress={props.onEsNuevo} /> : null}
            {!aj.servicio && !r.parte ? <Accion texto={conProducto || r.producto_id ? 'Es otro producto' : 'Elegir producto'} ocupado={guardando} onPress={props.onBuscar} /> : null}
            {conProducto && !aj.erroneo && !aj.servicio && !aj.reparto && salas.length > 0
              ? <Accion texto="Enviar a sucursales" onPress={() => props.onAjustar('reparto', { por: pres.some((x) => x.factor === (Number(aj.factor) || 1)) ? (Number(aj.factor) || 1) : 1 })} /> : null}
            {!aj.erroneo && !aj.servicio && !aj.vencidos && (aj.otrosLotes?.length ?? 0) < 11
              ? <Accion texto="Otro lote" onPress={() => props.onAjustar('otrosLotes', [...(aj.otrosLotes ?? []), { ...LOTE_VACIO }])} /> : null}
            {conProducto && !aj.erroneo && !aj.servicio && !aj.vencidos && !hayVariosLotes(aj)
              ? <Accion texto="A vencidos" onPress={() => props.onAjustar('vencidos', { modo: 'todo', unidades: '', motivo: '', detalle: '' })} /> : null}
            {!aj.servicio && !aj.erroneo && (r.parte?.llave || r.llave || r.codigo_proveedor) && (!r.parte || r.parte.indice === 1)
              ? <Accion texto={r.parte ? 'Cambiar separación' : 'Separar en productos'} onPress={props.onPartir} /> : null}
            {!aj.servicio ? <Accion texto={aj.erroneo ? 'No es erróneo' : 'Producto erróneo'} color={aj.erroneo ? MARCA.azulClaro : colorSistema.texto2} onPress={props.onErroneo} /> : null}
            {!aj.erroneo ? <Accion texto={aj.servicio ? 'Es un producto' : 'Es flete / servicio'} color={colorSistema.texto2} onPress={() => props.onAjustar('servicio', !aj.servicio)} /> : null}
          </View>
        ) : null}
        {buscando ? <BuscadorProducto onElegir={props.onElegir} onCancelar={props.onBuscar} /> : null}
      </View>
    </Vidrio>
  );
}

