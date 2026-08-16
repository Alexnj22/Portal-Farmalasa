import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { EmptyState } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';

// Quién está vendiendo este mes. Top 2 resaltado, el resto en gris, y en ROJO
// quien está bajo el promedio de la sala (decisión del usuario 2026-08-05).
//
// El interruptor «total / por día» existe porque sin él el ranking castiga a
// quien faltó. Medido con agosto real: Katherine vendió UN día y ese día hizo
// $334.60 — más que quien trabajó cuatro. Por total queda 6ª; por día, 4ª.
// Marcarla en rojo por el total sería reprocharle la ausencia, no la venta.
//
// Y «por día» tampoco alcanza, porque un día no es una unidad comparable: el
// horario real de la empresa tiene jornadas de 6, 7, 8, 9 y 11 horas, y semanas
// de 9, 16, 36 y 44. Medido en agosto en La Popular, la ventana de venta de
// Katherine Salinas promedia 5.7 h contra 7.5 h de Nataly Flores: por día queda
// 5ª y por hora queda 1ª. Media jornada seguía castigada por el interruptor que
// existía para no castigarla.
//
// De ahí «Por hora», que divide por las HORAS PROGRAMADAS del horario publicado
// (`employee_rosters`) — no por un reloj, porque las horas trabajadas no son un
// dato del portal todavía: `attendance` tiene 0 filas y `timesheets` no trae
// ninguna hora. Las cuenta el servidor, con la misma regla que el módulo de
// Horarios (ver la migración `..._metas_mes_en_curso_venta_por_hora`).
//
// «días» sigue siendo los días en que efectivamente vendió: es el único dato de
// presencia que existe. El día que se registren incapacidades y vacaciones, el
// servidor cambia el denominador y esta pantalla no se entera.
const ORDENES = [
    { value: 'total', label: 'Total' },
    { value: 'dia',   label: 'Por día' },
    { value: 'hora',  label: 'Por hora' },
];

// Las tres vistas dicen lo mismo tres veces —qué columna ordena, con qué
// promedio se compara y cómo se lee en la línea del encabezado—, así que viven
// en un solo mapa. Estaban repetidas dentro y fuera del `useMemo`, que es
// exactamente el par que se desincroniza al agregar la tercera.
const CLAVE    = { total: 'venta',          dia: 'venta_dia',    hora: 'venta_hora'    };
const PROMEDIO = { total: 'promedio_venta', dia: 'promedio_dia', hora: 'promedio_hora' };
const SUFIJO   = { total: '',               dia: ' por día',     hora: ' por hora'     };

// 87.5 h se escribe con el decimal; 96.0 h, sin él. `toFixed(1)` solo dejaría
// «96.0», que en una línea de seis datos es un decimal que no informa nada.
const horasCortas = (h) => Number(Number(h).toFixed(1));

// `vistaCompleta` (permiso `dash_vendedores_vista_completa` en el widget del
// Inicio; siempre true dentro del módulo Metas, que es de supervisión): apagada,
// el ranking sigue completo pero deja de decir CUÁNTO vendió cada quien. En su
// lugar va su participación en la venta de la sala —el mismo orden, la misma
// barra, la misma marca del promedio— y el ticket promedio pasa al frente, que
// es lo que la persona puede mover con lo que hace en el mostrador.
export default function RankingVendedores({ data, compacto = false, vistaCompleta = true }) {
    const [orden, setOrden] = useState('total');

    // «Por hora» sólo si el horario publicado alcanza a TODA la lista. Con
    // cobertura parcial la columna mezclaría dos unidades —unos divididos por
    // sus horas, otros por nada— y eso no es un ranking, es dos rankings
    // superpuestos. El servidor manda el conteo (`con_horario` de `personas`)
    // en vez de dejar que la pantalla lo deduzca de los nulos.
    const horaDisponible = Number(data?.personas || 0) > 0
        && Number(data?.con_horario || 0) === Number(data?.personas);
    // Si el horario deja de cubrir a todos entre dos refrescos, la vista cae
    // sola a «Total» en vez de quedarse ordenando por una columna vacía.
    const ordenActivo = orden === 'hora' && !horaDisponible ? 'total' : orden;

    const { filas, promedio, maximo, total } = useMemo(() => {
        const clave = CLAVE[ordenActivo];
        const base = (data?.vendedores || []).map((v) => ({
            ...v,
            venta: Number(v.venta),
            ticket: Number(v.ticket),
            dias: Number(v.dias),
            venta_dia: Number(v.venta_dia),
            horas: Number(v.horas || 0),
            dias_horario: Number(v.dias_horario || 0),
            // `|| 0` y no `Number(null)`: sin horario `venta_hora` viene nulo y
            // `NaN` rompería el orden entero, no sólo esa fila.
            venta_hora: Number(v.venta_hora || 0),
            dias_sin_turno: Number(v.dias_sin_turno || 0),
        }));
        const prom = Number(data?.[PROMEDIO[ordenActivo]] || 0);
        const ord = [...base].sort((a, b) => b[clave] - a[clave]);
        return {
            filas: ord,
            promedio: prom,
            maximo: ord.length ? ord[0][clave] : 0,
            // La suma de la columna que se está ordenando: es el denominador de
            // la participación de cada quien cuando no se muestran montos.
            total: ord.reduce((s, v) => s + v[clave], 0),
        };
    }, [data, ordenActivo]);

    // Dentro de un widget la tarjeta la pone el `WidgetCard`, y el título
    // también: hasta el 2026-08-10 este componente dibujaba SU tarjeta y SU
    // encabezado adentro de los del widget, así que se veía un marco dentro de
    // otro y «Quién está vendiendo» escrito dos veces, una debajo de la otra.
    //
    // Es un objeto de props y no un componente envoltorio: un componente
    // definido en el cuerpo del render se vuelve a crear en cada pintada y React
    // desmonta y remonta todo lo que tiene adentro.
    const envase = compacto ? {} : { 'data-surface': 'card', className: 'p-5' };

    if (!filas.length) {
        return (
            <div {...envase}>
                <EmptyState
                    compact icon={Users}
                    title="Sin ventas este mes"
                    subtitle="Cuando alguien registre una venta, aparece acá con su puesto."
                />
            </div>
        );
    }

    const clave  = CLAVE[ordenActivo];
    const sufijo = SUFIJO[ordenActivo];

    // La opción «Por hora» se OFRECE apagada sólo donde hay a quién decirle qué
    // falta —el módulo, que es supervisión y publica los horarios—. En el
    // widget de la sala se esconde hasta que sirve: un botón que no hace nada
    // en una tarjeta de 300px es ruido, no una explicación.
    const opciones = ORDENES
        .filter(o => o.value !== 'hora' || horaDisponible || !compacto)
        .map(o => (o.value === 'hora' && !horaDisponible ? { ...o, disabled: true } : o));

    // En dos columnas cuando la lista es larga y hay ancho para las dos.
    //
    // Con 36 personas la lista mide 2,436px —dos pantallas y media— y era la
    // mitad alta de un carril de dos tarjetas, así que arrastraba a la gráfica
    // de al lado a medir lo mismo con 279px de contenido adentro. Hoy la tarjeta
    // ocupa el ancho entero (ver `TabTablero`) y la fila sigue midiendo lo mismo
    // que antes —648px— pero entran dos, y el alto se parte por la mitad.
    //
    // `columns-2` y no un grid: reparte solo, deja 18 y 18 sin que nadie cuente,
    // y con 37 pone 19 y 18. El orden de lectura queda el del podio — se baja
    // por la primera columna y se sigue por la segunda.
    //
    // No aplica en el widget del tablero (`compacto`), que vive en una columna
    // angosta; ni con listas cortas, donde dos columnas de tres se leen como un
    // error de maquetación.
    const dosColumnas = !compacto && filas.length >= 12;

    return (
        <div {...envase}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="min-w-0">
                    {/* El rótulo sólo fuera del widget: adentro ya lo dice el
                        encabezado del `WidgetCard`, y con el selector de sala al
                        lado el nombre de la sala también está dicho. */}
                    {!compacto && (
                        <p className="text-caption font-black uppercase tracking-widest text-content-3">
                            Venta por vendedor · {data?.sala}
                        </p>
                    )}
                    {/* Sin vista completa la línea se reduce al ticket de la
                        sala: el promedio vendido por persona es un monto, y con
                        el número de personas al lado se despeja la venta total
                        de la sala en una multiplicación. */}
                    <p className="text-label font-semibold text-content-3 mt-0.5 tabular-nums">
                        {vistaCompleta ? (
                            <>
                                {filas.length} persona{filas.length !== 1 ? 's' : ''} · promedio{' '}
                                <strong className="text-content-2">{formatMoney(promedio)}</strong>{sufijo}
                                {data?.promedio_ticket != null && (
                                    <> · ticket de la sala <strong className="text-content-2">{formatMoney(data.promedio_ticket)}</strong></>
                                )}
                            </>
                        ) : data?.promedio_ticket != null ? (
                            <>Ticket de la sala <strong className="text-content-2">{formatMoney(data.promedio_ticket)}</strong></>
                        ) : (
                            <>{filas.length} persona{filas.length !== 1 ? 's' : ''}</>
                        )}
                    </p>
                </div>
                <SegmentedControl
                    options={opciones} value={ordenActivo} onChange={setOrden} size="sm"
                    label="Cómo ordenar el ranking"
                />
            </div>

            <ul className={dosColumnas ? 'xl:columns-2 xl:gap-x-8 [column-rule:1px_solid_var(--divider)]' : ''}>
                {filas.map((v, i) => {
                    const valor = v[clave];
                    const bajo = valor < promedio;
                    const top = i < 2;
                    const ancho = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
                    const marca = maximo > 0 ? Math.min(100, (promedio / maximo) * 100) : 0;
                    // Un solo día trabajado explica un total bajo, así que se
                    // dice en ámbar: nadie debería leer el último puesto sin ese
                    // dato al lado.
                    const pocosDias = v.dias <= 1;

                    return (
                        <li
                            key={`${v.employee_id}-${v.sala}`}
                            // `mb-0.5` en cada fila y no `space-y` en la lista:
                            // con `columns`, `space-y` le pone margen arriba a la
                            // primera de la segunda columna —no es la primera
                            // hija— y las dos columnas arrancan desalineadas.
                            // `break-inside-avoid` es lo que impide que una fila
                            // se parta al pie de la columna.
                            className={`grid grid-cols-[26px_1fr_auto] gap-3 items-center rounded-xl px-1.5 py-2 mb-0.5 break-inside-avoid ${
                                top ? 'bg-chart-1/8' : bajo ? 'bg-danger/6' : ''
                            }`}
                        >
                            <span className={`text-label font-black text-center tabular-nums ${
                                top ? 'text-chart-1-text' : bajo ? 'text-danger-text' : 'text-content-3'
                            }`}>
                                {i + 1}º
                            </span>

                            <div className="min-w-0">
                                {/* El recorte va sobre el NOMBRE, no sobre la
                                    línea entera: con `truncate` en el `<p>`, un
                                    nombre largo se comía los dos sufijos y la
                                    sucursal desaparecía sin dejar rastro (medido
                                    en el teléfono: «· La Popular» quedaba 29px
                                    afuera). El nombre se puede acortar; saber de
                                    qué sala es el vendedor, no.

                                    Acá vivía «· EL MÁS ALTO» sobre el primer
                                    puesto, y el rótulo le comía 96px al nombre
                                    justo en la fila donde más importa leerlo:
                                    en el widget, «Nataly Flores» salía «Nataly
                                    Flor…». Era además el único dato dicho dos
                                    veces — el «1º», el resalte y la barra más
                                    larga ya dicen quién va primero. Quitado a
                                    pedido del usuario (2026-08-16). */}
                                <p className={`flex items-baseline text-body-sm font-black ${bajo ? 'text-danger-text' : 'text-content'}`}>
                                    <span className="min-w-0 truncate">{v.nombre}</span>
                                    {data?.todas && v.sala && (
                                        <span className="shrink-0 text-micro font-semibold text-content-3">&nbsp;· {v.sala}</span>
                                    )}
                                </p>
                                {/* Con vista completa, el ticket es un dato más de
                                    la línea. Sin ella pasa al frente y en negro:
                                    es lo único que queda para comparar dos filas
                                    de cerca, y la venta por día se va con los
                                    demás montos. */}
                                {vistaCompleta ? (
                                    <p className="text-micro font-semibold text-content-3 tabular-nums mt-0.5">
                                        {v.tickets} tickets · {formatMoney(v.ticket)} c/u ·{' '}
                                        <span className={pocosDias ? 'text-warning-text font-black' : undefined}>
                                            {v.dias} día{v.dias !== 1 ? 's' : ''}
                                        </span>
                                        {/* Ordenando por hora, el dato que falta
                                            para leer la cifra de la derecha es el
                                            denominador — las horas, no la venta
                                            por día, que ya tiene su propia vista.
                                            Los días del horario sólo se nombran
                                            cuando NO son todos: si coinciden, ya
                                            están dichos dos palabras antes. */}
                                        {ordenActivo === 'hora' ? (
                                            <>
                                                {' · '}{horasCortas(v.horas)} h
                                                {v.dias_horario !== v.dias && ` en ${v.dias_horario}`}
                                            </>
                                        ) : (
                                            <>{' · '}{formatMoney(v.venta_dia)}/día</>
                                        )}
                                    </p>
                                ) : (
                                    <p className="text-label font-semibold text-content-3 tabular-nums mt-0.5">
                                        <strong className="text-body-sm font-black text-content">{formatMoney(v.ticket)}</strong>
                                        {' '}de ticket · {v.tickets} tickets ·{' '}
                                        <span className={pocosDias ? 'text-warning-text font-black' : undefined}>
                                            {v.dias} día{v.dias !== 1 ? 's' : ''}
                                        </span>
                                    </p>
                                )}
                                {/* Lo que no cuadra con el horario. Va en toda
                                    vista —también sin montos— porque no dice
                                    cuánto vendió nadie, y es un HECHO, no un
                                    veredicto: «sin turno» puede ser una venta mal
                                    asignada o un horario que nadie actualizó, y
                                    quién de las dos lo sabe la sala, no el
                                    portal. Medido en agosto: Adriana Ramirez
                                    lleva 11 días así con jornada completa (es su
                                    horario el que está viejo) y Katlin Molina
                                    uno solo con un ticket a las 15:37. */}
                                {(v.sala_ajena || v.dias_sin_turno > 0) && (
                                    <p className="text-micro font-black uppercase tracking-wider text-warning-text mt-0.5">
                                        {v.sala_ajena && 'No es su sala'}
                                        {v.sala_ajena && v.dias_sin_turno > 0 && ' · '}
                                        {v.dias_sin_turno > 0 &&
                                            `${v.dias_sin_turno} día${v.dias_sin_turno !== 1 ? 's' : ''} sin turno`}
                                    </p>
                                )}
                                <div className="relative h-1.5 rounded-full bg-surface-card-hover mt-1.5">
                                    <span
                                        className={`absolute inset-y-0 left-0 rounded-full ${
                                            top ? 'bg-chart-1' : bajo ? 'bg-danger' : 'bg-content-3/50'
                                        }`}
                                        style={{ width: `${ancho}%` }}
                                    />
                                    {/* La marca es el promedio: estar a su izquierda
                                        o a su derecha es la respuesta a «¿voy bien?». */}
                                    <span
                                        className="absolute -inset-y-1 w-0.5 rounded-full bg-content-2"
                                        style={{ left: `${marca}%` }}
                                    />
                                </div>
                            </div>

                            <div className="text-right">
                                {/* Sin vista completa, la participación en la venta
                                    de la sala: ordena igual que el monto y deja
                                    leer la distancia entre dos puestos, sin decir
                                    cuánto vendió nadie. */}
                                <p className={`text-body-sm font-black tabular-nums ${bajo ? 'text-danger-text' : 'text-content'}`}>
                                    {vistaCompleta
                                        ? formatMoney(valor)
                                        : formatPct(total > 0 ? (valor / total) * 100 : 0)}
                                </p>
                                {/* El color no viaja solo: cada fila lo dice con
                                    palabras, para quien no distingue rojo y verde. */}
                                <p className={`text-micro font-black uppercase tracking-wider ${
                                    bajo ? 'text-danger-text' : 'text-success-text'
                                }`}>
                                    {bajo ? 'bajo el promedio' : 'sobre el promedio'}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {!compacto && (
                <div className="text-micro font-semibold text-content-3 mt-3 space-y-1">
                    <p>
                        La marca de cada barra es el promedio.{' '}
                        <strong className="text-warning-text">Quien trabajó un solo día</strong> lo lleva anotado:
                        un total bajo con pocos días no es lo mismo que un total bajo con el mes entero.
                    </p>
                    {/* Por qué el botón está apagado, dicho donde se puede hacer
                        algo al respecto: el módulo es de supervisión y es quien
                        publica los horarios. En el widget de la sala el botón ni
                        se ofrece, así que no hay nada que explicar. */}
                    <p>
                        {horaDisponible ? (
                            <><strong className="text-content-2">Por hora</strong> divide entre las horas que el
                            horario publicado le asigna a cada día que la persona vendió — así media jornada
                            deja de competir contra una completa.</>
                        ) : (
                            <><strong className="text-content-2">Por hora</strong> se activa cuando el horario
                            del mes esté publicado para toda la lista
                            {Number(data?.personas || 0) > 0 && (
                                <> (hoy: {Number(data?.con_horario || 0)} de {Number(data.personas)})</>
                            )}.</>
                        )}
                    </p>
                    {Number(data?.para_revisar || 0) > 0 && (
                        <p>
                            <strong className="text-warning-text">
                                {data.para_revisar === 1 ? 'Una persona tiene' : `${data.para_revisar} personas tienen`}
                                {' '}ventas que no cuadran con su horario
                            </strong>
                            {' '}— vendió en una sala que no es la suya, o en un día que su horario marca libre.
                            Puede ser una venta anotada a quien no era, o un horario que quedó sin actualizar.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
