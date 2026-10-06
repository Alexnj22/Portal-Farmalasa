// Las tarjetas de CIERRES en la app — port fiel de `CierreDeMeta.jsx`,
// `TarjetaDeFaltante.jsx`, `TarjetaDeAperturas.jsx` y `TarjetaDeCreditos.jsx`
// del portal: el cierre de mes de una sala, el de la empresa y el del día; el
// faltante de caja de ayer y las diferencias pendientes; cómo abrió la mañana;
// y los créditos que se pasaron del mes.
//
// Los datos salen de las MISMAS funciones del núcleo que usa el portal, así que
// si un aviso cambia de forma las dos tarjetas se enteran juntas. Cada cifra,
// rótulo, cara, barra y color del portal está acá; lo único que cambia es el
// medio (teléfono) — y nada se recorta: el texto que no entra baja de renglón.
//
// Contrato: `armarDeCierres(n)` devuelve `null` si el aviso no es de este
// grupo, o `{ lado, cuerpo, ocultarTexto }`. `ocultarTexto` dice si el cuerpo
// reemplaza al `n.body` — la regla del portal: el texto sólo se muestra en el
// cierre de meta cuando no trae montos (`venta == null`), porque entonces el
// `body` ya viene escrito en porcentaje.
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { datosDeCierreDeEmpresa, datosDeCierreDeMeta, datosDeCierreDelDia } from '@nucleo/utils/cierreDeMeta';
import { datosDeDiferenciasPendientes, datosDeFaltanteDeCaja } from '@nucleo/utils/faltanteDeCaja';
import { datosDeAperturasDeLaManana } from '@nucleo/utils/aperturasDeLaManana';
import { datosDeCreditosVencidos, DIAS_EN_ROJO } from '@nucleo/utils/creditosVencidos';
import Avatar from '../../Avatar';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { usePersona } from '../persona';
import { FONDO, Insignia } from '../Piezas';
import { Host, Icon } from '@expo/ui';
import { iconoDe } from '../../../tema/iconos';

const $ = (v) => formatMoney(v);
const LADO = 44;

// La escala de cumplimiento del portal (`tonoDeCumplimiento`): 100 o más verde,
// de 95 a 100 ámbar, debajo rojo.
const tonoDeCumplimiento = (pct) => (pct >= 100 ? MARCA.verde : pct >= 95 ? MARCA.ambar : MARCA.rojo);

// El vendedor contra el promedio de su sala (`tonoContraPromedio`): verde 5%
// arriba, rojo 5% abajo, ámbar EN el promedio — y azul si no hay promedio.
const tonoContraPromedio = (parte, promedio) => {
  if (promedio == null || !Number.isFinite(promedio) || promedio <= 0) return MARCA.azulClaro;
  if (parte >= promedio * 1.05) return MARCA.verde;
  if (parte <= promedio * 0.95) return MARCA.rojo;
  return MARCA.ambar;
};

// ── Piezas de este grupo ─────────────────────────────────────────────────────

function Icono({ nombre, color, tamano = 16 }) {
  return <Host matchContents><Icon name={iconoDe(nombre)} size={tamano} color={color} /></Host>;
}

/** Un anillo de 44 px: el arco y lo que va adentro. `punto` marca el excedente
 *  sobre las doce (un 101.5% dibujado como vuelta completa más un punto). */
function Aro({ avance, color, children, punto }) {
  const r = (LADO - 6) / 2;
  const c = 2 * Math.PI * r;
  const a = Math.max(0, Math.min(1, Number(avance) || 0));
  return (
    <View style={{ width: LADO, height: LADO, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={LADO} height={LADO} style={{ position: 'absolute' }}>
        <Circle cx={LADO / 2} cy={LADO / 2} r={r} stroke={colorSistema.separador} strokeWidth={4} fill="none" />
        <Circle cx={LADO / 2} cy={LADO / 2} r={r} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round"
          strokeDasharray={`${a * c} ${c}`} transform={`rotate(-90 ${LADO / 2} ${LADO / 2})`} />
        {punto ? <Circle cx={LADO / 2} cy={3} r={3.2} fill={color} /> : null}
      </Svg>
      {children}
    </View>
  );
}

/** La cifra grande con su «de $X» al lado — el renglón que se lee primero. */
function CifraDe({ valor, de, color }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      {de ? <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{de}</Text> : null}
    </View>
  );
}

const Linea = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador }} />;

const Texto = ({ children, color, peso = '600', tamano = 13 }) => (
  <Text style={{ color: color ?? colorSistema.texto2, fontSize: tamano, fontWeight: peso }}>{children}</Text>
);

/** Una barra por sala: nombre, barra, monto opcional y porcentaje. El tope de
 *  la barra es 130%, como en el portal: con el tope en 100 una sala que hizo
 *  135% se vería idéntica a una que hizo justo la meta. */
function BarraDeSala({ sala, pct, monto, entero }) {
  const col = tonoDeCumplimiento(pct);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ width: 82, color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{sala}</Text>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: FONDO, overflow: 'hidden' }}>
        <View style={{ width: `${(Math.min(pct, 130) / 130) * 100}%`, height: 6, borderRadius: 3, backgroundColor: col }} />
      </View>
      {monto != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{$(monto)}</Text> : null}
      <Text style={{ minWidth: 46, textAlign: 'right', color: col, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {entero ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`}
      </Text>
    </View>
  );
}

// ── El anillo de la meta ─────────────────────────────────────────────────────
// El número sin el signo de %: el título lo dice con todas las letras.
function AnilloDeMeta({ pct }) {
  const col = tonoDeCumplimiento(pct);
  return (
    <Aro avance={Math.min(pct, 100) / 100} color={col} punto={pct > 100}>
      <Text style={{ color: col, fontSize: Math.round(pct) >= 100 ? 12 : 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{Math.round(pct)}</Text>
    </Aro>
  );
}

// ── El cierre de mes de una sala ─────────────────────────────────────────────

/** En qué lugar quedó LA PERSONA entre los vendedores de su sala. Primero y
 *  segundo con su medalla; el resto en una línea con el promedio. */
function PuestoDelVendedor({ d }) {
  const { puesto, de, promedio, miParte } = d;
  if (!puesto || !de || miParte == null) return null;
  const parte = `${miParte}% de la venta de la sala`;
  if (puesto <= 2) {
    const color = puesto === 1 ? MARCA.ambar : colorSistema.texto;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <Icono nombre={puesto === 1 ? 'Star' : 'Medal'} color={color} tamano={14} />
        <Text style={{ color, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {`${puesto === 1 ? '1er lugar' : '2º lugar'} de ${de}`}
        </Text>
        <Texto peso="500">{`· ${parte}`}</Texto>
      </View>
    );
  }
  const contra = promedio == null ? null
    : miParte >= promedio ? `sobre el promedio (${promedio}%)` : `bajo el promedio (${promedio}%)`;
  return <Texto>{`${puesto}º lugar de ${de} · ${parte}${contra ? ` · ${contra}` : ''}`}</Texto>;
}

function FilaDeVendedor({ v, tope, promedio }) {
  const emp = usePersona(v.employeeId, v.nombre, null);
  const col = tonoContraPromedio(v.parte, promedio);
  const persona = emp ?? { name: v.nombre, first_names: v.nombres, last_names: v.apellidos };
  const peso = v.yo ? '800' : '600';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 5,
      borderWidth: v.yo ? 1 : 0, borderColor: `${col}55` }}>
      {/* La participación es el FONDO de la fila, medida contra el mayor. */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(v.parte / tope) * 100}%`, backgroundColor: `${col}${v.yo ? '40' : '26'}` }} />
      {v.yo ? <View style={{ width: 2, alignSelf: 'stretch', borderRadius: 1, backgroundColor: col }} /> : null}
      <Avatar empleado={persona} tamano={24} />
      <Text style={{ flex: 1, color: col, fontSize: 13, fontWeight: peso }}>{shortEmployeeName(persona)}</Text>
      {v.venta != null ? <Text style={{ color: col, fontSize: 13, fontWeight: peso, fontVariant: ['tabular-nums'] }}>{$(v.venta)}</Text> : null}
      <Text style={{ minWidth: 46, textAlign: 'right', color: col, fontSize: 13, fontWeight: peso, fontVariant: ['tabular-nums'] }}>{`${v.parte.toFixed(1)}%`}</Text>
    </View>
  );
}

function CuerpoDeCierreDeMeta({ d }) {
  const { venta, meta, metaNueva, mesCerrado, mesNuevo, tabla } = d;
  const mesCorto = (mesCerrado || '').split(' ')[0];
  const delta = meta && metaNueva ? ((metaNueva - meta) / meta) * 100 : null;
  const tope = tabla?.length ? Math.max(...tabla.map((f) => f.parte), 1) : 1;
  return (
    <View style={{ gap: 8 }}>
      {venta != null ? <CifraDe valor={$(venta)} de={meta != null ? `de ${$(meta)}` : null} /> : null}
      <PuestoDelVendedor d={d} />
      {tabla?.length ? (
        <View style={{ gap: 2 }}>
          {tabla.map((v, i) => <FilaDeVendedor key={v.employeeId || `${v.nombre}-${i}`} v={v} tope={tope} promedio={d.promedio} />)}
        </View>
      ) : null}
      {venta != null && metaNueva != null ? (
        <>
          <Linea />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>{mesNuevo}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{$(metaNueva)}</Text>
            {delta != null && Math.abs(delta) >= 0.05 && mesCorto ? (
              <Texto peso="500">{`${Math.abs(delta).toFixed(1)}% ${delta < 0 ? 'menos' : 'más'} que ${mesCorto}`}</Texto>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── El cierre de mes de la empresa ───────────────────────────────────────────

const MEDALLA = [MARCA.ambar, colorSistema.texto, colorSistema.texto2];

function FilaDelPodio({ v, i }) {
  const emp = usePersona(v.employeeId, v.nombre, null) ?? { name: v.nombre };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ width: 22, color: MEDALLA[i] ?? colorSistema.texto2, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${i + 1}º`}</Text>
      <Avatar empleado={emp} tamano={28} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '800' }}>{shortEmployeeName(emp)}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{v.sala}</Text>
      </View>
      {v.venta != null ? <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{$(v.venta)}</Text> : null}
    </View>
  );
}

function CuerpoDeCierreDeEmpresa({ d }) {
  const { venta, meta, sucursales, top3 } = d;
  return (
    <View style={{ gap: 8 }}>
      {venta != null ? <CifraDe valor={$(venta)} de={meta != null ? `de ${$(meta)}` : null} /> : null}
      {sucursales?.length ? (
        <View style={{ gap: 6 }}>
          {sucursales.map(({ sala, pct }) => <BarraDeSala key={sala} sala={sala} pct={pct} />)}
        </View>
      ) : null}
      {top3?.length ? (
        <>
          <Linea />
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>Los que más vendieron</Text>
          <View style={{ gap: 8 }}>{top3.map((v, i) => <FilaDelPodio key={v.employeeId ?? i} v={v} i={i} />)}</View>
        </>
      ) : null}
    </View>
  );
}

// ── El cierre del DÍA ────────────────────────────────────────────────────────

/** La caja: sólo se menciona cuando hay algo que mirar; un día en orden dice
 *  una línea corta en verde (no se calla: «no dice nada» y «no lo comprobé»
 *  se ven igual). */
function LineaDeCaja({ d }) {
  const { cajas, cajasCuadraron, salasSinCerrar, sucursales } = d;
  const conDif = sucursales.filter((s) => s.diferencia != null && Math.abs(s.diferencia) >= 0.005);
  const sinContar = sucursales.filter((s) => s.diferencia == null);
  if (!conDif.length && !sinContar.length && !salasSinCerrar.length) {
    return <Texto color={MARCA.verde}>{cajas === 1 ? 'La caja cuadró' : `Las ${cajasCuadraron ?? cajas} cajas cuadraron`}</Texto>;
  }
  return (
    <View style={{ gap: 4 }}>
      {conDif.map((s) => (
        <Text key={s.sala} style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>
          {`${s.sala}  `}
          <Text style={{ color: s.diferencia < 0 ? MARCA.rojo : MARCA.ambar, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {`${s.diferencia > 0 ? '+' : ''}${$(s.diferencia)}`}
          </Text>
          <Text style={{ color: colorSistema.texto2 }}>{`  ${s.diferencia < 0 ? 'faltaron' : 'sobraron'}`}</Text>
        </Text>
      ))}
      {sinContar.length ? <Texto>{`Sin corte confirmado: ${sinContar.map((s) => s.sala).join(', ')}`}</Texto> : null}
      {salasSinCerrar.length ? <Texto color={MARCA.ambar}>{`No cerraron: ${salasSinCerrar.join(', ')}`}</Texto> : null}
    </View>
  );
}

function CuerpoDeCierreDelDia({ d }) {
  const { venta, meta, sucursales, variacion, contra } = d;
  return (
    <View style={{ gap: 8 }}>
      {venta != null ? <CifraDe valor={$(venta)} de={meta != null ? `de ${$(meta)}` : null} /> : null}
      {/* La variación en palabras; se calla debajo de medio punto. */}
      {variacion != null && Math.abs(variacion) >= 0.5 ? (
        <Texto color={variacion > 0 ? MARCA.verde : MARCA.rojo}>
          {`${Math.abs(variacion).toFixed(0)}% ${variacion > 0 ? 'más' : 'menos'}${contra ? ` que ${contra}` : ''}`}
        </Texto>
      ) : null}
      {sucursales?.length ? (
        <View style={{ gap: 6 }}>
          {sucursales.map(({ sala, pct, venta: vs }) => <BarraDeSala key={sala} sala={sala} pct={pct} monto={vs} entero />)}
        </View>
      ) : null}
      <Linea />
      <LineaDeCaja d={d} />
    </View>
  );
}

// ── El faltante de caja de ayer ──────────────────────────────────────────────
// El anillo dibuja CUÁNTO SE CONTÓ de lo que debía haber: el hueco es el
// faltante. Sin `esperado`, o con arrastre (el esperado es un derivado), queda
// el ícono en su disco — un anillo vacío diría «se contó cero».

function AnilloDeFaltante({ d }) {
  const { contado, esperado, arrastre } = d;
  const hayArco = Math.abs(Number(arrastre) || 0) < 0.01 && contado != null && esperado != null && esperado > 0;
  if (!hayArco) return <Insignia icono="TrendingDown" color={MARCA.rojo} />;
  return (
    <Aro avance={contado / esperado} color={MARCA.rojo}>
      <Icono nombre="TrendingDown" color={MARCA.rojo} tamano={15} />
    </Aro>
  );
}

function CuerpoDeFaltanteDeCaja({ d }) {
  const { falta, sala, hora, contado, esperado, proporcion, arrastre, arrastreDesde, aportes, confirmoId, confirmoNombre } = d;
  const confirmo = usePersona(confirmoId, confirmoNombre, null);
  const conArrastre = Math.abs(Number(arrastre) || 0) >= 0.01;
  const avance = !conArrastre && contado != null && esperado != null && esperado > 0
    ? Math.max(0, Math.min(contado / esperado, 1)) : null;
  return (
    <View style={{ gap: 8 }}>
      <CifraDe valor={`−${$(falta)}`} color={MARCA.rojo} de={esperado != null ? `de ${$(esperado)} que debía haber` : null} />
      {proporcion != null && proporcion * 100 >= 0.5 ? (
        <Texto color={MARCA.rojo}>{`${(proporcion * 100).toFixed(1)}% de lo que debía haber en el cajón`}</Texto>
      ) : null}
      {avance != null ? (
        <View style={{ gap: 4 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: FONDO, overflow: 'hidden' }}>
            <View style={{ width: `${avance * 100}%`, height: 6, borderRadius: 3, backgroundColor: MARCA.rojo }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Texto peso="500">{`contó ${$(contado)}`}</Texto>
            <Texto peso="500">{`debía ${$(esperado)}`}</Texto>
          </View>
        </View>
      ) : null}
      {conArrastre ? (
        <Texto color={arrastre > 0 ? MARCA.ambar : MARCA.rojo}>
          {`${arrastre > 0 ? '+' : '−'}${$(Math.abs(arrastre))} de ${arrastre > 0 ? 'sobrante' : 'faltante'} venía `
            + (aportes === 1 && arrastreDesde ? `del corte de las ${arrastreDesde}` : `de ${aportes ?? 'varios'} cortes anteriores`)}
        </Texto>
      ) : null}
      {sala || hora ? <Texto>{`${sala ?? ''}${sala && hora ? ' · ' : ''}${hora ? `corte de las ${hora}` : ''}`}</Texto> : null}
      {confirmoNombre ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Avatar empleado={confirmo ?? { name: confirmoNombre }} tamano={22} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {'Lo confirmó '}
            <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{shortEmployeeName(confirmo ?? confirmoNombre)}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Las diferencias pendientes de una sala ───────────────────────────────────
// El monto una vez, y al lado de qué es; el desglose sólo con DOS partes.

function CuerpoDeDiferenciasPendientes({ d }) {
  const { sinResolver, montoSinResolver, conSaldo, porCobrar, total } = d;
  const partes = [
    sinResolver > 0 && { k: 'sin', color: MARCA.rojo, monto: montoSinResolver, texto: `${sinResolver} ${sinResolver === 1 ? 'corte sin resolver' : 'cortes sin resolver'}` },
    porCobrar > 0 && { k: 'cobrar', color: MARCA.ambar, monto: porCobrar, texto: conSaldo > 1 ? `por cobrar en ${conSaldo} cortes` : 'por cobrar a responsables' },
  ].filter(Boolean);
  const dos = partes.length > 1;
  return (
    <View style={{ gap: 6 }}>
      <CifraDe valor={$(total)} color={MARCA.rojo} de={dos ? 'pendientes' : partes[0]?.texto} />
      {dos ? (
        <>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: FONDO, overflow: 'hidden', flexDirection: 'row', gap: 1 }}>
            <View style={{ width: `${(montoSinResolver / total) * 100}%`, backgroundColor: MARCA.rojo }} />
            <View style={{ width: `${(porCobrar / total) * 100}%`, backgroundColor: MARCA.ambar }} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
            {partes.map((p) => (
              <View key={p.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.color }} />
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  <Text style={{ color: p.color, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{$(p.monto)}</Text>
                  {` ${p.texto}`}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── Cómo abrió la mañana ─────────────────────────────────────────────────────
// El anillo lleva CUÁNTAS de las seis abrieron («5 de 6» se lee de un vistazo);
// cada renglón se tiñe cuando su hora cruzó las 7:00.

function AnilloDeAperturas({ d }) {
  const col = d.completa ? MARCA.verde : MARCA.rojo;
  return (
    <Aro avance={d.abiertas / d.total} color={col}>
      <Text style={{ color: col, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{d.abiertas}</Text>
    </Aro>
  );
}

function FilaDeApertura({ s }) {
  const emp = usePersona(s.employeeId, s.quien, null);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <Text style={{ minWidth: 72, color: s.tarde ? MARCA.ambar : MARCA.verde, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{hora12(s.hora)}</Text>
      {s.employeeId ? <Avatar empleado={emp ?? { name: s.quien }} tamano={24} /> : (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: FONDO, alignItems: 'center', justifyContent: 'center' }}>
          <Icono nombre="Home" color={colorSistema.texto2} tamano={12} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{s.sala}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 12, fontStyle: s.quien ? 'normal' : 'italic' }}>{s.quien || 'desde la caja'}</Text>
      </View>
    </View>
  );
}

function CuerpoDeAperturas({ d }) {
  const { salas, total, abiertas, completa, noAbrieron, sinRespuesta, horaAviso, ultima, conRetraso } = d;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 }}>
        <Text style={{ color: completa ? colorSistema.texto : MARCA.rojo, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${abiertas} de ${total}`}</Text>
        {ultima ? (
          <Text style={{ color: conRetraso ? MARCA.ambar : colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>
            {`la última, ${ultima.sala} a las ${hora12(ultima.hora)}`}
          </Text>
        ) : null}
      </View>
      {noAbrieron.length ? (
        <Texto color={MARCA.rojo} peso="700">
          {`${horaAviso ? `A las ${hora12(horaAviso) || horaAviso} todavía no ` : 'Todavía no '}${noAbrieron.length === 1 ? 'abría ' : 'abrían '}${noAbrieron.join(', ')}`}
        </Texto>
      ) : null}
      {sinRespuesta.length ? <Texto color={MARCA.ambar} peso="700">{`No se pudo comprobar ${sinRespuesta.join(', ')}`}</Texto> : null}
      {salas.length ? <View>{salas.map((s, i) => <FilaDeApertura key={s.branchId ?? `${s.sala}-${i}`} s={s} />)}</View> : null}
    </View>
  );
}

// ── Los créditos que se pasaron del mes ──────────────────────────────────────
// El color sale de la ANTIGÜEDAD, no del monto: ámbar pasado el plazo, rojo
// pasados los `DIAS_EN_ROJO`. Cuántos y cuánto van en el título.

const tonoDeDias = (dias) => (dias != null && dias >= DIAS_EN_ROJO ? MARCA.rojo : MARCA.ambar);

function CuerpoDeCreditos({ d }) {
  const { resumen, dias, salas, tope } = d;
  return (
    <View style={{ gap: 8 }}>
      {dias != null ? <Texto color={tonoDeDias(dias)} peso="700">{`El más viejo lleva ${dias} días`}</Texto> : null}
      {resumen ? (
        <View style={{ gap: 6 }}>
          {salas.map((s) => {
            const col = tonoDeDias(s.dias);
            return (
              <View key={s.branchId ?? s.sala} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ width: 82, color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{s.sala}</Text>
                <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: FONDO, overflow: 'hidden' }}>
                  <View style={{ width: `${tope > 0 ? (s.total / tope) * 100 : 0}%`, height: 6, borderRadius: 3, backgroundColor: col }} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{s.creditos}</Text>
                <Text style={{ minWidth: 72, textAlign: 'right', color: col, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{$(s.total)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── El armado ────────────────────────────────────────────────────────────────
// El LADO sigue la prioridad del portal: faltante, diferencias pendientes,
// aperturas, créditos y, si nada de eso, el anillo de la meta (mes, empresa o
// día). El CUERPO dibuja cada pieza que el aviso tenga.
export function armarDeCierres(n) {
  const cierre = datosDeCierreDeMeta(n);
  const empresa = datosDeCierreDeEmpresa(n);
  const delDia = datosDeCierreDelDia(n);
  const conAnillo = cierre || empresa || delDia;
  const faltante = datosDeFaltanteDeCaja(n);
  const difPend = datosDeDiferenciasPendientes(n);
  const aperturas = datosDeAperturasDeLaManana(n);
  const creditos = datosDeCreditosVencidos(n);
  if (!conAnillo && !faltante && !difPend && !aperturas && !creditos) return null;

  const lado = faltante ? <AnilloDeFaltante d={faltante} />
    : difPend ? <Insignia icono="Wallet" color={MARCA.rojo} />
    : aperturas ? <AnilloDeAperturas d={aperturas} />
    : creditos ? <Insignia icono="HandCoins" color={tonoDeDias(creditos.dias)} />
    : <AnilloDeMeta pct={conAnillo.pct} />;

  const cuerpo = (
    <View style={{ gap: 10 }}>
      {cierre ? <CuerpoDeCierreDeMeta d={cierre} /> : null}
      {empresa ? <CuerpoDeCierreDeEmpresa d={empresa} /> : null}
      {delDia ? <CuerpoDeCierreDelDia d={delDia} /> : null}
      {faltante ? <CuerpoDeFaltanteDeCaja d={faltante} /> : null}
      {difPend ? <CuerpoDeDiferenciasPendientes d={difPend} /> : null}
      {aperturas ? <CuerpoDeAperturas d={aperturas} /> : null}
      {creditos ? <CuerpoDeCreditos d={creditos} /> : null}
    </View>
  );

  // El body se muestra sólo en el cierre de meta sin montos (ya viene en %).
  const ocultarTexto = !(cierre && cierre.venta == null);
  return { lado, cuerpo, ocultarTexto };
}
