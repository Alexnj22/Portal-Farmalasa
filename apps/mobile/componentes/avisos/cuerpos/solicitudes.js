// Las tarjetas de avisos del grupo «solicitudes y otros», en la app — port fiel
// de `TarjetasDeOperacion.jsx` del portal: la solicitud por decidir, la
// respuesta a un traslado o a un envío, lo que decidieron sobre una solicitud
// mía, la diferencia de un pedido, el conteo cíclico, el envío nocturno a
// Hacienda, las promociones, las metas por aprobar, el reinicio del sistema y
// los productos sin venta.
//
// Los datos salen de las MISMAS funciones del núcleo (`avisosDeOperacion`):
// si un aviso cambia de forma, la tarjeta del portal y la de la app se enteran
// juntas. Lo que acá se adapta es sólo la forma: las celdas de la grilla van
// de a pares, la que queda sola ocupa la fila, y el texto que no entra baja de
// renglón — nada se corta con «…».
//
// Contrato: `armarDeSolicitudes(n, { expandida })` → `null` (no es de este
// grupo) o `{ lado, cuerpo, ocultarTexto, expandir }`.
import { Text, View } from 'react-native';
import {
  datosDeConteo, datosDeDecision, datosDeDiferencia, datosDeHacienda, datosDeMetasPorAprobar,
  datosDeProductosSinVenta, datosDePromo, datosDeReinicio, datosDeRespuesta, datosDeSolicitud,
} from '@nucleo/utils/avisosDeOperacion';
import { porQueDesde } from '@nucleo/utils/productosParados';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { diasEntre, hoySV } from '@nucleo/utils/fecha';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { usePersona } from '../persona';
import { Caja, FONDO, Grilla, Insignia, Panel, Pildora, Rotulo } from '../Piezas';

// Lo que se ve de los productos de una solicitud antes de «Ver los N productos».
export const PRODUCTOS_VISIBLES = 3;

const GRIS = colorSistema.texto2;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2026-09-22» → «22 sep». */
const fechaCorta = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : null;
};
/** «15 – 22 sep», o «28 ago – 3 sep» si cruza de mes. */
const rangoDeFechas = (desde, hasta) => {
  const a = fechaCorta(desde);
  const b = fechaCorta(hasta);
  if (!a || !b || a === b) return a || b;
  return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]} – ${b}` : `${a} – ${b}`;
};
const unidades = (n) => (n == null ? '—' : Number(n).toLocaleString('es-SV', { maximumFractionDigits: 2 }));
const conMayuscula = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const enOracion = (t) => {
  const s = String(t ?? '').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};
const yMas = (n, sufijo = '') => `y ${n === 1 ? '1 producto más' : `${n} productos más`}${sufijo}`;

// ── Piezas locales ───────────────────────────────────────────────────────────

/** Un bloque de texto a todo el ancho, con su rótulo (el `Bloque` del portal). */
function Bloque({ rotulo, color, children }) {
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 9, gap: 3 }}>
      <Text style={{ color: color ?? GRIS, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{rotulo}</Text>
      {typeof children === 'string'
        ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{children}</Text>
        : children}
    </View>
  );
}

/** Un renglón de producto: el nombre manda; debajo, lo que se dice de él. */
function FilaDeProducto({ nombre, primero, children, derecha }) {
  return (
    <View style={{ paddingVertical: 8, gap: 5, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{nombre}</Text>
        {derecha}
      </View>
      {children}
    </View>
  );
}

/** El pie de una lista: «y 3 productos más». */
function PieDeLista({ texto }) {
  return (
    <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600', paddingVertical: 7, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>{texto}</Text>
  );
}

/** Una cifra con su rótulo pegado: «12 productos por contar». */
function CifraEnLinea({ valor, rotulo, color }) {
  return (
    <Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      <Text style={{ color: GRIS, fontSize: 13, fontWeight: '600' }}>{` ${rotulo}`}</Text>
    </Text>
  );
}

/** Una barra fina que codifica una proporción (vendido / tope). */
function Barrita({ pct, color = MARCA.azulClaro, alto = 4 }) {
  return (
    <View style={{ height: alto, borderRadius: alto / 2, backgroundColor: colorSistema.separador, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: alto, backgroundColor: color }} />
    </View>
  );
}

// ── La solicitud por decidir ─────────────────────────────────────────────────
// Una sola tarjeta para todos los tipos: quién la pide con su cara, la factura,
// qué cambia, los productos y el motivo. Aprobar, Rechazar y Ver detalle los
// pone la tarjeta general, debajo.
const TIPO_DE_SOLICITUD = {
  ANNULMENT_REQUEST: { color: MARCA.rojo, icono: 'Ban' },
  PAYMENT_CHANGE_REQUEST: { color: MARCA.azulClaro, icono: 'CreditCard' },
  VENDOR_CHANGE_REQUEST: { color: MARCA.azulClaro, icono: 'User' },
  CLIENT_CHANGE_REQUEST: { color: MARCA.azulClaro, icono: 'Users' },
  CAJA_MOVIMIENTO_CHANGE: { color: MARCA.ambar, icono: 'Wallet' },
  ABONO_CREDITO_CHANGE: { color: MARCA.ambar, icono: 'HandCoins' },
  ABONO_APROBACION: { color: MARCA.verde, icono: 'HandCoins' },
  DIST_DESCUENTO: { color: MARCA.azulClaro, icono: 'Percent' },
  INVENTORY_TRANSFER_REQUEST: { color: MARCA.azulClaro, icono: 'ArrowLeftRight' },
  INVENTORY_TRANSFER_PUSH: { color: MARCA.azulClaro, icono: 'Package' },
  INVENTORY_LOAD_REQUEST: { color: MARCA.verde, icono: 'PackagePlus' },
  INVENTORY_DISCARD_REQUEST: { color: MARCA.rojo, icono: 'Trash2' },
};
const tipoDeSolicitud = (tipo) => TIPO_DE_SOLICITUD[tipo] ?? { color: MARCA.azulClaro, icono: 'CalendarDays' };

/** Las celdas de a pares; la que queda sola, y la marcada `fila`, ocupan la fila entera. */
const celdasEnPares = (grupos) => grupos.flatMap((grupo) => grupo.filter(Boolean));

function ProductosDeTraslado({ productos, mas, sala, expandida }) {
  const visibles = expandida ? productos : productos.slice(0, PRODUCTOS_VISIBLES);
  const ocultos = productos.length - visibles.length;
  return (
    <Caja>
      {visibles.map((p, i) => (
        <FilaDeProducto key={`${p.nombre}-${i}`} nombre={p.nombre} primero={!i}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 }}>
            {p.cantidad != null ? <Pildora texto={`Pide ${unidades(p.cantidad)}`} color={MARCA.azulClaro} /> : null}
            {p.existencia != null ? (
              // «Hay 52 en Salud 3» y no «Hay en Salud 3 52»: pegados, se leía «353».
              <Text style={{ fontSize: 13 }}>
                <Text style={{ color: GRIS, fontWeight: '600' }}>Hay </Text>
                <Text style={{ color: colorSistema.texto, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{unidades(p.existencia)}</Text>
                {sala ? <Text style={{ color: GRIS, fontWeight: '600' }}>{` en ${sala}`}</Text> : null}
              </Text>
            ) : null}
          </View>
        </FilaDeProducto>
      ))}
      {!expandida && ocultos > 0 ? <PieDeLista texto={yMas(ocultos)} /> : null}
      {mas > 0 && (expandida || ocultos === 0) ? <PieDeLista texto={yMas(mas, ' en la solicitud')} /> : null}
    </Caja>
  );
}

function ProductosConCantidad({ productos, mas, expandida, tope = PRODUCTOS_VISIBLES }) {
  const visibles = expandida || tope == null ? productos : productos.slice(0, tope);
  const ocultos = productos.length - visibles.length;
  return (
    <Caja>
      {visibles.map((p, i) => (
        <FilaDeProducto key={`${p.nombre}-${i}`} nombre={p.nombre} primero={!i}
          derecha={p.cantidad != null ? (
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`×${unidades(p.cantidad)}`}</Text>
          ) : null} />
      ))}
      {ocultos > 0 ? <PieDeLista texto={yMas(ocultos)} /> : null}
      {mas > 0 && ocultos === 0 ? <PieDeLista texto={yMas(mas)} /> : null}
    </Caja>
  );
}

function CuerpoDeSolicitud({ d, expandida }) {
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const rango = rangoDeFechas(d.desde, d.hasta);
  const abono = d.tipo === 'ABONO_APROBACION';
  const deFactura = !!(d.doc || d.fecha);
  const nuevoRotulo = d.antes ? 'Pasa a' : (d.tipo === 'VENDOR_CHANGE_REQUEST' ? 'Nuevo vendedor' : 'Nuevo');
  const celdas = celdasEnPares([
    [{ k: 'q', rotulo: d.tipo === 'INVENTORY_TRANSFER_PUSH' ? 'Lo envía' : 'Lo pide', persona: emp, valor: d.quien ?? 'Sin nombre', fila: true }],
    [
      d.fecha && { k: 'fecha', rotulo: 'Fecha', valor: fechaCorta(d.fecha) },
      d.monto != null && (deFactura || abono) && { k: 'monto', rotulo: 'Monto', valor: formatMoney(d.monto) },
      d.doc && { k: 'doc', rotulo: 'Documento', valor: d.doc },
      d.pago && { k: 'pago', rotulo: 'Pago', valor: conMayuscula(d.pago) },
      abono && d.creditos != null && { k: 'creditos', rotulo: 'Créditos', valor: `${d.creditos}` },
    ],
    [d.cliente && (deFactura || abono) && { k: 'cliente', rotulo: 'Cliente', valor: d.cliente, fila: true, lineas: 3 }],
    [
      d.antes && { k: 'antes', rotulo: 'Hoy', valor: conMayuscula(d.antes) },
      d.despues && { k: 'despues', rotulo: nuevoRotulo, valor: conMayuscula(d.despues), color: MARCA.azulClaro },
    ],
    [rango && { k: 'rango', rotulo: 'Fechas', valor: rango, fila: true }],
  ]);
  return (
    <>
      <Grilla celdas={celdas} />
      {d.tipo === 'INVENTORY_TRANSFER_REQUEST' && d.productos.length > 0 ? (
        <ProductosDeTraslado productos={d.productos} mas={d.mas} sala={d.origen} expandida={expandida} />
      ) : d.productos.length > 0 ? (
        <ProductosConCantidad productos={d.productos} mas={d.mas} expandida={expandida} />
      ) : null}
      {d.motivo ? (
        <Bloque rotulo={d.tipo === 'INVENTORY_TRANSFER_PUSH' ? 'Por qué lo envía' : 'Por qué lo pide'}>{enOracion(d.motivo)}</Bloque>
      ) : null}
    </>
  );
}

// ── Las respuestas: a un traslado que pedí, a un envío que mandé ─────────────
const RESPUESTA = {
  ENVIA: { color: MARCA.verde, icono: 'Package', persona: 'Lo envía' },
  PARTE: { color: MARCA.ambar, icono: 'Package', persona: 'Lo envía' },
  NO: { color: MARCA.rojo, icono: 'PackageMinus', persona: 'Lo revisó' },
  RECIBIDO: { color: MARCA.verde, icono: 'Package', persona: 'Lo recibió' },
  DEVUELVE: { color: MARCA.ambar, icono: 'RefreshCw', persona: 'Lo recibió' },
  APARECIO: { color: MARCA.verde, icono: 'Package', persona: 'Lo recibió' },
};
const deRespuesta = (e) => RESPUESTA[e] ?? RESPUESTA.ENVIA;

/** Cuánto sale de cada producto, en su color: entero verde, una parte naranja, nada rojo. */
function pildoraDeRespuesta(d, p) {
  if (d.estado === 'NO') return p.pedida != null ? <Pildora texto={`Pediste ${unidades(p.pedida)}`} color={GRIS} /> : null;
  const se = (x) => (x === 1 ? 'Se envía' : 'Se envían');
  if (p.enviada === 0) return <Pildora texto="No se envía" color={MARCA.rojo} />;
  if (p.enviada != null && p.pedida != null && p.enviada < p.pedida) {
    return <Pildora texto={`${se(p.enviada)} ${unidades(p.enviada)} de ${unidades(p.pedida)}`} color={MARCA.ambar} />;
  }
  return p.enviada != null ? <Pildora texto={`${se(p.enviada)} ${unidades(p.enviada)}`} color={MARCA.verde} /> : null;
}

function CuerpoDeRespuesta({ d }) {
  const r = deRespuesta(d.estado);
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const esEnvio = d.tipo === 'envio';
  const salaTxt = d.sala ?? 'la otra sala';
  const resumenEnvio = [
    d.aceptados > 0 && `Se quedó con ${d.aceptados === 1 ? 'un producto' : `${d.aceptados} productos`}`,
    d.devueltos.length > 0 && `te devuelve ${d.devueltos.length === 1 ? 'uno' : d.devueltos.length}`,
  ].filter(Boolean).join(' y ').replace(/^t/, 'T');
  const porque = [d.motivo, d.nota].filter(Boolean).map(enOracion).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ');
  return (
    <>
      <Grilla celdas={[{ k: 'q', rotulo: r.persona, persona: emp, valor: d.quien ?? d.origen ?? d.sala ?? '—', fila: true }]} />
      {!esEnvio && d.productos.length > 0 ? (
        <Caja>
          {d.productos.map((p, i) => (
            <FilaDeProducto key={`${p.nombre}-${i}`} nombre={p.nombre} primero={!i}>
              {pildoraDeRespuesta(d, p)}
            </FilaDeProducto>
          ))}
          {d.mas > 0 ? <PieDeLista texto={yMas(d.mas)} /> : null}
        </Caja>
      ) : null}
      {esEnvio && d.estado === 'APARECIO' ? (
        <>
          <Bloque rotulo={`Tu envío a ${salaTxt}`}>
            {`Apareció lo que faltaba: ${d.aceptados === 1
              ? 'recibió el producto que había marcado como no llegado'
              : `recibió los ${d.aceptados} productos que había marcado como no llegados`}. Ya no hay que buscarlo en tu sala.`}
          </Bloque>
          {d.productos.length > 0 ? (
            <Caja>{d.productos.map((p, i) => <FilaDeProducto key={`${p.nombre}-${i}`} nombre={p.nombre} primero={!i} />)}</Caja>
          ) : null}
        </>
      ) : null}
      {esEnvio && d.estado !== 'APARECIO' ? (
        <Bloque rotulo={`Tu envío a ${salaTxt}`}>
          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>
            {resumenEnvio ? `${resumenEnvio}.` : ''}
            {d.noLlegaron > 0 ? (
              <Text style={{ color: MARCA.rojo }}>
                {` ${d.noLlegaron === 1 ? 'Un producto no llegó' : `${d.noLlegaron} productos no llegaron`} en la caja: revisa si quedó en tu sala.`}
              </Text>
            ) : null}
          </Text>
        </Bloque>
      ) : null}
      {esEnvio && d.devueltos.length > 0 ? (
        <Caja>
          {d.devueltos.map((p, i) => (
            <FilaDeProducto key={`${p.nombre}-${i}`} nombre={p.nombre} primero={!i}>
              {p.motivo ? (
                <Text style={{ fontSize: 12 }}>
                  <Text style={{ color: GRIS, fontWeight: '800', textTransform: 'uppercase' }}>Por qué lo devuelve </Text>
                  <Text style={{ color: colorSistema.texto, fontWeight: '600' }}>{enOracion(p.motivo)}</Text>
                </Text>
              ) : null}
            </FilaDeProducto>
          ))}
        </Caja>
      ) : null}
      {esEnvio && d.estado === 'DEVUELVE' ? (
        <Bloque rotulo="Qué sigue" color={MARCA.ambar}>Confirma en Envíos cuando la caja esté de vuelta en tu sala.</Bloque>
      ) : null}
      {porque ? <Bloque rotulo={d.estado === 'NO' ? 'Por qué no' : 'Por qué no va todo'}>{porque}</Bloque> : null}
      {d.alternativa ? (
        // Sin `enOracion`: bajaría a minúscula las salas («salud 3»).
        <Bloque rotulo="Dónde más hay" color={MARCA.azulClaro}>
          {d.alternativa.replace(/^sí hay en /i, '').replace(/^./, (c) => c.toUpperCase())}
        </Bloque>
      ) : null}
    </>
  );
}

// ── Lo que decidieron sobre mi solicitud ─────────────────────────────────────
function CuerpoDeDecision({ d }) {
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const rango = rangoDeFechas(d.desde, d.hasta);
  const celdas = celdasEnPares([
    [{ k: 'q', rotulo: d.aprobada ? 'La aprobó' : 'La rechazó', persona: emp, valor: d.quien ?? '—', fila: true }],
    [
      d.fecha && { k: 'fecha', rotulo: 'Fecha', valor: [fechaCorta(d.fecha), d.hora ? hora12(d.hora) : null].filter(Boolean).join(' ') },
      d.monto != null && { k: 'monto', rotulo: 'Monto', valor: formatMoney(d.monto) },
      d.doc && { k: 'doc', rotulo: 'Documento', valor: d.doc },
      d.pago && { k: 'pago', rotulo: 'Pago', valor: conMayuscula(d.pago) },
    ],
    [d.cliente && { k: 'cliente', rotulo: 'Cliente', valor: d.cliente, fila: true, lineas: 3 }],
    [
      d.antes && { k: 'antes', rotulo: 'Era', valor: conMayuscula(d.antes) },
      d.despues && { k: 'despues', rotulo: d.antes ? 'Pasa a' : 'Nuevo', valor: conMayuscula(d.despues), color: d.aprobada ? MARCA.verde : undefined },
    ],
    [rango && { k: 'rango', rotulo: 'Fechas', valor: rango, fila: true }],
  ]);
  return (
    <>
      <Grilla celdas={celdas} />
      {d.producto ? (
        <Bloque rotulo="Producto">
          <Text style={{ fontSize: 14 }}>
            <Text style={{ color: colorSistema.texto, fontWeight: '800' }}>{d.producto}</Text>
            {d.sala ? <Text style={{ color: GRIS, fontWeight: '600' }}>{` · ${d.sala}`}</Text> : null}
          </Text>
        </Bloque>
      ) : null}
      {d.min != null || d.max != null ? (
        <Bloque rotulo={d.aprobada ? 'Queda en' : 'Pediste'} color={d.aprobada ? MARCA.verde : undefined}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {`MIN ${d.min ?? '—'} · MAX ${d.max ?? '—'}`}
          </Text>
        </Bloque>
      ) : null}
      {d.productos.length > 0 ? <ProductosConCantidad productos={d.productos} mas={d.mas} tope={null} /> : null}
      {d.nota ? <Bloque rotulo={d.aprobada ? 'Nota' : 'Por qué'} color={d.aprobada ? undefined : MARCA.rojo}>{enOracion(d.nota)}</Bloque> : null}
      {d.instruccion ? <Bloque rotulo="Falta hacer" color={MARCA.ambar}>{d.instruccion}</Bloque> : null}
    </>
  );
}

// ── Una diferencia de un pedido ──────────────────────────────────────────────
// El producto manda; debajo qué pasó y en cuánto, la salida que se propone o
// que quedó, y quién movió el paso. Contestarla (las acciones) la pone la
// tarjeta general.
const DIFERENCIA = {
  propuesta: { color: MARCA.azulClaro, persona: 'La propone', salida: 'Propone' },
  contrapropuesta: { color: MARCA.ambar, persona: 'La propone', salida: 'Bodega propone' },
  escalada: { color: MARCA.rojo, persona: 'La rechazó', salida: 'Se había propuesto' },
  acordada: { color: MARCA.verde, persona: 'La aceptó', salida: 'Quedó en' },
  confirmada: { color: MARCA.verde, persona: 'La cerró', salida: 'Quedó en' },
};
const deDiferencia = (e) => DIFERENCIA[e] ?? DIFERENCIA.propuesta;

/** «Faltaron 2», «Sobró 1»: qué pasó y cuánto, en una sola cifra. */
const queCantidad = (d) => {
  const n = d.problema ?? (d.enviada != null && d.recibida != null ? Math.abs(d.enviada - d.recibida) : null);
  if (!n) return d.que;
  if (d.que === 'Faltó') return n === 1 ? 'Faltó 1' : `Faltaron ${unidades(n)}`;
  if (d.que === 'Sobró') return n === 1 ? 'Sobró 1' : `Sobraron ${unidades(n)}`;
  return d.que;
};

function CuerpoDeDiferencia({ d }) {
  const t = deDiferencia(d.estado);
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const cantidades = d.recibida != null && d.enviada != null;
  const que = queCantidad(d);
  return (
    <>
      {d.producto ? (
        <Caja><Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', paddingVertical: 8 }}>{d.producto}</Text></Caja>
      ) : null}
      <Grilla celdas={[
        que && { k: 'que', rotulo: 'Qué pasó', valor: que },
        cantidades && { k: 'llegaron', rotulo: 'Llegaron', valor: `${unidades(d.recibida)} de ${unidades(d.enviada)}` },
      ]} />
      {d.salida ? (
        <Bloque rotulo={t.salida} color={t.color}>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{d.salida}</Text>
              {d.corto ? <Pildora texto={d.corto} color={GRIS} /> : null}
            </View>
            {d.ayuda && d.estado !== 'confirmada' ? <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>{d.ayuda}</Text> : null}
          </View>
        </Bloque>
      ) : null}
      {emp || d.quien ? <Grilla celdas={[{ k: 'q', rotulo: t.persona, persona: emp, valor: d.quien ?? '—', fila: true }]} /> : null}
      {d.nota ? <Bloque rotulo={d.estado === 'escalada' ? 'Por qué no' : 'Nota'}>{enOracion(d.nota)}</Bloque> : null}
    </>
  );
}

// ── El conteo cíclico del mes ────────────────────────────────────────────────
const CLASE_DE_CONTEO = { A: 'de clase A', B: 'de clase B', C: 'de clase C', BAJO_RECETA: 'bajo receta' };

function CuerpoDeConteo({ d }) {
  return (
    <>
      <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 9, gap: 5 }}>
        <CifraEnLinea valor={d.productos} rotulo="productos por contar" />
        {d.grupos.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 }}>
            {d.grupos.map((g) => <CifraEnLinea key={g.clave} valor={g.n} rotulo={CLASE_DE_CONTEO[g.clave] ?? g.clave.toLowerCase()} />)}
          </View>
        ) : null}
      </View>
      <Bloque rotulo="Cómo se cuenta">A ciegas: anota lo que ves en el estante, sin mirar lo que dice el sistema.</Bloque>
    </>
  );
}

// ── El envío nocturno a Hacienda ─────────────────────────────────────────────
function CuerpoDeHacienda({ d }) {
  if (!d.corrio) {
    const espera = d.esperando == null ? ''
      : d.esperando === 0 ? ' Ahora no hay ninguna factura esperando.'
        : ` ${d.esperando === 1 ? 'Hay 1 factura esperando' : `Hay ${d.esperando} facturas esperando`} y no se van a mandar hasta que vuelva a correr.`;
    return <Bloque rotulo="Qué pasó" color={MARCA.rojo}>{`El envío automático de las ${hora12('22:30')} no dejó registro.${espera}`}</Bloque>;
  }
  return (
    <>
      <Panel datos={[
        { etiqueta: 'no entraron', valor: d.fallidas, color: MARCA.rojo },
        d.resueltas > 0 && { etiqueta: 'sí entraron', valor: d.resueltas, color: MARCA.verde },
        d.restantes > 0 && { etiqueta: 'en cola', valor: d.restantes },
      ]} />
      {d.facturas.length > 0 ? (
        <Caja>
          {d.facturas.map((f, i) => (
            <View key={i} style={{ paddingVertical: 8, gap: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{f.cliente ?? 'Sin nombre'}</Text>
                  <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>{[f.sala, f.doc, fechaCorta(f.fecha)].filter(Boolean).join('   ')}</Text>
                </View>
                {f.monto != null ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(f.monto)}</Text> : null}
              </View>
              {f.motivo ? (
                <Text style={{ fontSize: 12 }}>
                  <Text style={{ color: MARCA.rojo, fontWeight: '800', textTransform: 'uppercase' }}>Hacienda dice </Text>
                  <Text style={{ color: colorSistema.texto, fontWeight: '600' }}>{f.motivo}</Text>
                </Text>
              ) : null}
            </View>
          ))}
          {d.fallidas > d.facturas.length ? <PieDeLista texto={`y ${d.fallidas - d.facturas.length} más`} /> : null}
        </Caja>
      ) : null}
      <Bloque rotulo="Qué sigue" color={MARCA.ambar}>Las que no se arreglan solas quedan en Facturación, en Observaciones.</Bloque>
    </>
  );
}

// ── Una promoción: terminó, se le acaba el lote, cerró su mes o el resumen ───
const diasHasta = (iso) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso ?? ''));
  return m ? diasEntre(hoySV(), m[1]) : null;
};
const nombreDelMes = (ym) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
  return m ? `${MESES_LARGOS[Number(m[2]) - 1]} ${m[1]}` : null;
};

function ladoDePromo(d) {
  if (d.tipo === 'lote') return <Insignia icono="Package" color={MARCA.ambar} />;
  if (d.tipo === 'resumen') return <Insignia icono="Percent" color={MARCA.azulClaro} />;
  if (d.tipo === 'mes') return <Insignia icono="CalendarDays" color={MARCA.azulClaro} />;
  return <Insignia icono="Percent" color={GRIS} />;
}

function CuerpoDePromo({ d }) {
  if (d.tipo === 'resumen') {
    // Cada sala en su celda, en el mismo orden en todas y con las que van en
    // cero, con una barra de lo vendido frente a la sala que más vendió.
    return (
      <View style={{ gap: 8 }}>
        {d.promociones.map((pr) => {
          const tope = Math.max(1, ...pr.salas.map((x) => x.vendido));
          const dias = diasHasta(pr.fin);
          return (
            <View key={pr.nombre} style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800' }}>{pr.nombre}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '600' }}>
                    {pr.productos != null ? <Text style={{ color: GRIS }}>{pr.productos === 1 ? '1 producto' : `${pr.productos} productos`}</Text> : null}
                    {pr.productos != null && dias != null ? <Text style={{ color: GRIS }}>{'   '}</Text> : null}
                    {dias != null ? (
                      <Text style={{ color: dias <= 3 ? MARCA.ambar : GRIS }}>
                        {dias <= 0 ? 'termina hoy' : dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}
                      </Text>
                    ) : null}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{unidades(pr.vendido)}</Text>
                  <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>vendidas</Text>
                </View>
              </View>
              {pr.salas.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 8 }}>
                  {pr.salas.map((sa) => (
                    <View key={sa.sala} style={{ width: '30%', minWidth: 80, flexGrow: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
                        <Text style={{ flexShrink: 1, color: GRIS, fontSize: 12, fontWeight: '600' }}>{sa.sala}</Text>
                        <Text style={{ color: sa.vendido === 0 ? GRIS : colorSistema.texto, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{unidades(sa.vendido)}</Text>
                      </View>
                      <Barrita pct={Math.round((sa.vendido / tope) * 100)} />
                    </View>
                  ))}
                </View>
              ) : null}
              {pr.porAgotarse.map((bj, i) => (
                <Text key={i} style={{ fontSize: 12 }}>
                  <Text style={{ color: MARCA.ambar, fontWeight: '800', textTransform: 'uppercase' }}>Por agotarse </Text>
                  <Text style={{ color: colorSistema.texto, fontWeight: '600' }}>{`${bj.producto} — ${bj.sala}: ${unidades(bj.vendido)} de ${unidades(bj.asignado)}`}</Text>
                </Text>
              ))}
            </View>
          );
        })}
      </View>
    );
  }
  if (d.tipo === 'lote') {
    const pct = d.asignado ? Math.min(100, Math.round(((d.vendido ?? 0) / d.asignado) * 100)) : null;
    const agotado = d.asignado != null && (d.vendido ?? 0) >= d.asignado;
    const color = agotado ? MARCA.rojo : MARCA.ambar;
    return (
      <>
        <Caja>
          <View style={{ paddingVertical: 8, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{d.producto}</Text>
            {d.nombre ? <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>{d.nombre}</Text> : null}
          </View>
        </Caja>
        {pct != null ? (
          <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 9, gap: 6 }}>
            <Text style={{ fontSize: 14 }}>
              <Text style={{ color, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{d.vendido ?? 0}</Text>
              <Text style={{ color: GRIS, fontWeight: '600' }}>{` de ${d.asignado} vendidas${d.sala ? ` en ${d.sala}` : ''}`}</Text>
            </Text>
            <Barrita pct={pct} color={color} alto={6} />
          </View>
        ) : null}
        <Bloque rotulo="Todavía hay en" color={MARCA.azulClaro}>
          {/* Los avisos anteriores traen «Salud 1 12»: la cantidad va entre paréntesis. */}
          {d.donde ? d.donde.replace(/([^\s(]) (\d+)(?=\s*·|$)/g, '$1 ($2)') : 'Ya no queda en ninguna otra sala.'}
        </Bloque>
      </>
    );
  }
  if (d.tipo === 'mes') {
    return (
      <>
        <Grilla celdas={[
          { k: 'mes', rotulo: 'Mes', valor: conMayuscula(nombreDelMes(d.mes) ?? d.mes ?? '—') },
          d.costo != null && { k: 'costo', rotulo: 'Costo', valor: formatMoney(d.costo) },
        ]} />
        {d.salas.length > 0 ? (
          <Caja>
            {d.salas.map((s, i) => (
              <View key={s.sala} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{s.sala}</Text>
                {s.nivel ? <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>{`Nivel ${s.nivel}`}</Text> : null}
                {s.costo != null ? <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(s.costo)}</Text> : null}
              </View>
            ))}
          </Caja>
        ) : null}
      </>
    );
  }
  return (
    <Grilla celdas={[
      { k: 'como', rotulo: 'Cómo terminó', valor: d.motivo ?? 'Cerró su último producto', fila: !d.fin, lineas: 3 },
      d.fin && { k: 'fin', rotulo: 'Último día', valor: fechaCorta(d.fin) },
    ]} />
  );
}

// ── Las metas del mes por aprobar ────────────────────────────────────────────
/** «−3.4%» / «+2.1%»: cuánto cambia contra el mes anterior. */
const cambio = (hoy, antes) => {
  if (hoy == null || !antes) return null;
  const pct = ((hoy - antes) / antes) * 100;
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toLocaleString('es-SV', { maximumFractionDigits: 1 })}%`;
};

function CuerpoDeMetasPorAprobar({ d }) {
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const totalCambio = cambio(d.total, d.anterior);
  return (
    <>
      {emp || d.quien ? <Grilla celdas={[{ k: 'q', rotulo: 'Las confirmó', persona: emp, valor: d.quien ?? '—', fila: true }]} /> : null}
      <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 10, gap: 3 }}>
        <Rotulo>Meta de la empresa</Rotulo>
        <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.total)}</Text>
        {totalCambio ? (
          <Text style={{ fontSize: 12 }}>
            <Text style={{ color: colorSistema.texto, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{totalCambio}</Text>
            <Text style={{ color: GRIS, fontWeight: '600' }}> contra el mes anterior</Text>
          </Text>
        ) : null}
      </View>
      <Caja>
        {d.salas.map((s, i) => (
          <View key={s.sala} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{s.sala}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(s.meta)}</Text>
              {cambio(s.meta, s.anterior) ? <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{cambio(s.meta, s.anterior)}</Text> : null}
            </View>
          </View>
        ))}
      </Caja>
    </>
  );
}

// ── El sistema se reinició ───────────────────────────────────────────────────
function CuerpoDeReinicio({ d }) {
  const cuando = fechaHora12(d.arranco, { day: 'numeric', month: 'short' });
  return (
    <>
      {cuando ? <Grilla celdas={[{ k: 'c', rotulo: 'Volvió a arrancar', valor: cuando, fila: true }]} /> : null}
      <Bloque rotulo="Qué significa">Si poco antes el portal estuvo lento o no dejaba entrar, fue esto. No hay que hacer nada: ya está funcionando.</Bloque>
    </>
  );
}

// ── Productos sin venta ──────────────────────────────────────────────────────
// Cuántos, cuánto cuestan y a dónde va cada grupo; después los más caros con
// el porqué de su fecha. Armar el envío se hace en Gestión de stock.
function CuerpoDeProductosSinVenta({ d }) {
  const tope = Math.max(1, ...d.destinos.map((x) => x.productos));
  return (
    <>
      <Panel datos={[
        { etiqueta: d.productos === 1 ? 'producto' : 'productos', valor: d.productos },
        d.costo != null && { etiqueta: 'en costo', valor: formatMoney(d.costo), color: MARCA.ambar },
      ]} />
      <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
        <Rotulo>A dónde mandarlos</Rotulo>
        {d.destinos.map((x) => {
          // El destino 6 del origen es Bodega: lo que se guarda, no se reparte.
          const bodega = x.erp === 6;
          return (
            <View key={x.sala} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${bodega ? '▣ ' : '→ '}${x.sala}`}</Text>
                <Text style={{ fontSize: 12 }}>
                  <Text style={{ color: colorSistema.texto, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{x.productos}</Text>
                  {x.costo != null ? <Text style={{ color: GRIS, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{`  ${formatMoney(x.costo)}`}</Text> : null}
                </Text>
              </View>
              <Barrita pct={Math.round((x.productos / tope) * 100)} color={bodega ? GRIS : MARCA.azulClaro} />
            </View>
          );
        })}
      </View>
      {d.ejemplos.length > 0 ? (
        <Caja>
          {d.ejemplos.map((e, i) => (
            <View key={e.producto} style={{ paddingVertical: 8, gap: 3, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{e.producto}</Text>
                {e.costo != null ? <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(e.costo)}</Text> : null}
              </View>
              <Text style={{ color: GRIS, fontSize: 12, fontWeight: '600' }}>
                {`${unidades(e.existencia)} ${Number(e.existencia) === 1 ? 'unidad' : 'unidades'}`}
                {e.desde ? ` · desde el ${fechaCorta(e.desde)} (${porQueDesde(e)})` : ''}
                {e.destino ? <Text style={{ color: MARCA.azulClaro }}>{` · → ${e.destino}`}</Text> : null}
              </Text>
            </View>
          ))}
        </Caja>
      ) : null}
      <Bloque rotulo="Qué sigue" color={MARCA.ambar}>
        Abre Gestión de stock y aprieta «Armar envío» en cada destino: el envío sale cargado y lo puedes cambiar antes de transferir.
      </Bloque>
    </>
  );
}

// ── El armado ────────────────────────────────────────────────────────────────
// En el orden de prioridad de la tarjeta del portal entre estos tipos:
// solicitud, respuesta, decisión, diferencia, conteo, Hacienda, promoción,
// metas por aprobar, reinicio y productos sin venta.
export function armarDeSolicitudes(n, { expandida = false } = {}) {
  let d = datosDeSolicitud(n);
  if (d) {
    const t = tipoDeSolicitud(d.tipo);
    const total = d.productos.length;
    const mas = total > PRODUCTOS_VISIBLES;
    return {
      lado: <Insignia icono={t.icono} color={t.color} />,
      cuerpo: <CuerpoDeSolicitud d={d} expandida={expandida} />,
      ocultarTexto: true,
      expandir: mas ? { cerrado: `Ver los ${total} productos`, abierto: 'Ocultar productos' } : null,
    };
  }
  d = datosDeRespuesta(n);
  if (d) {
    const r = deRespuesta(d.estado);
    return { lado: <Insignia icono={r.icono} color={r.color} />, cuerpo: <CuerpoDeRespuesta d={d} />, ocultarTexto: true, expandir: null };
  }
  d = datosDeDecision(n);
  if (d) {
    return {
      lado: <Insignia icono={d.aprobada ? 'Check' : 'Ban'} color={d.aprobada ? MARCA.verde : MARCA.rojo} />,
      cuerpo: <CuerpoDeDecision d={d} />, ocultarTexto: true, expandir: null,
    };
  }
  d = datosDeDiferencia(n);
  if (d) {
    const t = deDiferencia(d.estado);
    return {
      lado: <Insignia icono={d.estado === 'confirmada' ? 'Check' : 'BarChart2'} color={t.color} />,
      cuerpo: <CuerpoDeDiferencia d={d} />, ocultarTexto: true, expandir: null,
    };
  }
  d = datosDeConteo(n);
  if (d) return { lado: <Insignia icono="ClipboardCheck" color={MARCA.azulClaro} />, cuerpo: <CuerpoDeConteo d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeHacienda(n);
  if (d) return { lado: <Insignia icono="AlertTriangle" color={MARCA.rojo} />, cuerpo: <CuerpoDeHacienda d={d} />, ocultarTexto: true, expandir: null };
  d = datosDePromo(n);
  if (d) return { lado: ladoDePromo(d), cuerpo: <CuerpoDePromo d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeMetasPorAprobar(n);
  if (d) return { lado: <Insignia icono="Target" color={MARCA.azulClaro} />, cuerpo: <CuerpoDeMetasPorAprobar d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeReinicio(n);
  if (d) return { lado: <Insignia icono="RefreshCw" color={MARCA.ambar} />, cuerpo: <CuerpoDeReinicio d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeProductosSinVenta(n);
  if (d) return { lado: <Insignia icono="Archive" color={MARCA.ambar} />, cuerpo: <CuerpoDeProductosSinVenta d={d} />, ocultarTexto: true, expandir: null };
  return null;
}
