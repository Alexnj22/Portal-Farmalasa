import React, { useMemo, useRef, useState } from 'react';
import { Printer, Ruler, CheckCircle2, AlertCircle, Send, Eye, Laptop, PlugZap } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { EMPRESA } from '../constants/empresa';
import { APP_VERSION } from '../version';
import {
    ANCHOS_ROLLO, ANCHO_POR_DEFECTO, construirTicketHtml,
    imprimirMarco, ajustarAltoDePagina, enviarAImpresoraDeLaComputadora,
    comprobarLaConexion, permisoDeRedLocal,
} from '../utils/ticketPrint';

const EMPTY_ARRAY = [];

// La configuración de impresión es **de la computadora**, no de la persona ni de
// la sucursal: la ticketera está conectada a un equipo concreto y la de al lado
// puede ser distinta. Por eso vive en el navegador de ese equipo y no en la base
// — guardarla en los dos lados es la forma segura de que se desincronice
// (memoria `una preferencia guardada en dos copias se reinicia en las dos`).
const LS_AJUSTES = 'portal-impresion';

const leerAjustes = () => {
    try {
        const guardado = JSON.parse(localStorage.getItem(LS_AJUSTES) || '{}');
        return {
            ancho: ANCHOS_ROLLO.some(a => a.mm === guardado.ancho) ? guardado.ancho : ANCHO_POR_DEFECTO,
            sistema: guardado.sistema === 'windows' ? 'windows' : 'linux',
        };
    } catch {
        return { ancho: ANCHO_POR_DEFECTO, sistema: 'linux' };
    }
};

const guardarAjustes = (ajustes) => {
    try { localStorage.setItem(LS_AJUSTES, JSON.stringify(ajustes)); } catch { /* modo privado o sin cuota */ }
};

// La regla de columnas: un renglón de EXACTAMENTE n caracteres, con un dígito
// cada 10. Se imprimen tres —32, 40 y 48— y el papel contesta cuál es el ancho
// real: el que llega justo al borde sin partirse es la capacidad de la
// impresora. Es la única forma honesta de saberlo; el modelo declarado y lo que
// sale del rollo no siempre coinciden, y la pantalla no puede medirlo.
const regla = (n) => Array.from({ length: n }, (_, i) => {
    const c = i + 1;
    if (c % 10 === 0) return String((c / 10) % 10);
    if (c % 5 === 0) return '+';
    return '-';
}).join('');

const dosDigitos = (n) => String(n).padStart(2, '0');
const fechaHora = (d) => `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()}`
    + ` ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;

// El navegador y el sistema, en palabras. Sirve para que la prueba impresa diga
// desde dónde se hizo: la misma ticketera responde distinto según quién le
// manda, y sin este dato una prueba vieja no se puede comparar con una nueva.
function deDondeSeImprime() {
    const ua = navigator.userAgent;
    const nav = /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
        : 'otro navegador';
    const sis = /Windows/.test(ua) ? 'Windows'
        : /Macintosh|Mac OS/.test(ua) ? 'Mac'
        : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad/.test(ua) ? 'iPhone o iPad'
        : /Linux/.test(ua) ? 'Linux'
        : 'sistema desconocido';
    return `${nav} en ${sis}`;
}

const Tarjeta = ({ titulo, children }) => (
    <div data-surface="card" className="p-4">
        <p className="text-label font-black uppercase tracking-widest text-content-2 mb-3">{titulo}</p>
        {children}
    </div>
);

const ImpresionView = () => {
    const { user } = useAuth();
    const branches = useStaff(state => state.branches) || EMPTY_ARRAY;
    const sucursal = branches.find(b => b.id === user?.branchId);

    const [{ ancho, sistema }, setAjustes] = useState(leerAjustes);
    const cambiarAjuste = (cambio) => setAjustes(prev => {
        const nuevos = { ...prev, ...cambio };
        guardarAjustes(nuevos);
        return nuevos;
    });

    const [chequeo, setChequeo] = useState(null);
    const [chequeando, setChequeando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [largoPapel, setLargoPapel] = useState(null);
    // El marco se estira al alto del ticket para que NO tenga barra de scroll
    // propia: con el cuerpo de exactamente 80 mm, esa barra le roba ancho al
    // marco y el documento termina desbordando de lado (medido: 302 px de
    // cuerpo dentro de 287 px útiles). Quien scrollea es la tarjeta de afuera.
    const [altoMarco, setAltoMarco] = useState(620);
    const marcoRef = useRef(null);

    // El ticket de prueba. Cada bloque existe para responder UNA pregunta que
    // no se puede contestar desde la pantalla:
    //
    //   la regla     → cuántos caracteres entran de verdad por renglón
    //   el nombre largo → si el texto se parte bien o corre las columnas
    //   los totales  → si la columna de la derecha queda alineada
    //   la barra     → si el cabezal imprime parejo de borde a borde
    //
    // El texto no menciona ningún otro sistema: quien recibe este papel trabaja
    // en el portal (regla de CLAUDE.md, «la pantalla habla del PORTAL»).
    const ticket = useMemo(() => {
        const ahora = new Date();
        return {
            ancho,
            encabezado: {
                titulo: EMPRESA.razonSocial.toUpperCase(),
                lineas: [
                    sucursal?.name ?? 'Sucursal sin definir',
                    sucursal?.address ?? '',
                    sucursal?.phone ? `Tel. ${sucursal.phone}` : '',
                    `NIT ${EMPRESA.nit}  ·  NRC ${EMPRESA.nrc}`,
                ].filter(Boolean),
            },
            titulo: 'Prueba de impresión',
            datos: [
                ['Fecha', fechaHora(ahora)],
                ['Hecha por', user?.name ?? '—'],
                ['Rollo elegido', `${ancho} mm`],
                ['Desde', deDondeSeImprime()],
                ['Portal', `v${APP_VERSION}`],
            ],
            bloques: [
                {
                    titulo: 'Cuántas letras entran',
                    texto: 'El renglón más largo que NO se parta en dos es el ancho de esta impresora.',
                    monoespaciado: `32:\n${regla(32)}\n40:\n${regla(40)}\n48:\n${regla(48)}`,
                },
            ],
            items: {
                columnas: [
                    { label: 'Producto', ancho: '46%', alinear: 'izq' },
                    { label: 'Cant', ancho: '12%', alinear: 'cen' },
                    { label: 'P. Unit', ancho: '20%', alinear: 'der' },
                    { label: 'Total', ancho: '22%', alinear: 'der' },
                ],
                filas: [
                    ['ACETAMINOFEN 500MG TABLETAS CAJA CON 100 UNIDADES', '2', '$0.35', '$0.70'],
                    ['IBUPROFENO 400MG', '1', '$1.25', '$1.25'],
                    ['ALCOHOL GEL 250ML', '10', '$2.50', '$25.00'],
                ],
            },
            totales: [
                ['Gravado', '$23.85'],
                ['IVA 13%', '$3.10'],
                ['TOTAL', '$26.95', true],
            ],
            barraPrueba: true,
            pie: [
                'Esta hoja es una prueba: no es un comprobante',
                'y no corresponde a ninguna venta.',
                `Portal Farmalasa · v${APP_VERSION}`,
            ],
        };
    }, [ancho, sucursal, user]);

    const html = useMemo(() => construirTicketHtml(ticket), [ticket]);

    const opcionesAncho = ANCHOS_ROLLO.map(a => ({ value: String(a.mm), label: a.label }));

    const imprimir = () => {
        const error = imprimirMarco(marcoRef.current);
        setResultado(error
            ? { ok: false, texto: error }
            : { ok: true, texto: 'Se abrió el diálogo de impresión. Elige la ticketera en la lista de impresoras.' });
    };

    const comprobar = async () => {
        setChequeando(true);
        setChequeo(null);
        const [destinos, permiso] = await Promise.all([comprobarLaConexion(), permisoDeRedLocal()]);
        setChequeo({ destinos, permiso });
        setChequeando(false);
    };

    const enviarDirecto = async () => {
        setEnviando(true);
        setResultado(null);
        const r = await enviarAImpresoraDeLaComputadora(ticket, { sistema });
        // La dirección y el error crudo van a la pantalla, no al `console`: sin
        // ellos «no hay programa» y «el navegador lo bloqueó» se leen idénticos, y
        // el segundo pasa DENTRO de una sala con todo bien instalado. Quien está
        // frente a la caja necesita poder distinguirlos sin abrir el inspector.
        setResultado({ ok: r.ok, texto: r.detalle, direccion: r.direccion, motivo: r.motivo });
        setEnviando(false);
    };

    return (
        <GlassViewLayout icon={Printer} title="Prueba de impresión">
            <div className="p-4 md:p-6 space-y-4">
                <Notice variant="info" icon={Ruler}>
                    Imprime esta hoja en la ticketera y mira cuatro cosas: cuál es el renglón más
                    largo de la regla que NO se parte en dos (ese es el ancho real), si el nombre
                    largo se acomoda sin correr los precios, si la columna de la derecha queda
                    alineada, y si la barra negra sale pareja de un extremo al otro.
                </Notice>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="space-y-4">
                        {/* La comprobación va antes que el botón de imprimir: dice
                            si este equipo puede imprimir directo SIN gastar papel,
                            y separa las dos preguntas que un fallo de impresión
                            mezcla —¿hay un programa acá?, ¿me deja el navegador
                            hablarle?—. */}
                        <Tarjeta titulo="Comprobar esta computadora">
                            <p className="text-body text-content-2 leading-snug">
                                Revisa si este equipo puede imprimir directo, sin gastar papel.
                            </p>
                            <div className="mt-3">
                                <Button icon={PlugZap} variant="secondary" onClick={comprobar} disabled={chequeando}>
                                    {chequeando ? 'Comprobando…' : 'Comprobar'}
                                </Button>
                            </div>
                            {chequeo && (
                                <div className="mt-3 space-y-1">
                                    {chequeo.destinos.map(d => (
                                        <div key={d.url} className="flex items-start justify-between gap-2 py-1 border-b border-divider last:border-0">
                                            <div className="min-w-0">
                                                <span className="text-body text-content-2">{d.que}</span>
                                                {/* El motivo es el dato que faltó el 2026-08-14: sin él,
                                                    «no contesta» tapaba que el pedido ni siquiera salía. */}
                                                {d.motivo && (
                                                    <span className="block text-caption text-content-3 leading-snug">
                                                        El navegador dijo: {d.motivo}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="shrink-0 inline-flex items-center gap-1 text-label font-bold">
                                                {d.contesta
                                                    ? <><CheckCircle2 size={12} className="text-success" /> Contesta</>
                                                    : <><AlertCircle size={12} className="text-warning" /> No contesta</>}
                                            </span>
                                        </div>
                                    ))}
                                    <p className="text-caption text-content-3 pt-1 leading-snug">
                                        «Contesta» significa que hay algo escuchando ahí, no que esté bien
                                        configurado. Si <strong>ninguna</strong> contesta, o el navegador está
                                        bloqueando la red local de este equipo, o no hay nada instalado.
                                        {chequeo.permiso && (
                                            <> Permiso de red local: <strong>{
                                                { granted: 'concedido', denied: 'bloqueado', prompt: 'sin decidir' }[chequeo.permiso]
                                                    ?? chequeo.permiso
                                            }</strong>.</>
                                        )}
                                    </p>
                                </div>
                            )}
                        </Tarjeta>

                        {/* La impresión directa va antes que el diálogo: es la
                            única que garantiza que el papel salga como ticket.
                            El diálogo del navegador deja elegir el papel, y si
                            ahí se elige una hoja, sale en hoja. */}
                        <Tarjeta titulo="Imprimir el ticket">
                            <p className="text-body text-content-2 leading-snug">
                                Sale directo por la ticketera de esta computadora, sin abrir ninguna
                                ventana y sin preguntar el papel. Funciona en las computadoras de las
                                salas, que son las que tienen la ticketera conectada.
                            </p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                                <div>
                                    <label className="text-label font-bold text-content-2 mb-1 block">
                                        Sistema de esta computadora
                                    </label>
                                    <LiquidSelect
                                        value={sistema}
                                        onChange={(v) => cambiarAjuste({ sistema: v })}
                                        options={[
                                            { value: 'linux', label: 'Linux (las salas)' },
                                            { value: 'windows', label: 'Windows' },
                                        ]}
                                        clearable={false}
                                        ariaLabel="Sistema de esta computadora"
                                        icon={Laptop}
                                    />
                                </div>
                                <Button icon={Send} onClick={enviarDirecto} disabled={enviando}>
                                    {enviando ? 'Enviando…' : 'Imprimir el ticket'}
                                </Button>
                            </div>
                            <p className="text-caption text-content-3 mt-2 leading-snug">
                                Ábrelo en el <strong>mismo navegador</strong> donde ya se imprimen los
                                tickets en esa computadora: el permiso para hablarle a la impresora se
                                da por navegador y por sitio, así que uno distinto empieza sin él.
                                Y la computadora no devuelve si la impresión salió bien — sólo si
                                recibió el pedido. La prueba de verdad es el papel.
                            </p>
                        </Tarjeta>

                        {resultado && (
                            <Notice variant={resultado.ok ? 'success' : 'warning'}
                                icon={resultado.ok ? CheckCircle2 : AlertCircle}>
                                {resultado.texto}
                                {resultado.direccion && (
                                    <span className="block mt-1.5 font-normal">
                                        Dirección:{' '}
                                        <a href={resultado.direccion} target="_blank" rel="noreferrer"
                                            className="underline font-bold">
                                            {resultado.direccion}
                                        </a>
                                        {' '}— ábrela en una pestaña de esta misma computadora para ver
                                        si el programa responde.
                                    </span>
                                )}
                                {resultado.motivo && (
                                    <span className="block mt-1 text-micro font-normal opacity-80">
                                        El navegador dijo: {resultado.motivo}
                                    </span>
                                )}
                            </Notice>
                        )}

                        <Tarjeta titulo="Si no hay impresión directa">
                            <p className="text-body text-content-2 leading-snug">
                                Este camino abre el diálogo del navegador, así que sirve desde
                                cualquier computadora o desde el teléfono. Ojo: ahí <strong>hay que
                                elegir la ticketera y su papel</strong> — si queda seleccionada una
                                impresora de hoja, el ticket sale en hoja.
                            </p>
                            <div className="mt-3 flex flex-wrap items-end gap-2">
                                <div className="min-w-[220px] flex-1">
                                    <label className="text-label font-bold text-content-2 mb-1 block">
                                        Ancho del rollo
                                    </label>
                                    <LiquidSelect
                                        value={String(ancho)}
                                        onChange={(v) => cambiarAjuste({ ancho: Number(v) })}
                                        options={opcionesAncho}
                                        clearable={false}
                                        ariaLabel="Ancho del rollo"
                                        icon={Ruler}
                                    />
                                </div>
                                <Button icon={Printer} variant="secondary" onClick={imprimir}>
                                    Abrir el diálogo
                                </Button>
                            </div>
                            <p className="text-caption text-content-3 mt-2 leading-snug">
                                Si el papel sale con los bordes cortados, prueba el siguiente ancho
                                hacia abajo.
                            </p>
                        </Tarjeta>
                    </div>

                    {/* La vista previa ES el documento que se imprime: `imprimir`
                        manda a la impresora este mismo marco, no una copia
                        armada aparte. Así el papel no puede diferir de lo que se
                        acaba de mirar. */}
                    <div className="lg:w-[340px]">
                        <Tarjeta titulo="Cómo va a salir">
                            <div className="flex items-center gap-1.5 text-caption text-content-3 mb-2">
                                <Eye size={11} /> Tamaño real, {ancho} mm de ancho
                                {largoPapel != null && <> · gasta {largoPapel} mm de papel</>}
                            </div>
                            <div className="overflow-auto max-h-[70vh]">
                                {/* El borde va en el envoltorio y NO en el
                                    iframe: un borde de 1px le resta 2px al ancho
                                    útil del documento, y como el cuerpo del
                                    ticket mide exactamente el ancho del rollo,
                                    esos 2px lo hacían desbordar de lado (medido:
                                    cuerpo 302.4px dentro de 300px útiles).

                                    Sin color de fondo acá: el propio documento
                                    del ticket se pinta blanco (es papel, no una
                                    superficie del tema), así que ponerle un
                                    `bg-` sería un blanco crudo de más. */}
                                {/* Sin radio: `rounded-btn` vale 9999px en el
                                    tema de vidrio (lo decide el tema, no el
                                    componente), y con `overflow-hidden` eso
                                    recortaba el ticket en forma de óvalo y se
                                    comía el encabezado. Una hoja de papel tiene
                                    las esquinas rectas. */}
                                <div className="border border-border-card inline-block overflow-hidden">
                                <iframe
                                    ref={marcoRef}
                                    title="Vista previa del ticket"
                                    srcDoc={html}
                                    // Medir en cuanto está pintado: deja puesto el
                                    // `@page` con el alto real, da el largo de
                                    // papel que gasta —que sólo existe después de
                                    // armar el ticket— y estira el marco.
                                    onLoad={() => {
                                        const mm = ajustarAltoDePagina(marcoRef.current);
                                        setLargoPapel(mm);
                                        if (mm) setAltoMarco(Math.ceil((mm / 25.4) * 96));
                                    }}
                                    className="block border-0"
                                    style={{ width: `${ancho}mm`, height: `${altoMarco}px` }}
                                />
                                </div>
                            </div>
                        </Tarjeta>
                    </div>
                </div>
            </div>
        </GlassViewLayout>
    );
};

export default ImpresionView;
