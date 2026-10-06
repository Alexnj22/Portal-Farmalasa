// Las tarjetas de los avisos de OPERACIÓN en la app — `TarjetasDeOperacion.jsx`
// del portal, nativas y con todo lo que dibuja la del portal: el corte con
// quién lo hizo y su diferencia, el reloj de la bitácora con sus áreas, los
// traslados por respaldo renglón por renglón, el MIN·MAX con las ventas de 6
// meses, las presentaciones y el despacho, la bolsa que no cuadró, el depósito,
// la alerta de CCF, la factura de sala, los cortes sin confirmar y el pedido
// con sus pasos.
//
// Los datos salen de las MISMAS funciones del núcleo que usa el portal
// (`utils/avisosDeOperacion`): si un aviso cambia de forma, las dos tarjetas
// se enteran juntas. Nada se recorta con «…»: el texto que no entra baja de
// renglón (usuario, 24-sep: «responsive sin cortar»).
import { Fragment } from 'react';
import { Text, View } from 'react-native';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12, rango12 } from '@nucleo/utils/hora';
import {
  datosDeAlertaDeVentas, datosDeBitacoraPorVencer, datosDeBolsaNoCuadra, datosDeCorteNuevo, datosDeCortesPendientes,
  datosDeDeposito, datosDeFacturaDeSala, datosDeMinmaxPendiente, datosDePedido, datosDeTrasladosPorRespaldo,
  ETAPAS_DE_PEDIDO, maxNoAlcanzaParaDespachar, TRASLADOS_VISIBLES, VENTANA_BITACORA_MIN,
} from '@nucleo/utils/avisosDeOperacion';
import Avatar from '../../Avatar';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { usePersona } from '../persona';
import { Advertencia, Anillo, FONDO, Insignia, Panel, Pildora, Rotulo } from '../Piezas';

// ── Los tonos del portal (`tonos(isDark)`) en la paleta de la app ──────────
const TONO = {
  verde: MARCA.verde, naranja: MARCA.ambar, rojo: MARCA.rojo, azul: MARCA.azulClaro, gris: colorSistema.texto2,
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
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
const firmado = (v) => `${v > 0 ? '+' : '−'}${formatMoney(Math.abs(v))}`;
/** El motivo como sale del teclado —a veces TODO EN MAYÚSCULAS— va en oración. */
const enOracion = (t) => {
  const s = String(t ?? '').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

// ── Las piezas de la grilla del portal (`Grilla`, `Celda`, `CeldaPersona`) ──
// Un panel de renglones; cada renglón es una celda a todo lo ancho o dos
// lado a lado, con la línea entre ellos — la grilla `gap-px` del portal.
function Tabla({ children }) {
  const filas = (Array.isArray(children) ? children.flat(Infinity) : [children]).filter(Boolean);
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, overflow: 'hidden' }}>
      {filas.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>{f}</View>
      ))}
    </View>
  );
}

// Una celda: rótulo arriba y dato abajo; `derecha` alinea a la derecha y pone
// la línea vertical a su izquierda; `detalle` es un renglón chico debajo.
function Celda({ rotulo, valor, color, derecha = false, detalle, colorRotulo }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 9, gap: 2, alignItems: derecha ? 'flex-end' : 'flex-start',
      borderLeftWidth: derecha ? 0.5 : 0, borderLeftColor: colorSistema.separador }}>
      <Text style={{ color: colorRotulo ?? color ?? colorSistema.texto2, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: derecha ? 'right' : 'left' }}>{rotulo}</Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: derecha ? 'right' : 'left' }}>{valor}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', textAlign: derecha ? 'right' : 'left' }}>{detalle}</Text> : null}
    </View>
  );
}

// Una celda a todo lo ancho con su rótulo y un texto que baja de renglón.
function Bloque({ rotulo, children, color, grande = false }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 9, gap: 3 }}>
      {rotulo ? <Rotulo>{rotulo}</Rotulo> : null}
      {typeof children === 'string'
        ? <Text style={{ color: color ?? colorSistema.texto, fontSize: grande ? 16 : 14, fontWeight: grande ? '800' : '600' }}>{children}</Text>
        : children}
    </View>
  );
}

// La cara de alguien, o la de la sala si el aviso no dice quién.
function Cara({ emp, tamano = 30, icono = 'Building2', color = colorSistema.texto2 }) {
  return emp ? <Avatar empleado={emp} tamano={tamano} /> : <Insignia icono={icono} color={color} tamano={tamano} />;
}

// La persona en su propio renglón, a todo lo ancho: en una columna angosta el
// nombre se cortaba («Kevin …»).
function CeldaPersona({ id, nombre, foto, rotulo, respaldo = 'Sin nombre' }) {
  const emp = usePersona(id, nombre, foto);
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
      <Cara emp={emp} />
      <View style={{ flex: 1, gap: 1 }}>
        <Rotulo>{rotulo}</Rotulo>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{emp ? shortEmployeeName(emp) : respaldo}</Text>
      </View>
    </View>
  );
}

// ── El corte de caja ───────────────────────────────────────────────────────
// Quién lo hizo a la izquierda y cómo quedó a la derecha: una sola fila. El
// color lo dice el número; Confirmar y Descartar los pone la tarjeta general.
const CORTE = {
  cuadra: { tono: 'verde', icono: 'Check', rotulo: 'Cuadró' },
  sobra: { tono: 'naranja', icono: 'TrendingUp', rotulo: 'Sobrante' },
  falta: { tono: 'rojo', icono: 'TrendingDown', rotulo: 'Faltante' },
  sin_conteo: { tono: 'naranja', icono: 'Ban', rotulo: 'Sin conteo' },
};

function CuerpoDeCorte({ d }) {
  const c = CORTE[d.estado];
  const color = TONO[c.tono];
  const emp = usePersona(d.quienId, d.quien, d.quienFoto);
  const diferencia = d.estado === 'cuadra' ? '$0.00' : d.estado === 'sin_conteo' ? null : firmado(d.tramo);
  return (
    <Tabla>
      <>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Cara emp={emp} />
          <View style={{ flex: 1, gap: 1 }}>
            <Rotulo>Hizo el corte</Rotulo>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{emp ? shortEmployeeName(emp) : 'Desde la caja'}</Text>
          </View>
        </View>
        <View style={{ width: 112, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'flex-end', justifyContent: 'center', gap: 2,
          borderLeftWidth: 0.5, borderLeftColor: colorSistema.separador }}>
          <Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{c.rotulo}</Text>
          {diferencia ? <Text style={{ color, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{diferencia}</Text> : null}
        </View>
      </>
    </Tabla>
  );
}

// ── La bitácora por cerrarse ───────────────────────────────────────────────
// Un reloj que se vacía: el arco y la barra son lo que queda de la ventana, y
// se calculan al dibujar — leído tarde dice «Ya cerró». Debajo, un renglón por
// área con lo que falta anotar y en qué franja.
const tonoDeBitacora = (d) => (d.cerrada ? TONO.gris : d.quedan <= 15 ? TONO.rojo : TONO.naranja);
const avanceDe = (d) => (d.cerrada ? 0 : Math.max(0, Math.min(d.quedan / VENTANA_BITACORA_MIN, 1)));
const TIPO_BITACORA = {
  lectura: { icono: 'Thermometer', rotulo: 'Temperatura' },
  limpieza: { icono: 'FlaskConical', rotulo: 'Limpieza' },
};

function CuerpoDeBitacora({ d }) {
  const color = tonoDeBitacora(d);
  const { pendientes, detalle, areas } = d;
  // Si todas las áreas comparten la franja —lo normal—, se dice una vez arriba.
  const franjas = new Set(detalle.map((x) => `${x.desde}|${x.hasta}`));
  const unaFranja = franjas.size === 1 && detalle[0]?.desde && detalle[0]?.hasta ? rango12(detalle[0].desde, detalle[0].hasta) : null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Text style={{ flex: 1, color, fontSize: 16, fontWeight: '800' }}>{d.cerrada ? 'Ya cerró' : `Quedan ${d.quedan} min`}</Text>
        <Pildora texto={pendientes === 1 ? '1 pendiente' : `${pendientes} pendientes`} color={color} />
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: FONDO, overflow: 'hidden' }}>
        <View style={{ width: `${avanceDe(d) * 100}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
      {unaFranja ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{`Franja de ${unaFranja}`}</Text> : null}
      {detalle.length ? (
        <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
          {detalle.map((x, i) => {
            const t = TIPO_BITACORA[x.tipo] ?? TIPO_BITACORA.lectura;
            return (
              <View key={`${x.area}-${x.tipo}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Insignia icono={t.icono} color={color} tamano={28} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{x.area}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                    {`${t.rotulo}${!unaFranja && x.desde && x.hasta ? ` · ${rango12(x.desde, x.hasta)}` : ''}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : areas.length ? (
        <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
          {areas.map((a, i) => (
            <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <Insignia icono="Clock" color={colorSistema.texto2} tamano={28} />
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{a}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ── Los traslados por respaldo ─────────────────────────────────────────────
// El panel resume cuántos, cuántas unidades y a cuántas salas. Debajo, un
// renglón por traslado con la cara de quien lo despachó: qué salió, a dónde y
// a qué hora. Se ven los primeros; el resto con «Ver los N traslados».
function FilaDeTraslado({ t, primero }) {
  const emp = usePersona(t.quienId, t.quien, t.quienFoto);
  const hora = hora12(t.hora);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <Cara emp={emp} tamano={28} icono="Truck" color={TONO.naranja} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${t.producto ?? 'Traslado'}${t.mas > 0 ? ` y ${t.mas} más` : ''}`}</Text>
        {/* El destino primero: es lo que la sala tiene que ir a comprobar. */}
        <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
          {[`→ ${t.destino}`, hora || null, emp ? shortEmployeeName(emp) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {t.unidades != null ? <Pildora texto={`×${t.unidades}`} color={TONO.naranja} /> : null}
    </View>
  );
}

function CuerpoDeTraslados({ d, expandida }) {
  const { traslados, unidades: u } = d;
  const visibles = expandida ? traslados : traslados.slice(0, TRASLADOS_VISIBLES);
  const salas = new Set(traslados.map((t) => t.destino)).size;
  return (
    <View style={{ gap: 8 }}>
      <Panel datos={[
        { etiqueta: traslados.length === 1 ? 'traslado' : 'traslados', valor: traslados.length },
        { etiqueta: u === 1 ? 'unidad' : 'unidades', valor: u },
        { etiqueta: salas === 1 ? 'sala' : 'salas', valor: salas },
      ]} />
      <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
        {visibles.map((t, i) => <FilaDeTraslado key={t.id ?? i} t={t} primero={!i} />)}
      </View>
    </View>
  );
}

// ── MIN·MAX por aprobar ────────────────────────────────────────────────────
// Arriba el producto y quién lo pide; las ventas de 6 meses y del último mes
// cerrado (con lo que va del mes y lo que hay en la sala); Hoy contra
// Propone; la presentación base, en qué se despacha y con qué factor; y el
// motivo con su rótulo. Si el MAX propuesto no llega a una presentación de
// despacho, se dice antes de aprobar.
const minmax = (min, max) => (min == null && max == null ? 'Sin definir' : `MIN ${min ?? '—'} · MAX ${max ?? '—'}`);

function CuerpoDeMinmax({ d }) {
  const { presentaciones: lista, despacho } = d;
  const base = lista[0] ?? null;
  // Sin regla ni presentación mayor, el canónico despacha «UNIDAD» ×1: es la
  // base misma, y se nombra como la base.
  const desp = despacho && !(despacho.unidades === 1 && base?.factor === 1) ? despacho : null;
  const total = d.ventasMeses.reduce((s, m) => s + m.unidades, 0);
  const ultimo = d.ventasMeses[d.ventasMeses.length - 1];
  const nombreMes = ultimo ? MESES[Number(ultimo.ym.slice(5, 7)) - 1] : null;
  const filas = [];
  if (d.producto) filas.push(<Bloque key="p" rotulo="Producto" color={TONO.azul} grande>{d.producto}</Bloque>);
  filas.push(<CeldaPersona key="q" id={d.quienId} nombre={d.quien} foto={d.quienFoto} rotulo="Lo pide" />);
  if (d.ventasMeses.length) {
    filas.push(
      <Fragment key="v">
        <Celda rotulo="En 6 meses" valor={`${unidades(total)} u.`} />
        <Celda rotulo="Último mes" valor={`${unidades(ultimo?.unidades ?? 0)} u.${nombreMes ? ` · ${nombreMes}` : ''}`} color={TONO.azul} derecha />
      </Fragment>,
    );
    if (d.ventasMesCurso != null || d.existencia != null) {
      filas.push(
        <Bloque key="vm">
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
            {d.ventasMesCurso != null ? <>Este mes van <Text style={{ color: colorSistema.texto, fontWeight: '800' }}>{`${unidades(d.ventasMesCurso)} u.`}</Text></> : null}
            {d.ventasMesCurso != null && d.existencia != null ? ' · ' : null}
            {d.existencia != null ? <>Hay <Text style={{ color: colorSistema.texto, fontWeight: '800' }}>{`${unidades(d.existencia)} u.`}</Text> en la sala</> : null}
          </Text>
        </Bloque>,
      );
    }
  }
  filas.push(
    <Fragment key="h">
      <Celda rotulo="Hoy" valor={minmax(d.minHoy, d.maxHoy)} />
      <Celda rotulo="Propone" valor={minmax(d.minNuevo, d.maxNuevo)} color={TONO.azul} derecha />
    </Fragment>,
  );
  if (base || desp) {
    // Si la base es también lo que se despacha, una sola celda: dos celdas
    // iguales lado a lado son la misma cosa dicha dos veces.
    filas.push(desp && desp.unidades !== base?.factor ? (
      <Fragment key="pr">
        <Celda rotulo="Base" valor={base ? base.tipo : '—'} detalle={base ? `factor ${unidades(base.factor)}` : null} />
        <Celda rotulo="Despacho" valor={desp.etiqueta} derecha
          detalle={desp.multiplo > 1 ? `${desp.multiplo} × ${unidades(desp.factor)} = ${unidades(desp.unidades)} u.` : `factor ${unidades(desp.factor)}`} />
      </Fragment>
    ) : (
      <Celda key="pr" rotulo="Base y despacho" valor={base?.tipo ?? desp?.etiqueta ?? '—'}
        detalle={`factor ${unidades(base?.factor ?? desp?.factor ?? 1)}`} />
    ));
    if (lista.length > 1) {
      filas.push(
        <Bloque key="ls" rotulo="Presentaciones">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {lista.map((p) => (
              <View key={`${p.tipo}-${p.factor}`} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.18)' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '700' }}>{`${p.tipo} ×${unidades(p.factor)}`}</Text>
              </View>
            ))}
          </View>
        </Bloque>,
      );
    }
  }
  if (d.motivo) filas.push(<Bloque key="m" rotulo="Por qué lo pide">{enOracion(d.motivo)}</Bloque>);
  return (
    <View style={{ gap: 8 }}>
      <Tabla>{filas}</Tabla>
      {maxNoAlcanzaParaDespachar(d) ? (
        <Advertencia texto={`MAX ${unidades(d.maxNuevo)} es menos de lo que se despacha (${despacho.etiqueta}, ${unidades(despacho.unidades)} u.): el pedido no mandará nada.`} />
      ) : null}
    </View>
  );
}

// ── Bolsa que no cuadró ────────────────────────────────────────────────────
// Cada bolsa con su fecha y hora del corte y su diferencia (FALTÓ en rojo,
// SOBRÓ en naranja); con varias, el neto al pie; y quién confirmó el conteo.
const difDeBolsa = (dif) => (dif < 0
  ? { rotulo: 'Faltó', color: TONO.rojo, valor: `−${formatMoney(Math.abs(dif))}` }
  : { rotulo: 'Sobró', color: TONO.naranja, valor: `+${formatMoney(dif)}` });

function CuerpoDeBolsa({ d }) {
  const neto = difDeBolsa(d.neto);
  const filas = d.lista.map((b) => {
    const x = difDeBolsa(b.dif);
    const cuando = [fechaCorta(b.fecha), b.hora && hora12(b.hora)].filter(Boolean).join(' · ');
    return (
      <Fragment key={b.folio}>
        <Celda rotulo="Bolsa del corte" valor={b.folio} detalle={cuando || null} />
        <Celda rotulo={x.rotulo} valor={x.valor} color={x.color} derecha />
      </Fragment>
    );
  });
  if (d.lista.length > 1) {
    filas.push(
      <Fragment key="t">
        <Celda rotulo="En total" valor={`${d.lista.length} bolsas`} />
        <Celda rotulo={neto.rotulo} valor={neto.valor} color={neto.color} derecha />
      </Fragment>,
    );
  }
  if (d.confirmoId || d.confirmo) {
    filas.push(<CeldaPersona key="c" id={d.confirmoId} nombre={d.confirmo} foto={d.confirmoFoto} rotulo="Confirmó el conteo" respaldo={d.confirmo ?? 'Sin nombre'} />);
  }
  return <Tabla>{filas}</Tabla>;
}

// ── Depósito al banco ──────────────────────────────────────────────────────
// El monto GRANDE en el cuerpo; quién lo lleva o lo cerró con su cara; de qué
// fecha a qué fecha son las bolsas, y lo que quedó en efectivo.
function CuerpoDeDeposito({ d }) {
  const banco = (d.banco ?? '').replace(/^Banco\s+/i, '');
  const rango = rangoDeFechas(d.desde, d.hasta);
  return (
    <View style={{ gap: 8 }}>
      {d.montoBanco > 0 || d.montoEfectivo > 0 ? (
        <View style={{ gap: 2 }}>
          {d.montoBanco > 0 ? (
            <Text>
              <Text style={{ color: TONO.verde, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.montoBanco)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>{`  al banco${banco ? ` · ${banco}` : ''}`}</Text>
            </Text>
          ) : null}
          {d.montoEfectivo > 0 ? (
            <Text>
              <Text style={{ color: TONO.verde, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.montoEfectivo)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>{`  en mano${d.entregadoA ? ` a ${d.entregadoA}` : ''}`}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}
      <Tabla>
        <CeldaPersona id={d.quienId} nombre={d.quien} foto={d.quienFoto} rotulo={d.quienLleva ? 'Lo lleva' : 'Lo cerró'} />
        <>
          <Celda rotulo="Conteo del" valor={rango ?? '—'} />
          <Celda rotulo="Quedó en efectivo" derecha
            valor={d.remanente >= 0.01 ? formatMoney(d.remanente) : 'Nada'}
            color={d.remanente >= 0.01 ? TONO.naranja : TONO.verde} />
        </>
      </Tabla>
    </View>
  );
}

// ── La alerta de CCF ───────────────────────────────────────────────────────
// De QUÉ factura se trata —número, cliente, monto, hora—, qué tiene y quién la
// vendió, con su cara.
function CuerpoDeAlertaDeVentas({ d }) {
  const color = d.tipo === 'consecutive_mh' ? TONO.naranja : TONO.rojo;
  const filas = [
    d.tipo === 'consecutive_mh' ? (
      <Fragment key="a">
        <Celda rotulo="Ventas seguidas" valor={d.seguidas ?? '—'} color={color} />
        <Celda rotulo="Desde la" valor={`N.º ${d.numero}`} derecha />
      </Fragment>
    ) : (
      <Fragment key="a">
        <Celda rotulo="CCF" valor={`N.º ${d.numero}`} />
        <Celda rotulo="Monto" valor={d.total != null ? formatMoney(d.total) : '—'} color={color} derecha />
      </Fragment>
    ),
  ];
  if (d.cliente) filas.push(<Bloque key="c" rotulo={`Cliente${d.hora ? ` · ${hora12(d.hora)}` : ''}`}>{d.cliente}</Bloque>);
  if (d.problemas.length) {
    filas.push(
      <Bloque key="p" rotulo="Qué tiene">
        <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{d.problemas.join(' · ')}</Text>
      </Bloque>,
    );
  }
  if (d.vendedorId || d.vendedor) filas.push(<CeldaPersona key="v" id={d.vendedorId} nombre={d.vendedor} foto={d.vendedorFoto} rotulo="La vendió" />);
  return <Tabla>{filas}</Tabla>;
}

// ── Factura de sala ────────────────────────────────────────────────────────
// Una fila por factura —qué, de qué fecha y cuánto— y el total al pie.
function CuerpoDeFacturaDeSala({ d }) {
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
      {d.lista.map((f, i) => (
        <View key={`${f.etiqueta}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{f.etiqueta}</Text>
            {f.fecha ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{fechaCorta(f.fecha)}</Text> : null}
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{f.monto != null ? formatMoney(f.monto) : '—'}</Text>
        </View>
      ))}
      {d.lista.length > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          <View style={{ flex: 1 }}><Rotulo>En total</Rotulo></View>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(d.total)}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Cortes sin confirmar ───────────────────────────────────────────────────
// Un renglón por corte con quién lo hizo, de qué día y a qué hora, y cómo
// quedó (FALTANTE / SOBRANTE / CUADRÓ / SIN CONTEO), igual que la tarjeta del
// corte.
const estadoDeTramo = (c) => (c.sinConteo ? 'sin_conteo' : c.tramo <= -0.01 ? 'falta' : c.tramo >= 0.01 ? 'sobra' : 'cuadra');

function FilaDeCortePendiente({ c, primero }) {
  const emp = usePersona(c.quienId, c.quien, c.quienFoto);
  const estado = estadoDeTramo(c);
  const color = TONO[CORTE[estado].tono];
  const cuando = [fechaCorta(c.fecha), hora12(c.hora)].filter(Boolean).join(' · ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <Cara emp={emp} tamano={28} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{emp ? shortEmployeeName(emp) : 'Desde la caja'}</Text>
        {cuando ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{cuando}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <Text style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{CORTE[estado].rotulo}</Text>
        {estado !== 'sin_conteo' ? (
          <Text style={{ color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{estado === 'cuadra' ? '$0.00' : firmado(c.tramo)}</Text>
        ) : null}
      </View>
    </View>
  );
}

function CuerpoDeCortesPendientes({ d }) {
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
      {d.lista.map((c, i) => <FilaDeCortePendiente key={c.id} c={c} primero={!i} />)}
    </View>
  );
}

// ── Pedidos: seguimiento, llegada y novedades ──────────────────────────────
// Cuatro pasos —Preparación · En camino · Llegó · Recibido— con el actual
// marcado: las barras dicen el avance y UNA línea dice el paso (con los cuatro
// nombres debajo, en el teléfono se partían a media palabra). Debajo, quién lo
// lleva con su cara y la novedad si la hubo, en rojo.
const PASOS_DE_PEDIDO = ['Preparación', 'En camino', 'Llegó', 'Recibido'];

function iconoDePedido(etapa) {
  if (etapa === 'problema') return ['Package', TONO.rojo];
  if (etapa === 'recibido') return ['CheckCircle2', TONO.verde];
  if (etapa === 'en_camino' || etapa === 'llego') return ['Truck', TONO.azul];
  return ['Package', TONO.azul];
}

function CuerpoDePedido({ d }) {
  const problema = d.etapa === 'problema';
  const actual = problema ? 3 : Math.max(0, ETAPAS_DE_PEDIDO.indexOf(d.etapa));
  const colorActual = problema ? TONO.rojo : TONO.azul;
  const conConductor = (d.etapa === 'en_camino' || d.etapa === 'llego') && (d.conductor || d.conductorId);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ gap: 5 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {PASOS_DE_PEDIDO.map((paso, i) => (
            <View key={paso} style={{ flex: 1, height: 6, borderRadius: 3,
              backgroundColor: i <= actual ? (problema && i === 3 ? TONO.rojo : TONO.azul) : FONDO }} />
          ))}
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700' }}>
          <Text style={{ color: colorSistema.texto2 }}>{`Paso ${actual + 1} de 4 · `}</Text>
          <Text style={{ color: colorActual }}>{problema ? 'Con novedad' : PASOS_DE_PEDIDO[actual]}</Text>
          {d.cajas != null ? <Text style={{ color: colorSistema.texto2 }}>{` · ${d.cajas === 1 ? '1 caja' : `${d.cajas} cajas`}`}</Text> : null}
        </Text>
      </View>
      {conConductor || d.detalle ? (
        <Tabla>
          {conConductor ? (
            <CeldaPersona key="c" id={d.conductorId} nombre={d.conductor} rotulo={d.etapa === 'llego' ? 'Llegó' : 'Lo lleva'} respaldo={d.conductor ?? 'Sin nombre'} />
          ) : null}
          {d.detalle ? (
            <Bloque key="d" rotulo={problema ? 'Qué pasó' : 'Nota'}>
              <Text style={{ color: problema ? TONO.rojo : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{d.detalle}</Text>
            </Bloque>
          ) : null}
        </Tabla>
      ) : null}
    </View>
  );
}

// ── La entrada: en el orden de la tarjeta del portal ───────────────────────
export function armarDeOperacion(n, { expandida = false } = {}) {
  let d = datosDeCorteNuevo(n);
  if (d) {
    const c = CORTE[d.estado];
    return { lado: <Insignia icono={c.icono} color={TONO[c.tono]} />, cuerpo: <CuerpoDeCorte d={d} />, ocultarTexto: true, expandir: null };
  }
  d = datosDeBitacoraPorVencer(n);
  if (d) {
    const color = tonoDeBitacora(d);
    return {
      lado: <Anillo pct={avanceDe(d) * 100} color={color} texto={d.cerrada ? '—' : String(d.quedan)} />,
      cuerpo: <CuerpoDeBitacora d={d} />, ocultarTexto: true, expandir: null,
    };
  }
  d = datosDeTrasladosPorRespaldo(n);
  if (d) {
    const mas = d.traslados.length > TRASLADOS_VISIBLES;
    return {
      lado: <Insignia icono="Truck" color={TONO.naranja} />,
      cuerpo: <CuerpoDeTraslados d={d} expandida={expandida} />,
      ocultarTexto: true,
      expandir: mas ? { cerrado: `Ver los ${d.traslados.length} traslados`, abierto: 'Ocultar traslados' } : null,
    };
  }
  d = datosDeMinmaxPendiente(n);
  if (d) return { lado: <Insignia icono="Gauge" color={TONO.azul} />, cuerpo: <CuerpoDeMinmax d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeBolsaNoCuadra(n);
  if (d) return { lado: <Insignia icono="Wallet" color={d.neto < 0 ? TONO.rojo : TONO.naranja} />, cuerpo: <CuerpoDeBolsa d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeDeposito(n);
  if (d) return { lado: <Insignia icono="Landmark" color={TONO.verde} />, cuerpo: <CuerpoDeDeposito d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeAlertaDeVentas(n);
  if (d) {
    return {
      lado: <Insignia icono="AlertTriangle" color={d.tipo === 'consecutive_mh' ? TONO.naranja : TONO.rojo} />,
      cuerpo: <CuerpoDeAlertaDeVentas d={d} />, ocultarTexto: true, expandir: null,
    };
  }
  d = datosDeFacturaDeSala(n);
  if (d) return { lado: <Insignia icono="ReceiptText" color={TONO.azul} />, cuerpo: <CuerpoDeFacturaDeSala d={d} />, ocultarTexto: true, expandir: null };
  d = datosDeCortesPendientes(n);
  if (d) return { lado: <Insignia icono="ClipboardCheck" color={TONO.naranja} />, cuerpo: <CuerpoDeCortesPendientes d={d} />, ocultarTexto: true, expandir: null };
  d = datosDePedido(n);
  if (d) {
    const [icono, color] = iconoDePedido(d.etapa);
    return { lado: <Insignia icono={icono} color={color} />, cuerpo: <CuerpoDePedido d={d} />, ocultarTexto: true, expandir: null };
  }
  return null;
}
