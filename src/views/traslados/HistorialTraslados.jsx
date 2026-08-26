import React, { useMemo, useState, lazy, Suspense } from 'react';
import { Ban, PackageCheck, CornerUpLeft } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import EvidenciaFotos from '../../components/common/EvidenciaFotos';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import ModalShell from '../../components/common/ModalShell';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { ChipPersona } from '../solicitudes/PersonasSolicitud';
import { clickable } from '../../utils/clickable';
import { fmtFechaLarga, piezasDe, renglonesDe, resumenItems } from './trasladoTexto';

/* El detalle de un traslado ES el detalle de una solicitud —vive en
 * `approval_requests` y su tipo es `INVENTORY_TRANSFER_REQUEST`—, así que se
 * REUSA el canónico de las tres pantallas de solicitudes en vez de escribir acá
 * una cuarta copia. Es el mismo razonamiento escrito en `NotificacionDetalle`, y
 * la historia de ese archivo es justamente que las copias se separan: la que
 * vivía en `RequestsView` cubría diez tipos y la de `EmployeeRequestsView` dos.
 *
 * Va por `lazy` porque el detalle sólo hace falta cuando alguien TOCA una
 * tarjeta: el historial se abre para mirar la lista, y la mayoría de las veces
 * eso es todo lo que se hace. */
const DetalleSolicitud = lazy(() => import('../solicitudes/DetalleSolicitud'));

/**
 * El historial de traslados, en TARJETAS y agrupado.
 *
 * ── Por qué deja de ser una tabla ──────────────────────────────────────────
 * Lo era desde el 2026-08-07, y por un buen motivo escrito: un historial es una
 * lista de REGISTROS, y `DataTable` da la tabla en escritorio, las fichas en el
 * teléfono y el vacío, los tres de una.
 *
 * Lo que esa forma no puede dar es lo que el usuario pidió el 2026-08-24:
 * **«que se vean siempre como cards, si alcance todos que se separe por
 * sucursal y por rechazado / aprobado»**. Una tabla tiene UN encabezado y una
 * sola tira de filas; meter dos niveles de corte adentro obliga a filas-título
 * que no son registros —lo dice el propio comentario que este archivo
 * reemplaza: «el historial es una tabla donde un encabezado de grupo no
 * entra»—. Con tarjetas el corte es la estructura del documento y no un
 * remiendo dentro de una fila.
 *
 * ── Los dos cortes, y en ese orden ─────────────────────────────────────────
 * **Sucursal primero, desenlace después.** Quien mira las siete salas viene a
 * preguntar «¿qué pasó en Bodega?», y recién adentro «¿qué salió y qué se
 * rechazó?». Al revés —dos bloques grandes y las salas mezcladas adentro— hay
 * que recorrer la lista entera para juntar lo de una sala.
 *
 * **La sucursal es el ORIGEN**, no el destino: el desenlace que agrupa —
 * recibido o rechazado— es la decisión de la sala que TIENE el producto. Cortar
 * por destino pondría bajo un mismo título decisiones de seis salas distintas y
 * el segundo corte dejaría de significar algo.
 *
 * Y el corte por sucursal existe **sólo con alcance sobre todas**: con una sola
 * sala a la vista, un único título repetido no separa nada — es ruido con
 * forma de estructura.
 */

/** El desenlace de un traslado cerrado, que es lo que corta el segundo nivel. */
const esRechazado = (f) => f.status === 'REJECTED';

/* Cuántos productos se nombran antes de resumir el resto.
 *
 * Con varios renglones, `resumenItems` decía «3 productos · 12 unidades» y
 * nada más — reportado por el usuario: «cuando la solicitud son varios
 * productos, ¿cómo se ven?». La respuesta era: no se ven. Un historial que no
 * dice QUÉ se movió no contesta la pregunta por la que uno lo abre.
 *
 * Tres, y no todos: un traslado de doce renglones estiraría su tarjeta al
 * cuádruple de las de al lado, y en una rejilla que iguala alturas eso estira
 * la fila entera. El resto se cuenta. */
const PRODUCTOS_EN_TARJETA = 3;

/** Los renglones de un traslado de varios productos, en compacto. */
function Renglones({ renglones }) {
    const deMas = renglones.length - PRODUCTOS_EN_TARJETA;
    return (
        <div className="flex flex-col gap-0.5">
            {renglones.slice(0, PRODUCTOS_EN_TARJETA).map(r => (
                <p key={r.idx} className="flex items-baseline justify-between gap-2 text-label text-content-2">
                    <span className="min-w-0 truncate" title={r.nombre}>{r.nombre}</span>
                    <span className="shrink-0 tabular-nums font-bold text-content-2">
                        {r.cantidad}{r.presentacion ? ` ${r.presentacion}` : ''}
                    </span>
                </p>
            ))}
            {deMas > 0 && (
                <p className="text-micro font-bold text-brand-text">
                    +{deMas} {deMas === 1 ? 'producto más' : 'productos más'}
                </p>
            )}
        </div>
    );
}

/**
 * Un traslado cerrado.
 *
 * Lleva TODO lo que la tabla repartía en siete columnas —incluidas las tres que
 * se escondían por debajo de `lg`—. En la tabla eso se recuperaba abriendo la
 * ficha del teléfono; acá no hay dónde abrir, así que si un dato no se dibuja,
 * no existe. Y el que más se escondía era el MOTIVO, que es justamente lo que
 * uno viene a leer en un historial.
 *
 * ── Compacta, y de dónde salió el alto (2026-08-24) ────────────────────────
 * Pedido del usuario: «¿puedes hacer más compactas las cards?». Lo que sobraba
 * eran los rótulos: PIDIÓ y DESPACHÓ vivían en dos columnas con su versalita,
 * su cara, su nombre y su fecha — seis renglones para decir quién y cuándo.
 *
 * Ahora es UNO: las dos caras con la flecha entre ellas, en el mismo sentido
 * que el recorrido de arriba —**de quien despachó a quien pidió**, igual que
 * «Bodega → Salud 3»—, y a la derecha la fecha del cierre. La flecha dice el
 * rol, así que los rótulos no hacen falta; los nombres se quedan porque un
 * archivo se consulta para saber QUIÉN, y una cara sola no se cita en una
 * conversación.
 */
export function TarjetaHistorial({ fila, personaPor, onAbrir }) {
    const m = fila.metadata ?? {};
    const rechazado = esRechazado(fila);
    const motivo = rechazado
        ? [m.rejection_reason, m.sugerencia].filter(Boolean).join(' — ')
        : (fila.note || '');
    const renglones = renglonesDe(m);
    const piezas = piezasDe(m);
    const pidio  = personaPor?.(fila.employee_id);
    const resolvio = personaPor?.(fila.approver_id);

    return (
        /* La tarjeta ABRE el traslado (2026-08-26).
         *
         * Reportado así: «al tocar la card no se abre el modal con toda la
         * información de ese traslado». No era un `onClick` roto — no había
         * ninguno: cuando el historial era `DataTable`, el detalle completo lo
         * daba la ficha del teléfono, y al pasar a tarjetas el 24-ago esa
         * puerta se fue con la tabla. Desde entonces lo que la tarjeta no
         * dibuja no existe en ninguna pantalla: los lotes que salieron, la
         * constancia de lo aplicado, la nota de quien decidió, las fotos.
         *
         * `clickable()` y no un `onClick` a secas: pone el rol, el foco, el
         * Enter/Espacio y el `data-interactive` que le da el acuse al toque
         * (§1.6) — que en el teléfono es la ÚNICA señal de que entró. */
        <div data-surface="card" className="px-3.5 py-3 flex flex-col gap-2 h-full"
            {...clickable(onAbrir ? () => onAbrir(fila) : null,
                { label: `Ver el traslado de ${m.origen_branch_name ?? 'otra sala'} a ${m.branch_name ?? 'otra sala'}` })}>
            <div className="flex items-start gap-2">
                {rechazado
                    ? <Ban size={14} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    : <PackageCheck size={14} className="text-success-text shrink-0 mt-0.5" strokeWidth={2.5} />}
                <div className="flex-1 min-w-0">
                    {/* Con UN producto el título es su nombre y la cantidad va
                        al costado; con varios es la cuenta, y los nombres
                        cuelgan abajo. Así el renglón de arriba dice siempre lo
                        mismo —qué es esto— sin repetir la cantidad dos veces. */}
                    <p className="text-body-sm font-black text-content leading-snug line-clamp-2"
                        title={resumenItems(m)}>
                        {renglones.length > 1
                            ? `${renglones.length} productos · ${m.total_unidades ?? 0} unidades`
                            : (piezas ? `${piezas.numero} ${piezas.unidad} · ${piezas.nombre}` : resumenItems(m))}
                    </p>
                    <p className="text-label font-bold text-content-2 truncate">
                        {m.origen_branch_name ?? '—'}
                        <span className="text-content-3 font-medium"> → </span>
                        {m.branch_name ?? '—'}
                    </p>
                </div>
                <Badge variant={rechazado ? 'danger' : 'success'} size="sm">
                    {rechazado ? 'Rechazado' : 'Recibido'}
                </Badge>
            </div>

            {/* Qué se movió, cuando fue más de una cosa. Sin esto la tarjeta
                decía «3 productos» y no cuáles. */}
            {renglones.length > 1 && <Renglones renglones={renglones} />}

            {/* El motivo. Era la columna que se escondía por debajo de `lg` y la
                que contesta la única pregunta que un historial tiene que
                contestar cuando alguien viene a preguntar. */}
            {motivo && (
                <p className="text-label text-content-2 leading-snug line-clamp-2" title={motivo}>
                    {motivo}
                </p>
            )}

            {/* Las dos puntas del circuito en UN renglón. La flecha va en el
                mismo sentido que el recorrido de arriba —de quien despachó a
                quien pidió—, así que dice el rol sin necesidad de rótulos. */}
            <div className="mt-auto pt-2 border-t border-divider flex items-center justify-between gap-2 min-w-0">
                {/* `role="img"` + `aria-label` y NO `title`: las dos caras con
                    la flecha son un DIBUJO del circuito, no prosa con ayuda al
                    pasar el ratón — y un `title` en un span no interactivo no
                    llega al lector de pantalla ni al teléfono (§15.10). Mismo
                    tratamiento que la tarjeta de «En camino». */}
                <span className="flex items-center gap-1.5 min-w-0" role="img"
                    aria-label={[resolvio?.name && `Despachó ${resolvio.name}`,
                                 pidio?.name && `pidió ${pidio.name}`].filter(Boolean).join(', ')}>
                    <ChipPersona persona={resolvio} vacio="Sin registro" />
                    <span className="text-content-3 text-micro shrink-0">→</span>
                    <ChipPersona persona={pidio} vacio="Sin registro" />
                </span>
                <span className="text-micro text-content-3 tabular-nums shrink-0">
                    {fmtFechaLarga(fila.updated_at ?? fila.created_at)}
                </span>
            </div>
        </div>
    );
}

/** Un envío cerrado — otra pregunta, así que otra tarjeta. Y el mismo compacto. */
export function TarjetaEnvioCerrado({ envio, onAbrir }) {
    const lineas = envio.lineas ?? [];
    const acept = lineas.filter(l => l.estado === 'aceptada').length;
    const devue = lineas.filter(l => String(l.estado).startsWith('devuelta')).length;
    const devueltas = lineas
        .filter(l => String(l.estado).startsWith('devuelta'))
        .map(l => `${l.descripcion ?? l.erp_product_id} (${l.motivo_rechazo ?? 'sin motivo'})`);

    return (
        /* Se abre igual que la de al lado. Un envío cerrado guarda por renglón
         * su estado, su motivo de devolución y la nota escrita a mano, y
         * guarda además las FOTOS de la avería — nada de eso cabe en la
         * tarjeta, y hasta hoy no se veía en ninguna parte. */
        <div data-surface="card" className="px-3.5 py-3 flex flex-col gap-2 h-full"
            {...clickable(onAbrir ? () => onAbrir(envio) : null,
                { label: `Ver el envío de ${envio.origen_branch_name ?? 'otra sala'} a ${envio.branch_name ?? 'otra sala'}` })}>
            <div className="flex items-start gap-2">
                {devue > 0
                    ? <CornerUpLeft size={14} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    : <PackageCheck size={14} className="text-success-text shrink-0 mt-0.5" strokeWidth={2.5} />}
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-black text-content leading-snug truncate">
                        {envio.origen_branch_name ?? '—'}
                        <span className="text-content-3 font-medium"> → </span>
                        {envio.branch_name ?? '—'}
                    </p>
                    <p className="text-label text-content-2 line-clamp-2" title={envio.reason ?? ''}>
                        <span className="font-bold">{envio.motivo_tipo ?? '—'}</span>
                        {envio.reason && envio.reason !== envio.motivo_tipo ? ` · ${envio.reason}` : ''}
                    </p>
                </div>
                {/* Cuánto se quedó y cuánto volvió. Un envío NO tiene un
                    desenlace sino uno por renglón —la sala se quedó tres y
                    devolvió dos—, y por eso este número no se puede resumir en
                    una palabra ni sirve para agrupar. */}
                <span className="text-label font-bold whitespace-nowrap shrink-0" role="img"
                    aria-label={`${acept} se quedaron, ${devue} volvieron`}>
                    <span className="text-success-text">{acept}</span>
                    <span className="text-content-3"> / </span>
                    <span className={devue > 0 ? 'text-danger-text' : 'text-content-3'}>{devue}</span>
                </span>
            </div>

            {devueltas.length > 0 && (
                <p className="text-label text-content-2 leading-snug line-clamp-2"
                    title={devueltas.join('; ')}>
                    <span className="font-black uppercase tracking-widest text-micro text-content-3">Devuelto </span>
                    {devueltas.join('; ')}
                </p>
            )}

            <p className="mt-auto pt-2 border-t border-divider text-micro text-content-3 tabular-nums">
                {fmtFechaLarga(envio.updated_at ?? envio.created_at)}
            </p>
        </div>
    );
}

/* ─── Lo que la tarjeta no puede dibujar ──────────────────────────────────── */

/**
 * El traslado entero, en un diálogo.
 *
 * El cuerpo es `DetalleSolicitud` y no un bloque escrito acá: un traslado es
 * una solicitud de `approval_requests`, y ese componente ya pinta sus dos
 * personas con cara y hora, el recorrido, los renglones con sus lotes, la
 * constancia de lo que se aplicó, el motivo de quien lo pidió y —cuando fue un
 * rechazo— el motivo real, que vive en `metadata.rejection_reason` y no en
 * `approver_note`.
 *
 * **Sin recorrido propio adentro.** El cuerpo de `CuerpoDialogo` ya se desplaza
 * solo, en las dos anatomías. Un segundo contenedor con `overflow-y-auto` deja
 * dos recorridos anidados y en el teléfono el dedo queda trabado en el de
 * adentro — es exactamente lo que se corrigió en `NotificacionDetalle` el
 * 2026-08-14.
 */
function DialogoTraslado({ fila, empleadosPorId, onCerrar }) {
    const rechazado = esRechazado(fila);
    return (
        <ModalShell open onClose={onCerrar} maxWidthClass="max-w-xl" zClass="z-toast"
            surface={null} ariaLabel="Detalle del traslado">
            <CuerpoDialogo
                titulo="Traslado entre salas"
                subtitulo={`${rechazado ? 'Rechazado' : 'Recibido'} · ${fmtFechaLarga(fila.updated_at ?? fila.created_at)}`}
                icono={rechazado ? Ban : PackageCheck}
                tono={rechazado ? 'danger' : 'success'}
                anchoEscritorio="max-w-xl"
                pie={<Button variant="secondary" onClick={onCerrar}>Cerrar</Button>}>
                <Suspense fallback={<SkeletonText lines={6} />}>
                    <DetalleSolicitud req={fila} employeesById={empleadosPorId} />
                </Suspense>
            </CuerpoDialogo>
        </ModalShell>
    );
}

/* Qué pasó con cada renglón de un envío ya cerrado.
 *
 * NO se reusa el `ESTADO_ROTULO` de `FilasEnvio`: aquél está escrito en segunda
 * persona —«se la quedaron», «te la devuelven»— porque acompaña a una tarjeta
 * que le habla a UNA de las dos salas y le dice qué le toca hacer. El historial
 * lo mira cualquiera de las siete, y muchas veces ninguna de las dos: ahí «te la
 * devuelven» nombra a un «te» que no existe. */
const DESENLACE_RENGLON = {
    aceptada: { texto: 'Se quedó',      tono: 'success' },
    devuelta: { texto: 'Devuelta',      tono: 'danger'  },
    devuelta_recibida: { texto: 'Volvió al origen', tono: 'danger' },
};

/** El envío entero, con su renglón por renglón y la evidencia. */
function DialogoEnvio({ envio, personaPor, onCerrar }) {
    const lineas = envio.lineas ?? [];
    const mando   = personaPor?.(envio.employee_id);
    const decidio = personaPor?.(envio.approver_id);
    const fotos = Array.isArray(envio.evidencia_urls) ? envio.evidencia_urls : [];

    return (
        <ModalShell open onClose={onCerrar} maxWidthClass="max-w-xl" zClass="z-toast"
            surface={null} ariaLabel="Detalle del envío">
            <CuerpoDialogo
                titulo="Envío a otra sala"
                subtitulo={fmtFechaLarga(envio.updated_at ?? envio.created_at)}
                icono={CornerUpLeft}
                anchoEscritorio="max-w-xl"
                pie={<Button variant="secondary" onClick={onCerrar}>Cerrar</Button>}>
                <div className="space-y-2.5 text-left">
                    <div data-surface="card" className="px-3 py-2.5">
                        <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">Recorrido</p>
                        <p className="text-body-sm font-bold text-content-2">
                            {envio.origen_branch_name ?? '—'}
                            {/* De qué ESTANTE salió: dos envíos de Bodega se ven
                                iguales si sólo se nombra la sala. */}
                            {envio.origen_vencidos ? ' · Área de Vencidos' : ''}
                            <span className="text-content-3 font-medium"> → </span>
                            {envio.branch_name ?? '—'}
                        </p>
                        <p className="text-caption text-content-2 mt-0.5">
                            <span className="font-bold">{envio.motivo_tipo ?? 'Sin motivo'}</span>
                            {envio.reason && envio.reason !== envio.motivo_tipo ? ` · ${envio.reason}` : ''}
                        </p>
                    </div>

                    <div>
                        <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">
                            Qué llevaba
                        </p>
                        <div className="flex flex-col gap-1">
                            {lineas.map(l => {
                                const d = DESENLACE_RENGLON[l.estado];
                                return (
                                    <div key={l.posicion} data-surface="card"
                                        className="px-3 py-2 flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-label font-bold text-content leading-snug">
                                                {l.descripcion ?? `Producto ${l.erp_product_id}`}
                                            </p>
                                            <p className="text-micro text-content-3">
                                                {l.cantidad} × {l.presentacion_tipo}
                                                {Number.isFinite(Number(l.unidades))
                                                    ? ` · ${l.unidades} ${Number(l.unidades) === 1 ? 'unidad' : 'unidades'}`
                                                    : ''}
                                            </p>
                                            {/* El motivo elegido y la aclaración
                                                escrita a mano son dos cosas: la
                                                segunda explica a la primera. */}
                                            {l.motivo_rechazo && (
                                                <p className="text-micro text-danger-text font-semibold mt-0.5">
                                                    {l.motivo_rechazo}
                                                    {l.nota_rechazo ? ` — ${l.nota_rechazo}` : ''}
                                                </p>
                                            )}
                                        </div>
                                        <Badge variant={d?.tono ?? 'neutral'} size="sm">
                                            {d?.texto ?? l.estado}
                                        </Badge>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* La avería no entra sin foto, así que acá SIEMPRE hay algo
                        que mirar cuando el motivo fue ése — y hasta hoy no se
                        veía en ninguna pantalla del historial. */}
                    <EvidenciaFotos urls={fotos} />

                    {envio.approver_note && (
                        <div className="px-3 py-2.5 rounded-2xl bg-surface-card-hover border border-divider">
                            <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">
                                Nota de quien lo recibió
                            </p>
                            <p className="text-body-sm text-content-2 font-medium leading-relaxed">
                                {envio.approver_note}
                            </p>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-divider">
                        <span className="flex items-center gap-1.5 min-w-0" role="img"
                            aria-label={[mando?.name && `Lo mandó ${mando.name}`,
                                         decidio?.name && `lo recibió ${decidio.name}`].filter(Boolean).join(', ')}>
                            <ChipPersona persona={mando} vacio="Sin registro" />
                            <span className="text-content-3 text-micro shrink-0">→</span>
                            <ChipPersona persona={decidio} vacio="Sin registro" />
                        </span>
                        <span className="text-micro text-content-3 tabular-nums shrink-0">
                            {fmtFechaLarga(envio.updated_at ?? envio.created_at)}
                        </span>
                    </div>
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}

/** El encabezado de un corte, con su cuenta. */
function Titulo({ children, cuenta, tono = 'text-content-2' }) {
    return (
        <p className={`text-caption font-black uppercase tracking-widest px-1 ${tono}`}>
            {children}
            {cuenta != null && <span className="text-content-3"> · {cuenta}</span>}
        </p>
    );
}

/* `grid-cols-1` explícito: sin la pista base, en el teléfono la implícita es
 * `auto` y se dimensiona al contenido, no al contenedor — la rejilla se sale de
 * lado. Ver `feedback_una_rejilla_sin_pista_base_se_dimensiona_al_contenido`. */
const REJILLA = 'grid grid-cols-1 gap-2 xl:grid-cols-2';

/** Los dos bloques del desenlace, dentro de una sucursal o del todo. */
function PorDesenlace({ filas, personaPor, onAbrir }) {
    const recibidos = filas.filter(f => !esRechazado(f));
    const rechazados = filas.filter(esRechazado);
    return (
        <>
            {recibidos.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Titulo cuenta={recibidos.length} tono="text-success-text">Recibidos</Titulo>
                    <div className={REJILLA}>
                        {recibidos.map(f => (
                            <TarjetaHistorial key={f.id} fila={f} personaPor={personaPor} onAbrir={onAbrir} />
                        ))}
                    </div>
                </div>
            )}
            {rechazados.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Titulo cuenta={rechazados.length} tono="text-danger-text">Rechazados</Titulo>
                    <div className={REJILLA}>
                        {rechazados.map(f => (
                            <TarjetaHistorial key={f.id} fila={f} personaPor={personaPor} onAbrir={onAbrir} />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

/**
 * El historial entero: tarjetas, cortadas por sucursal y por desenlace.
 *
 * @param filas          traslados cerrados, ya filtrados por la vista
 * @param envios         envíos cerrados, ya filtrados
 * @param porSucursal    cortar por sala de origen (sólo con alcance de todas)
 * @param personaPor     id → persona, con el respaldo que usa la vista
 * @param empleadosPorId el mismo maestro como MAPA, que es lo que pide
 *                       `DetalleSolicitud` — busca con `.get(String(id))`, y
 *                       `personaPor` resuelve además por correo y por usuario
 */
export default function HistorialTraslados({
    filas = [], envios = [], porSucursal = false, personaPor, empleadosPorId, vacio,
}) {
    /* Qué está abierto: un traslado, un envío, o nada. UNO solo y en el
     * contenedor —no un estado por tarjeta—: el diálogo es de la pantalla, y con
     * el estado adentro cada una de las cuarenta y ocho cargaría el suyo. */
    const [abierto, setAbierto] = useState(null);   // { tipo: 'traslado'|'envio', dato }
    /* El orden de las salas NO es alfabético: es por cuántos traslados cerró
     * cada una. Quien abre esta pestaña con las siete a la vista busca dónde
     * pasó algo, y una lista alfabética esconde a la que más movió detrás de la
     * que no movió nada. El desempate sí es por nombre, para que dos salas con
     * la misma cuenta no se turnen entre recargas. */
    const grupos = useMemo(() => {
        if (!porSucursal) return null;
        const mapa = new Map();
        for (const f of filas) {
            const sala = f.metadata?.origen_branch_name || 'Sin sala';
            if (!mapa.has(sala)) mapa.set(sala, []);
            mapa.get(sala).push(f);
        }
        return [...mapa.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }, [filas, porSucursal]);

    const enviosPorSala = useMemo(() => {
        if (!porSucursal) return null;
        const mapa = new Map();
        for (const e of envios) {
            const sala = e.origen_branch_name || 'Sin sala';
            if (!mapa.has(sala)) mapa.set(sala, []);
            mapa.get(sala).push(e);
        }
        return [...mapa.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }, [envios, porSucursal]);

    if (!filas.length && !envios.length) return <EmptyState {...vacio} />;

    return (
        <div className="flex flex-col gap-6">
            {filas.length > 0 && (porSucursal ? (
                grupos.map(([sala, deLaSala]) => (
                    <div key={sala} className="flex flex-col gap-3">
                        {/* La sala manda sobre el desenlace: es el título del
                            bloque y por eso va más pesado y con una línea que lo
                            separa del anterior. */}
                        <p className="text-body-sm font-black text-content uppercase tracking-tight
                            border-b border-divider pb-1.5 px-1">
                            {sala}
                            <span className="text-content-3 font-bold"> · {deLaSala.length}</span>
                        </p>
                        <PorDesenlace filas={deLaSala} personaPor={personaPor}
                            onAbrir={f => setAbierto({ tipo: 'traslado', dato: f })} />
                    </div>
                ))
            ) : (
                <div className="flex flex-col gap-3">
                    <PorDesenlace filas={filas} personaPor={personaPor}
                        onAbrir={f => setAbierto({ tipo: 'traslado', dato: f })} />
                </div>
            ))}

            {/* Los ENVÍOS van aparte y SIN cortar por desenlace: un envío no
                tiene uno solo —la sala se quedó tres renglones y devolvió dos—,
                así que «aprobado / rechazado» no lo describe. Lo que sí aplica
                es el corte por sucursal, que es la misma pregunta. */}
            {envios.length > 0 && (
                <div className="flex flex-col gap-3">
                    <Titulo cuenta={envios.length}>Envíos cerrados</Titulo>
                    {porSucursal ? (
                        enviosPorSala.map(([sala, deLaSala]) => (
                            <div key={sala} className="flex flex-col gap-2">
                                <p className="text-label font-black text-content-2 uppercase tracking-wide px-1">
                                    {sala}
                                    <span className="text-content-3"> · {deLaSala.length}</span>
                                </p>
                                <div className={REJILLA}>
                                    {deLaSala.map(e => (
                                        <TarjetaEnvioCerrado key={e.id} envio={e}
                                            onAbrir={x => setAbierto({ tipo: 'envio', dato: x })} />
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className={REJILLA}>
                            {envios.map(e => (
                                <TarjetaEnvioCerrado key={e.id} envio={e}
                                    onAbrir={x => setAbierto({ tipo: 'envio', dato: x })} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {abierto?.tipo === 'traslado' && (
                <DialogoTraslado fila={abierto.dato} empleadosPorId={empleadosPorId}
                    onCerrar={() => setAbierto(null)} />
            )}
            {abierto?.tipo === 'envio' && (
                <DialogoEnvio envio={abierto.dato} personaPor={personaPor}
                    onCerrar={() => setAbierto(null)} />
            )}
        </div>
    );
}
