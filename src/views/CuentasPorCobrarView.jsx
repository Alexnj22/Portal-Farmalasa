import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, CalendarClock, HandCoins, Pencil, RefreshCw, Search, ShoppingBag, UserCircle2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import LiquidModal from '../components/common/LiquidModal';
import LiquidSelect from '../components/common/LiquidSelect';
/* `Switch` es el canónico del portal (DESIGN.md A14). Los tres interruptores
 * locales que competían se unificaron ahí; escribir un cuarto acá sería
 * volver a abrir el mismo hueco. */
import Switch from '../components/common/Switch';
import Notice from '../components/common/Notice';
import PortalInput from '../components/common/PortalInput';
import PortalTextarea from '../components/common/PortalTextarea';
import TablePagination from '../components/common/TablePagination';
import AvatarConEstado from '../components/common/AvatarConEstado';
import FileField from '../components/common/FileField';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { usePaginaEnUrl } from '../hooks/usePaginaEnUrl';
import {
    DIAS_DE_PLAZO, edadDelCredito, fetchCreditoDetalle, fetchCreditos, fetchCreditosDelCliente,
    fetchHistorialDelOrigen, fetchPosProveedores, fetchUltimaLectura, leerPagoDeCredito,
    pagarCreditos, pedirCorreccionDeAbono, severidadDeDias,
    subirComprobanteDeAbono,
} from '../data/creditos';
import { mensajeAmigable } from '../utils/errorMessages';
import { formatMoney } from '../utils/formatNumber';
/* `fechaCorta` sale de `ticketCampos` y no se reescribe acá: es la MISMA
 * pregunta —«dd/mm/aaaa sin que el huso corra un día»— y el archivo no importa
 * nada, así que no arrastra el maquetador del rollo. Escribirla dos veces es
 * cómo dos pantallas terminan mostrando días distintos. */
import { fechaCorta } from '../utils/ticketCampos';
import { tokenMatch } from '../utils/searchUtils';

/**
 * CUENTAS POR COBRAR — quién debe, desde cuándo, y cobrarle.
 *
 * ── Por qué es una vista y no una pestaña de Efectivo ─────────────────────
 * Nació como la cuarta pestaña de Efectivo y el usuario la sacó de ahí el
 * 2-sep: «agregalo como vista nueva, Cuentas por cobrar». Tiene razón de fondo
 * y no es sólo de acomodo — Efectivo contesta *«¿cuadra el dinero de HOY?»* y
 * esto contesta *«¿quién nos debe de los últimos dos años?»*. Comparten el
 * cajón, no la pregunta: la cartera se revisa en otro momento, la mira otra
 * gente, y su período es todo el histórico y no el día.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Medido el 2026-09-01 leyendo las seis salas de verdad: **2,386 créditos, de
 * los cuales 126 con saldo — $4,646.21 entre 43 clientes**. De esos, **35
 * pasados del mes de plazo** y el más viejo con **462 días**. No había ninguna
 * pantalla que los listara: para saber quién debía había que entrar sala por
 * sala al sistema de la caja y recorrer una tabla de 800 filas.
 *
 * ── El plazo es un HALLAZGO, no un candado ────────────────────────────────
 * Pasarse del mes no bloquea nada —el portal no decide a quién se le fía— pero
 * se ve, y se puede filtrar. Un plazo que nadie mira es un plazo que no existe:
 * el crédito de 462 días lo prueba.
 *
 * ── Lo que esta pantalla guarda y el origen no ────────────────────────────
 * Allá el abono queda a nombre del usuario de la caja, que en varias salas es
 * una cuenta compartida. Acá firma quien tiene la sesión, y eso vive en
 * `creditos_abonos_portal`.
 */

/* Las formas de pago que el portal ACEPTA, decidido por el usuario (2-sep):
 * «voucher y recibo quítalo, otro y bitcoin también».
 *
 * El sistema de la caja ofrece ocho; acá van cuatro. Las que salieron no eran
 * formas de pago sino papeles («recibo», «voucher») o un cajón de sastre
 * («otro») que vuelve incontable lo que entró — y con «otro» disponible, el
 * corte de la caja no puede cuadrarse por método.
 *
 * ⚠️ Esta lista y la del servidor son la MISMA lista dicha dos veces y se
 * mueven juntas. Sólo acá, alguien puede mandar `Bitcoin` en la petición y el
 * origen lo aceptaría; sólo allá, la pantalla ofrecería algo que el servidor
 * rechaza. La copia del servidor vive en `creditos-erp`. */
const FORMAS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Otro'];

/* «Otro» vuelve, y no contradice la decisión de la mañana de sacarlo. Aquél era
 * un cajón de sastre silencioso; éste es para el crédito que NO se paga con
 * ninguna de las cuatro —el del ISSS, el de una aseguradora, lo que se liquida
 * por planilla o convenio— y **exige decir con qué** y dispara una solicitud de
 * confirmación. Sin él, la sala tenía que mentir eligiendo «Transferencia» para
 * poder cerrar el crédito, y una opción que obliga a mentir es peor que un
 * cajón de sastre. */
const OTRO = 'Otro';

const VER = [
    { value: 'DEBEN',    label: 'Con saldo' },
    { value: 'VENCIDOS', label: 'Pasados del plazo' },
    { value: 'TODOS',    label: 'Todos' },
];

const VACIO = [];

/** Lo que cada freno significa, en palabras del mostrador. */
const MOTIVO_DEL_FRENO = {
    NO_ES_COMPROBANTE: 'La foto no muestra un comprobante de pago.',
    ILEGIBLE: 'El comprobante no se lee: la foto está borrosa o cortada.',
    NO_APROBADO: 'Ese voucher salió declinado, así que no acredita ningún pago.',
    SIN_MONTO: 'No se pudo leer el monto del comprobante.',
    OTRO_BENEFICIARIO: 'El comprobante NO está a nombre de la empresa.',
    MONTO_MAYOR_AL_SALDO: 'El comprobante es por más de lo que este cliente debe.',
};


/** Lo que la insignia significa, en palabras. El color solo no se puede leer —
 *  ni con daltonismo ni con un lector de pantalla. */
function tituloDeDias(dias, saldo) {
    const s = severidadDeDias(dias, saldo);
    if (s.grave) return 'Más de dos meses sin pagar';
    if (s.variant === 'danger') return 'Pasado del plazo';
    if (s.porVencer) return 'Vence esta semana';
    return 'Dentro del plazo';
}

/** Cuánto del crédito está pagado, en enteros. Acotado a [0,100]: un abono de
 *  más —o un total en cero— no puede pintar una barra que se sale de su caja. */
function pagadoPct(c) {
    const total = Number(c?.total) || 0;
    if (total <= 0) return 0;
    const pagado = total - (Number(c?.saldo) || 0);
    return Math.max(0, Math.min(100, Math.round((pagado / total) * 100)));
}

/** Hace cuánto se leyó la cartera, en palabras. Un reloj exacto obliga a restar
 *  de cabeza; lo que se quiere saber es sólo si está al día. */
function desdeLaLectura(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 2)  return 'Al día';
    if (min < 60) return `Leído hace ${min} min`;
    const h = Math.round(min / 60);
    return `Leído hace ${h} h`;
}

export default function CuentasPorCobrarView() {
    const { hasPermission, getScope, user } = useAuth();
    const branches = useStaff((s) => s.branches) || VACIO;
    const empleados = useStaff((s) => s.employees) || VACIO;
    const showToast = useToastStore((s) => s.showToast);

    const puedeAbonar = hasPermission('cuentas_por_cobrar', 'can_edit');
    const alcance     = getScope('cuentas_por_cobrar');

    /* La sala vive en la DIRECCIÓN y no en `useState`: la sesión de sala se
     * cierra sola a los 5 minutos y la recarga volvería a «todas» sin decir
     * nada, con la lista de otra sucursal delante. */
    const [params, setParams] = useSearchParams();
    const sala = params.get('sala') || '';
    const setSala = useCallback((v) => {
        setParams((p) => {
            const q = new URLSearchParams(p);
            if (v) q.set('sala', String(v)); else q.delete('sala');
            q.delete('pagina');
            return q;
        }, { replace: true });
    }, [setParams]);

    const [busqueda, setBusqueda] = useState('');
    const [ver, setVer] = useState('DEBEN');
    const [creditos, setCreditos] = useState(VACIO);
    const [cargando, setCargando] = useState(true);
    const [abonando, setAbonando] = useState(null);
    const [viendo, setViendo] = useState(null);
    const [corrigiendo, setCorrigiendo] = useState(null);
    const [lectura, setLectura] = useState(null);

    /* Con alcance de una sala, el selector no se dibuja y la lista es la propia
     * —el servidor la acota igual—, así que no hay forma de mirar otra. */
    const salas = useMemo(() => {
        const propias = alcance === 'ALL'
            ? branches
            : branches.filter((b) => b.id === (user?.branchId ?? user?.branch_id));
        return propias.filter((b) => b.name !== 'Bodega' && b.name !== 'Administracion');
    }, [branches, alcance, user]);

    const nombreDeSala = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

    /* La ficha COMPLETA de quien vendió, del store. No alcanza con `{id, name}`:
     * `AvatarConEstado` saca la foto del objeto que recibe —el store sólo lo usa
     * para el aro de estado—, así que con medio objeto salían las iniciales y
     * nunca la cara. Y del store porque ahí las fotos ya vienen firmadas: pedir
     * 124 URLs firmadas para 124 círculos de 22 px no tiene sentido. */
    const vendedores = useMemo(() => new Map(empleados.map((e) => [String(e.id), e])), [empleados]);


    /* Sale del ESPEJO del portal, que un cron refresca cada hora. Antes se leía
     * en vivo del sistema de la caja y abrir la pantalla costaba seis
     * peticiones EN SERIE —la sucursal vive en su sesión, no se pueden hacer a
     * la vez—, o sea varios segundos de espera cada vez.
     *
     * El cobro sigue releyendo el origen: la lista se mira acá, el cobro se
     * decide allá. */
    const cargar = useCallback(async () => {
        setCargando(true);
        const [r, l] = await Promise.all([
            /* Sólo «Todos» baja el histórico entero (2,387 filas). Los otros dos
             * recortes viven dentro de los que deben, así que la base manda 124
             * y el navegador no filtra nada que ya podía no haber traído. */
            fetchCreditos({ sala: sala || null, soloConSaldo: ver !== 'TODOS' }),
            fetchUltimaLectura(),
        ]);
        if (r?.error) {
            showToast('No se pudo leer la cartera', mensajeAmigable(r.error), 'error');
            setCreditos(VACIO);
        } else {
            setCreditos(r?.creditos || VACIO);
        }
        setLectura(l);
        setCargando(false);
    }, [sala, ver, showToast]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala

    const conEdad = useMemo(
        () => creditos.map((c) => ({ ...c, ...edadDelCredito(c.fecha, c.saldo) })),
        [creditos],
    );

    const filtrados = useMemo(() => conEdad.filter((c) => {
        if (ver === 'DEBEN' && c.saldo <= 0.004) return false;
        if (ver === 'VENCIDOS' && (c.saldo <= 0.004 || !c.vencido)) return false;
        return tokenMatch(busqueda, c.cliente, c.documento, nombreDeSala.get(c.branch_id), String(c.saldo));
    // Los más viejos arriba: son los que hay que ir a cobrar, y es el orden en
    // que alguien recorre la lista con el teléfono en la mano.
    }).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)), [conEdad, ver, busqueda, nombreDeSala]);

    /* 50 y no 25: con 25 la sala más cargada (47 con saldo) quedaba partida en
     * dos páginas y la última fila de la primera mostraba UNA tarjeta con dos
     * huecos al lado. Los tamaños son los del portal —25/50/100— así que el
     * default es lo único que se puede elegir acá. */
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({
        total: filtrados.length, tamPorDefecto: 50,
    });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const totalDebido = useMemo(
        () => filtrados.reduce((t, c) => t + (Number(c.saldo) || 0), 0),
        [filtrados],
    );
    const vencidos = useMemo(
        () => conEdad.filter((c) => c.saldo > 0.004 && c.vencido).length,
        [conEdad],
    );

    const cobrar = useCallback(async (pago) => {
        /* El papel se sube DESPUÉS de que la lectura pasó y ANTES de tocar el
         * sistema de la caja: así el bucket no acumula los intentos descartados,
         * y el abono no queda registrado sin su respaldo.
         *
         * Si la subida falla NO se corta el cobro: el cliente está enfrente con
         * el dinero, y no cobrarle porque una foto no subió sería el peor de los
         * dos errores. Se avisa y se sigue — el número del comprobante queda
         * igual, que es lo que ata el pago al estado de cuenta. */
        let comprobanteUrl = null;
        if (pago.archivo) {
            try {
                comprobanteUrl = await subirComprobanteDeAbono(pago.archivo, abonando.branch_id);
            } catch (err) {
                showToast('El comprobante no se guardó',
                    `${mensajeAmigable(err)} El cobro sigue; el número queda anotado.`, 'warning');
            }
        }

        const r = await pagarCreditos({
            sala: abonando.branch_id,
            forma: pago.forma,
            documento: pago.documento,
            montoDocumento: pago.montoDocumento,
            aplicaciones: pago.aplicaciones,
            fechaDocumento: pago.fechaDocumento,
            pos: pago.pos,
            comprobanteUrl,
            lectura: pago.lectura || null,
        });
        if (r?.error || (r?.ok === false && !r?.aviso)) {
            showToast('No se pudo cobrar', mensajeAmigable(r.error || r), 'error');
            return false;
        }
        if (r.aviso) showToast('El pago quedó a medias', r.aviso, 'warning');
        else {
            const n = r.aplicaciones?.length || 1;
            showToast('Pago registrado',
                `${abonando.cliente} · ${formatMoney(r.aplicado)} en ${n} crédito${n === 1 ? '' : 's'}`,
                'success');
        }
        setAbonando(null);
        cargar();
        return true;
    }, [abonando, showToast, cargar]);

    const filtersContent = (
        <ViewTabBar
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por cliente, documento o monto…"
        />
    );

    return (
        <GlassViewLayout icon={HandCoins} title="Cuentas por cobrar" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Las dos cifras que la lista no contesta de un vistazo:
                        cuánto suma lo que se está mirando, y cuántos ya se
                        pasaron del plazo — que es el número que decide si hay
                        que salir a cobrar hoy. */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="min-w-0">
                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                Por cobrar
                            </span>
                            <span className="block text-h3 font-black tabular-nums text-content">
                                {formatMoney(totalDebido)}
                            </span>
                        </span>
                        <span className="min-w-0">
                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                Pasados del plazo
                            </span>
                            <span className={`block text-h3 font-black tabular-nums ${
                                vencidos ? 'text-warning-text' : 'text-content-2'}`}>
                                {vencidos}
                            </span>
                        </span>

                        {/* Cuándo se leyó. Una lista congelada se ve exactamente
                            igual de bien que una fresca, así que el sello es lo
                            único que las distingue. Y se dice en horas y no con
                            un reloj: lo que importa es si está al día. */}
                        {lectura?.corrio_el && (
                            <span className="min-w-0 flex items-center gap-1.5 text-micro text-content-3">
                                <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                {desdeLaLectura(lectura.corrio_el)}
                            </span>
                        )}
                    </div>

                    <FilterBar
                        onClear={() => { setVer('DEBEN'); setSala(''); }}
                        activeCount={(ver !== 'DEBEN' ? 1 : 0) + (sala ? 1 : 0)}
                    >
                        <FilterBar.Section active={ver !== 'DEBEN'} onClear={() => setVer('DEBEN')} label="ver">
                            <FilterBar.Opciones
                                label="Ver" icon={CalendarClock}
                                value={ver} onChange={(v) => { setVer(v || 'DEBEN'); setPage(1); }}
                                options={VER} ancho="185px"
                            />
                        </FilterBar.Section>

                        {/* Con una sola sala no se dibuja: un control con una
                            opción no es una elección, y ocupa el lugar de una. */}
                        {salas.length > 1 && (
                            <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                <FilterBar.Opciones
                                    label="Sucursal" icon={Building2}
                                    value={sala} onChange={(v) => setSala(v || '')}
                                    options={[{ value: '', label: 'Todas' },
                                        ...salas.map((b) => ({ value: String(b.id), label: b.name }))]}
                                    ancho="165px"
                                />
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>

                {cargando ? (
                    <LoadingState label="Leyendo la cartera de las salas" />
                ) : !filtrados.length ? (
                    busqueda ? (
                        <EmptyState compact icon={Search} title="Sin resultados"
                            subtitle={`Ningún crédito coincide con «${busqueda}».`}
                            action={<Button variant="secondary" onClick={() => setBusqueda('')}>Limpiar la búsqueda</Button>} />
                    ) : (
                        /* Un vacío FELIZ cuando es «con saldo»: nadie debe nada.
                           Se nombra como tal en vez de dejar el cartel gris de
                           «no hay datos», que se lee como que algo falló. */
                        <EmptyState compact icon={HandCoins}
                            title={ver === 'VENCIDOS' ? 'Nadie se pasó del plazo' : 'Nadie debe nada'}
                            subtitle={ver === 'VENCIDOS'
                                ? `Todos los créditos con saldo están dentro de los ${DIAS_DE_PLAZO} días.`
                                : 'Todos los créditos están pagados.'}
                            action={ver !== 'TODOS'
                                ? <Button variant="secondary" onClick={() => setVer('TODOS')}>Ver todos</Button>
                                : undefined} />
                    )
                ) : (
                    <>
                        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                            {pagina.map((c) => (
                                <div key={`${c.branch_id}-${c.credito}`}
                                    /* Sin `data-tono`: el aro de color decía lo
                                       mismo que la insignia de días y el usuario
                                       lo pidió fuera —«con el badge se
                                       entiende»—. Dos señales para un solo dato
                                       es ruido. */
                                    data-surface="card"
                                    data-interactive
                                    data-destino="ficha"
                                    role="button" tabIndex={0}
                                    onClick={() => setViendo(c)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViendo(c); }
                                    }}
                                    className="rounded-2xl p-3.5 flex flex-col gap-3 min-w-0 text-left
                                               min-h-[var(--tap-min)] active:scale-[0.97] transition-transform">

                                    {/* 1 · QUIÉN. El documento debajo y en micro:
                                        hace falta para buscar el papel, pero no
                                        es lo que se lee primero. La sala sólo
                                        cuando se están mirando todas — con una
                                        elegida, repetirla 47 veces es ruido. */}
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="min-w-0">
                                            <span className="block text-body-sm font-bold text-content truncate leading-tight">
                                                {c.cliente}
                                            </span>
                                            <span className="block text-micro text-content-3 truncate mt-0.5">
                                                {!sala && `${nombreDeSala.get(c.branch_id) || `Sucursal ${c.branch_id}`} · `}
                                                {c.documento}
                                            </span>
                                        </span>
                                        {/* Cuatro escalones y no dos: dentro del
                                            plazo, por vencer (los últimos cinco
                                            días), pasado el mes, y pasados dos
                                            meses. El último cambia de FORMA
                                            —relleno, con icono— y no sólo de
                                            color, porque el mismo rojo repetido
                                            se aprende a ignorar en una semana. */}
                                        <Badge {...severidadDeDias(c.dias, c.saldo)} size="sm"
                                            icon={severidadDeDias(c.dias, c.saldo).grave ? AlertTriangle : undefined}
                                            title={tituloDeDias(c.dias, c.saldo)}>
                                            {c.dias} d
                                        </Badge>
                                    </div>

                                    {/* 2 · CUÁNTO, con la barra de cuánto lleva
                                        pagado. La barra no es adorno: «$19.40 de
                                        $139.40» obliga a dividir de cabeza para
                                        saber si es una deuda que ya casi se pagó
                                        o uno que no ha dado nada, y eso decide a
                                        quién se llama primero.

                                        `data-medida="dato"` porque el ANCHO ES el
                                        dato: estirarla al blanco de dedo mínimo
                                        sería mentir sobre la proporción. */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-baseline gap-1.5 min-w-0">
                                            <span className="text-h3 font-black tabular-nums text-content leading-none">
                                                {formatMoney(c.saldo)}
                                            </span>
                                            {/* El total, un escalón abajo del saldo y no en
                                                micro: es la otra mitad de la pregunta —«debe
                                                $22.85» no dice nada sin saber si compró $32
                                                o $300—, y en micro había que buscarlo. */}
                                            <span className="text-body-sm text-content-2 tabular-nums truncate">
                                                de {formatMoney(c.total)}
                                            </span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden"
                                            data-medida="dato" role="img"
                                            aria-label={`Lleva ${pagadoPct(c)}% pagado`}>
                                            <span className="block h-full rounded-full bg-success transition-[width]"
                                                style={{ width: `${pagadoPct(c)}%` }} />
                                        </div>
                                    </div>

                                    {/* 3 · QUIÉN VENDIÓ y CUÁNDO, en un renglón.
                                        Antes eran tres renglones —fecha, «sin
                                        abonos desde el portal» y el vendedor— y
                                        el del medio decía lo mismo en las 124
                                        tarjetas, o sea que no decía nada. La
                                        fecha del último abono queda para cuando
                                        EXISTE, que es cuando informa. */}
                                    <div className="flex items-center justify-between gap-2 min-w-0
                                                    pt-2.5 border-t border-border/50">
                                        <span className="flex items-center gap-1.5 min-w-0 text-micro text-content-3">
                                            {c.vendedor?.name && (
                                                <AvatarConEstado
                                                    emp={vendedores.get(String(c.vendedor_id))
                                                         || { id: c.vendedor_id, name: c.vendedor.name }}
                                                    px={22} mostrarChip={false} radio="rounded-full" />
                                            )}
                                            <span className="truncate">
                                                {c.vendedor?.name || 'Sin vendedor'} · {fechaCorta(c.fecha)}
                                                {c.ultimo_abono_el && ` · abonó ${fechaCorta(c.ultimo_abono_el)}`}
                                            </span>
                                        </span>

                                        {puedeAbonar && c.saldo > 0.004 && (
                                            /* `stopPropagation` porque la tarjeta
                                               entera abre la ficha: sin esto,
                                               cobrar abriría además el panel
                                               detrás del diálogo. */
                                            <Button variant="secondary" size="sm" icon={HandCoins}
                                                onClick={(e) => { e.stopPropagation(); setAbonando(c); }}>
                                                Abonar
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {filtrados.length > pageSize && (
                            <TablePagination page={page} totalPages={totalPages} onPageChange={setPage}
                                pageSize={pageSize} onPageSizeChange={setPageSize}
                                total={filtrados.length} unit="créditos" />
                        )}
                    </>
                )}
            </div>

            {viendo && (
                <FichaDelCredito credito={viendo} vendedor={vendedores.get(String(viendo.vendedor_id))}
                    puedeAbonar={puedeAbonar}
                    onCorregir={(a) => setCorrigiendo({ credito: viendo, abono: a })}
                    onClose={() => setViendo(null)}
                    onAbonar={puedeAbonar ? () => { setViendo(null); setAbonando(viendo); } : undefined} />
            )}

            {corrigiendo && (
                <PedirCorreccion {...corrigiendo} onClose={() => setCorrigiendo(null)}
                    onListo={() => { setCorrigiendo(null); cargar(); }} />
            )}

            {abonando && (
                <DialogoAbono credito={abonando} onClose={() => setAbonando(null)} onCobrar={cobrar} />
            )}
        </GlassViewLayout>
    );
}

/**
 * La ficha completa de un crédito: qué compró, quién le vendió, y cada abono.
 *
 * Pedido del usuario (2-sep): «al tocar la card que muestre toda la información
 * incluido la compra». Los renglones salen de las ventas del portal —los 124
 * créditos con saldo tienen los suyos— así que abrir esto no sale a la red del
 * otro sistema.
 */
function FichaDelCredito({ credito, vendedor, puedeAbonar, onClose, onAbonar, onCorregir }) {
    const [datos, setDatos] = useState(null);
    const [delOrigen, setDelOrigen] = useState(null);
    const [cargando, setCargando] = useState(true);

    /* Dos fuentes en paralelo, y cada una sabe algo que la otra no:
     *   el PORTAL   quién cobró, con qué comprobante y a qué hora exacta
     *   el ORIGEN   TODOS los abonos, incluidos los cobrados en la caja
     * Mostrar sólo los del portal era mostrar la mitad, y justo la mitad que
     * menos importa cuando alguien discute un saldo. */
    const cargar = useCallback(async () => {
        setCargando(true);
        const [d, h] = await Promise.all([
            fetchCreditoDetalle(credito.id),
            fetchHistorialDelOrigen({ sala: credito.branch_id, credito: credito.credito }),
        ]);
        setDatos(d?.error ? null : d);
        setDelOrigen(h?.error || !h?.ok ? null : (h.abonos || VACIO));
        setCargando(false);
    }, [credito.id, credito.branch_id, credito.credito]);    

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- al abrir la ficha

    const c = datos?.credito;
    const compra = datos?.compra || VACIO;
    const delPortal = datos?.abonos || VACIO;

    /* La lista del ORIGEN manda —es la que explica el saldo— y de la del portal
     * se toma quién cobró. Se emparejan por monto y fecha, que es lo único que
     * los dos lados comparten: el id del abono de allá no se guardaba acá.
     * Un abono sin pareja simplemente sale sin cara, que es la verdad. */
    const abonos = useMemo(() => {
        // Sin el historial del origen no hay id que borrar, así que tampoco se
        // ofrece corregir: un botón que no puede terminar su trabajo es peor
        // que no tenerlo.
        if (!delOrigen) return delPortal.map((a) => ({ ...a, origen: 'portal' }));
        const libres = [...delPortal];
        return delOrigen.map((o) => {
            const i = libres.findIndex((p) => Math.abs(Number(p.monto) - Number(o.monto)) < 0.005
                && String(p.created_at).slice(0, 10) === o.fecha);
            const par = i >= 0 ? libres.splice(i, 1)[0] : null;
            return {
                id: o.erp_id || `${o.fecha}-${o.monto}`,
                erp_id_borrable: o.erp_id,
                monto: o.monto, forma: o.forma, documento: o.documento,
                fecha: o.fecha, hora: o.hora,
                abonado_por: par?.abonado_por ?? null,
                cobrado_por: par?.cobrado_por ?? null,
                saldo_despues: par?.saldo_despues ?? null,
                origen: par ? 'portal' : 'caja',
            };
        });
    }, [delOrigen, delPortal]);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Ficha del crédito">
            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-h3 font-bold text-content truncate">{credito.cliente}</h3>
                        <p className="text-body-sm text-content-2 mt-0.5 truncate">
                            {c?.sala || ''}{c?.sala ? ' · ' : ''}{credito.documento}
                        </p>
                    </div>
                    {credito.saldo > 0.004 && (
                        <Badge {...severidadDeDias(credito.dias, credito.saldo)} size="sm"
                            icon={severidadDeDias(credito.dias, credito.saldo).grave ? AlertTriangle : undefined}>
                            {credito.dias} día{credito.dias === 1 ? '' : 's'} · {tituloDeDias(credito.dias, credito.saldo)}
                        </Badge>
                    )}
                </div>

                {cargando ? <LoadingState label="Abriendo la ficha" /> : (
                    <>
                        {/* El dinero, como una sola idea y no como tres cajas.
                            Lo que se pregunta al abrir esto es «¿cuánto falta?»,
                            y en segundo lugar «¿cuánto lleva?» — la barra
                            contesta las dos de un vistazo, y el de/pagado queda
                            de nota al pie en vez de competir por el tamaño. */}
                        <div data-surface="card" className="rounded-2xl p-4 space-y-2">
                            <div className="flex items-end justify-between gap-3 flex-wrap">
                                <span className="min-w-0">
                                    <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                        Debe
                                    </span>
                                    <span className="block text-h1 font-black tabular-nums text-content leading-none">
                                        {formatMoney(c?.saldo ?? credito.saldo)}
                                    </span>
                                </span>
                                <span className="text-body-sm text-content-2 tabular-nums">
                                    <span className="text-success-text font-bold">
                                        {formatMoney(c?.abonado ?? 0)}
                                    </span>
                                    {' '}pagados de {formatMoney(c?.total ?? credito.total)}
                                </span>
                            </div>
                            <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden"
                                data-medida="dato" role="img"
                                aria-label={`Lleva ${pagadoPct(c || credito)}% pagado`}>
                                <span className="block h-full rounded-full bg-success transition-[width]"
                                    style={{ width: `${pagadoPct(c || credito)}%` }} />
                            </div>
                        </div>

                        {/* Los cuatro datos de contexto, en dos columnas. «Le
                            vendió» lleva cara, así que la fila se alinea al
                            centro y no a la línea de base. */}
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5 text-body-sm">
                            {[['Compró el', fechaCorta(c?.fecha || credito.fecha)],
                              ['Último abono', c?.ultimo_abono_el
                                  ? fechaCorta(c.ultimo_abono_el)
                                  : 'ninguno desde el portal'],
                              ['Documento', `${c?.tipo_doc || ''} ${credito.documento || ''}`.trim()]].map(([k, v]) => (
                                <div key={k} className="flex items-baseline justify-between gap-3 min-w-0">
                                    <dt className="text-content-3 shrink-0">{k}</dt>
                                    <dd className="text-content font-medium text-right truncate">{v}</dd>
                                </div>
                            ))}
                            <div className="flex items-center justify-between gap-3 min-w-0">
                                <dt className="text-content-3 shrink-0">Le vendió</dt>
                                <dd className="flex items-center gap-2 min-w-0">
                                    {c?.vendedor && (
                                        <AvatarConEstado emp={vendedor || { id: c.vendedor_id, name: c.vendedor }}
                                            px={26} mostrarChip={false} radio="rounded-full" />
                                    )}
                                    <span className="text-content font-medium truncate">
                                        {c?.vendedor || 'sin registrar'}
                                    </span>
                                </dd>
                            </div>
                        </dl>

                        <section className="space-y-2">
                            <h4 className="flex items-center justify-between gap-2 text-body-sm font-bold text-content">
                                <span className="flex items-center gap-1.5">
                                    <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                                    Lo que se llevó
                                </span>
                                {compra.length > 0 && (
                                    <span className="text-micro font-normal text-content-3">
                                        {compra.length} producto{compra.length === 1 ? '' : 's'}
                                    </span>
                                )}
                            </h4>
                            {compra.length === 0 ? (
                                <p className="text-body-sm text-content-3">
                                    No se encontraron los productos de esta compra.
                                </p>
                            ) : (
                                /* Lista y no tabla: en el teléfono una tabla de
                                   cuatro columnas se parte o se sale, y acá lo
                                   que importa es el nombre del producto. */
                                <ul className="space-y-0">
                                    {compra.map((r) => (
                                        <li key={r.id} className="flex items-center justify-between gap-3 min-w-0
                                                                   py-2 border-b border-border/40 last:border-0">
                                            <span className="min-w-0">
                                                <span className="block text-body-sm text-content truncate">{r.descripcion}</span>
                                                <span className="block text-micro text-content-3 truncate">
                                                    {Number(r.cantidad)} × {formatMoney(r.precio_unitario)}
                                                    {r.presentacion ? ` · ${r.presentacion}` : ''}
                                                </span>
                                            </span>
                                            <span className="text-body-sm tabular-nums font-medium text-content shrink-0">
                                                {formatMoney(r.total_linea)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="space-y-2">
                            <h4 className="flex items-center justify-between gap-2 text-body-sm font-bold text-content">
                                <span className="flex items-center gap-1.5">
                                    <HandCoins className="w-4 h-4 shrink-0" aria-hidden="true" />
                                    Abonos
                                </span>
                                {abonos.length > 0 && (
                                    <span className="text-micro font-normal text-content-3">
                                        {abonos.length}
                                    </span>
                                )}
                            </h4>
                            {abonos.length === 0 ? (
                                <p className="text-body-sm text-content-3">
                                    {delOrigen
                                        ? 'Todavía no se le ha abonado nada.'
                                        : 'No se pudo leer el historial de la caja.'}
                                </p>
                            ) : (
                                <ul className="space-y-0">
                                    {abonos.map((a) => (
                                        <li key={a.id} className="flex items-center justify-between gap-3 min-w-0
                                                                   py-2 border-b border-border/40 last:border-0">
                                            <span className="flex items-center gap-2 min-w-0">
                                                {/* La cara de quien cobró, igual que la de
                                                    quien vendió: quién recibió el dinero es
                                                    justo lo que el sistema de la caja no
                                                    guarda, así que acá se ve. */}
                                                {a.abonado_por && (
                                                    <AvatarConEstado
                                                        emp={{ id: a.abonado_por, name: a.cobrado_por }}
                                                        px={26} mostrarChip={false} radio="rounded-full" />
                                                )}
                                                <span className="min-w-0">
                                                    <span className="block text-body-sm text-content">
                                                        {formatMoney(a.monto)}
                                                        <span className="text-content-3 font-normal"> · {a.forma}</span>
                                                        {a.documento ? <span className="text-content-3 font-normal"> ({a.documento})</span> : null}
                                                    </span>
                                                    <span className="block text-micro text-content-3 truncate">
                                                        {fechaCorta(a.fecha)}{a.hora ? `, ${a.hora}` : ''}
                                                        {' · '}
                                                        {/* Un abono cobrado en la caja no tiene
                                                            nombre y no se le inventa uno: allá
                                                            queda a nombre del usuario de la sala,
                                                            que en tres de las seis es una cuenta
                                                            compartida. Decir «en la caja» es la
                                                            verdad; poner un nombre, no. */}
                                                        {a.cobrado_por || 'cobrado en la caja'}
                                                    </span>
                                                </span>
                                            </span>
                                            <span className="flex items-center gap-2 shrink-0">
                                                {a.saldo_despues != null && (
                                                    <span className="text-micro tabular-nums text-content-3">
                                                        quedó {formatMoney(a.saldo_despues)}
                                                    </span>
                                                )}
                                                {/* Quien cobró NO lo deshace: un abono
                                                    aplicado es dinero. Se PIDE, y lo decide
                                                    quien tenga el permiso. */}
                                                {puedeAbonar && a.erp_id_borrable && (
                                                    <Button variant="ghost" size="sm" iconOnly icon={Pencil}
                                                        title="Pedir que se corrija o se anule"
                                                        onClick={() => onCorregir(a)} />
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                    {onAbonar && credito.saldo > 0.004 && (
                        <Button variant="primary" icon={HandCoins} onClick={onAbonar}>Abonar</Button>
                    )}
                </div>
            </div>
        </LiquidModal>
    );
}

/**
 * Cobrar: el papel primero, el reparto después.
 *
 * ── El orden lo pidió el usuario, y tiene una razón ───────────────────────
 * «Si es transferencia / cheque / tarjeta, que se anexe el comprobante PRIMERO
 * antes de digitar montos, y que de ahí mismo lo tome». En la salida de una
 * bolsa el portal hace lo contrario —se escribe y la foto confirma— y está
 * bien: allá el monto lo decide quien saca el dinero. Acá lo decide el papel
 * que el cliente trajo, y pedir que se escriba primero es invitar a escribir lo
 * que se esperaba —el saldo redondo— y no lo que el documento dice.
 *
 * ── Y un pago puede cubrir VARIOS créditos ────────────────────────────────
 * «¿Qué pasa si hace una sola transferencia para pagar 3 créditos?». Medido:
 * **24 de los 43 clientes con saldo tienen más de uno**, y uno tiene once. Así
 * que el reparto no es un extra: es el caso normal. El pago es el documento y
 * los abonos dicen cuánto de él fue a cada crédito.
 */
function DialogoAbono({ credito, onClose, onCobrar }) {
    const [forma, setForma] = useState('Efectivo');
    const [documento, setDocumento] = useState('');
    // Sólo para «Otro»: es lo que quien aprueba va a leer, y por eso es
    // obligatorio. Con las otras formas el papel habla solo.
    const [motivo, setMotivo] = useState('');
    const [aprobacion, setAprobacion] = useState(false);
    const [fechaDoc, setFechaDoc] = useState('');
    const [pos, setPos] = useState('');
    const [montoDoc, setMontoDoc] = useState('');
    const [ocupado, setOcupado] = useState(false);

    // El papel
    const [archivo, setArchivo] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [lectura, setLectura] = useState(null);
    const [errorLectura, setErrorLectura] = useState(null);

    // El reparto: `credito.id` → cuánto
    const [hermanos, setHermanos] = useState(VACIO);
    /* El diálogo abre con UN crédito: el que se tocó. Antes listaba todos los
     * del cliente y el que se venía a cobrar se perdía entre ellos —lo señaló
     * el usuario mirando dos créditos de MAPFRE del mismo día—. Repartir se
     * PIDE, y sólo cuando hay un documento que repartir: el efectivo no se
     * reparte, se cobra dos veces. */
    const [repartir, setRepartir] = useState(false);
    const [reparto, setReparto] = useState(() => ({ [credito.id]: '' }));

    const [posDisponibles, setPosDisponibles] = useState(VACIO);

    /* «Otro» no pide foto: lo que se liquida por planilla o convenio no viene
     * con un comprobante que se pueda leer. Pide DECIR con qué, que es el dato
     * que hace falta para poder confirmarlo después. */
    const esOtro = forma === OTRO;
    const conPapel = forma !== 'Efectivo' && !esOtro;
    /* La aprobación se PIDE y no se deduce de la forma de pago: son dos
     * preguntas distintas —«con qué pagó» y «esto necesita firma»— y meterlas
     * en un solo control obligaba a registrar como «Otro» un pago hecho por
     * transferencia, o sea a perder el dato con el que se cuadra el banco.
     * Propuesta del usuario (2-sep).
     *
     * `Otro` la enciende y no la deja apagar: un pago sin forma reconocible no
     * puede entrar sin que alguien lo mire, que es lo que se ganó al quitar
     * «Otro» esta mañana. El servidor lo vuelve a exigir por su cuenta. */
    const pideAprobacion = esOtro || aprobacion;

    useEffect(() => {
        let vivo = true;
        (async () => {
            const [otros, proveedores] = await Promise.all([
                fetchCreditosDelCliente(credito.id), fetchPosProveedores(),
            ]);
            if (!vivo) return;
            setHermanos(otros);
            setPosDisponibles(proveedores);
        })();
        return () => { vivo = false; };
     
    }, [credito.id]);

    /* Cambiar de forma tira el papel y lo leído. No es prolijidad: la foto de
     * una transferencia leída como cheque daría otros campos, y dejarla puesta
     * significaría cobrar con un comprobante que nadie volvió a mirar. */
    const cambiarForma = useCallback((v) => {
        const nueva = v || 'Efectivo';
        setForma(nueva);
        if (nueva === 'Efectivo') setRepartir(false);
        setArchivo(null); setLectura(null); setErrorLectura(null);
        setDocumento(''); setFechaDoc(''); setPos(''); setMontoDoc(''); setMotivo('');
        if (nueva !== OTRO) setAprobacion(false);
    }, []);

    /* Los OTROS créditos del cliente, sin el que se está cobrando. */
    const otros = useMemo(
        () => hermanos.filter((h) => String(h.id) !== String(credito.id)),
        [hermanos, credito.id],
    );

    const leer = useCallback(async (f) => {
        setArchivo(f); setLectura(null); setErrorLectura(null);
        if (!f) return;
        setLeyendo(true);
        const r = await leerPagoDeCredito(f, { forma, saldo: sumaDeSaldos(hermanos, credito) });
        setLeyendo(false);
        if (r?.error) { setErrorLectura(mensajeAmigable(r.error)); return; }
        setLectura(r);
        /* Lo leído LLENA el formulario, y queda editable: el lector acierta casi
         * siempre y se equivoca a veces, y quien tiene el papel en la mano es
         * quien puede corregirlo. Un campo que no se puede tocar convierte un
         * error de lectura en un pago que no se puede registrar. */
        if (r.sugerido?.monto != null) {
            setMontoDoc(String(r.sugerido.monto));
            /* Lo leído se ASIGNA solo, que es lo que el usuario pidió: «carga el
             * monto y pregunta cuánto se asignará a cada una». Al crédito que se
             * abrió le toca lo que quepa; si sobra y el cliente tiene otros, se
             * abre el reparto con el resto repartido del más viejo al más nuevo
             * — y ahí se corrige a mano. Si sobra y NO hay otros, se deja el
             * total: la advertencia de «sobran $X» es la que tiene que hablar. */
            const suyo = Math.min(Number(r.sugerido.monto), Number(credito.saldo) || 0);
            const resto = Number((Number(r.sugerido.monto) - suyo).toFixed(2));
            const nuevo = { [credito.id]: (resto > 0.004 ? suyo : Number(r.sugerido.monto)).toFixed(2) };
            if (resto > 0.004 && otros.length) {
                setRepartir(true);
                let queda = resto;
                for (const h of otros) {
                    if (queda <= 0.004) break;
                    const toma = Math.min(queda, Number(h.saldo) || 0);
                    if (toma > 0.004) { nuevo[h.id] = toma.toFixed(2); queda = Number((queda - toma).toFixed(2)); }
                }
            }
            setReparto(nuevo);
        }
        if (r.sugerido?.fecha) setFechaDoc(r.sugerido.fecha);
        if (r.sugerido?.documento) setDocumento(String(r.sugerido.documento));
        if (r.sugerido?.pos) setPos(r.sugerido.pos);
    }, [forma, hermanos, credito, otros]);

    /* El reparto se propone solo, del más viejo al más nuevo, hasta agotar el
     * documento. Es el orden en que conviene cerrar: el que lleva más tiempo.
     * Se propone y no se impone — la persona lo corrige renglón por renglón. */
    const repartirSolo = useCallback((total) => {
        let queda = Number(total) || 0;
        const nuevo = {};
        // Del actual PRIMERO y después los otros por antigüedad: quien abrió
        // este crédito vino a cobrar éste, no el más viejo del cliente.
        for (const h of [credito, ...otros]) {
            if (queda <= 0.004) break;
            const toma = Math.min(queda, Number(h.saldo) || 0);
            if (toma > 0.004) { nuevo[h.id] = toma.toFixed(2); queda = Number((queda - toma).toFixed(2)); }
        }
        setReparto(nuevo);
    }, [credito, otros]);

    /* En un `useMemo` y no suelto: lo consume un `useCallback`, y una lista
     * nueva en cada render le cambiaría las dependencias siempre. */
    const listaDeCreditos = useMemo(
        () => (repartir && hermanos.length ? hermanos : [credito]),
        [repartir, hermanos, credito],
    );
    // Repartir sólo tiene sentido con un DOCUMENTO: un comprobante es uno y
    // puede cubrir varios créditos. El efectivo se cobra de a uno.
    const puedeRepartir = forma !== 'Efectivo' && otros.length > 0;
    const sumaRepartida = Object.values(reparto)
        .reduce((t, v) => t + (Number(v) || 0), 0);
    // Con papel el total lo dice el comprobante; con «Otro» lo escribe quien
    // cobra —no hay documento que leer— y con efectivo es lo que se reparte.
    const totalPago = (conPapel || esOtro) ? Number(montoDoc) : sumaRepartida;

    const bloqueado = lectura && lectura.veredicto !== 'OK';
    const cuadra = Number.isFinite(totalPago) && totalPago > 0
        && Math.abs(sumaRepartida - totalPago) < 0.005;
    const listo = !bloqueado && cuadra
        && (!conPapel || (archivo && lectura))
        && (!pideAprobacion || motivo.trim().length >= 5);

    const cobrar = useCallback(async () => {
        setOcupado(true);
        const aplicaciones = listaDeCreditos
            .filter((h) => Number(reparto[h.id]) > 0.004)
            .map((h) => ({ credito: h.credito, monto: Number(reparto[h.id]) }));
        await onCobrar({
            forma, documento: documento.trim(), montoDocumento: Number(totalPago.toFixed(2)),
            aplicaciones, archivo, lectura, fechaDocumento: fechaDoc || null, pos: pos || null,
            motivo: motivo.trim() || null, requiereAprobacion: pideAprobacion,
        });
        setOcupado(false);
    }, [listaDeCreditos, reparto, forma, documento, totalPago, archivo, lectura, fechaDoc, pos, motivo, pideAprobacion, onCobrar]);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Cobrar un crédito">
            <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
                <div>
                    <h3 className="text-h3 font-bold text-content">Recibir un pago</h3>
                    <p className="text-body-sm text-content-2 mt-1 truncate">{credito.cliente}</p>
                    {/* CUÁL crédito. Sin esto, con dos del mismo día y el mismo
                        cliente no había forma de saber en cuál se estaba. */}
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {fechaCorta(credito.fecha)} · {credito.documento} · debe {formatMoney(credito.saldo)}
                    </p>
                </div>

                <LiquidSelect label="Con qué paga" value={forma} onChange={cambiarForma}
                    options={FORMAS.map((f) => ({ value: f, label: f }))} clearable={false} />

                {/* ── El papel, ANTES de los montos ───────────────────────── */}
                {conPapel && (
                    <div className="space-y-3">
                        <FileField label={`Foto del comprobante (${forma.toLowerCase()})`}
                            accept="image/*" value={archivo}
                            onChange={leer} onClear={() => leer(null)} />

                        {leyendo && <LoadingState label="Leyendo el comprobante" />}

                        {errorLectura && (
                            /* «No se pudo preguntar» NO es «el comprobante está
                               mal», y se dicen distinto: lo primero se arregla
                               reintentando y lo segundo no. */
                            <Notice variant="warning" icon={AlertTriangle}>
                                No se pudo leer el comprobante: {errorLectura} Vuelve a intentarlo,
                                o escribe los datos a mano.
                            </Notice>
                        )}

                        {bloqueado && (
                            <Notice variant="danger" icon={AlertTriangle}>
                                {MOTIVO_DEL_FRENO[lectura.veredicto]
                                    || 'El comprobante no se pudo dar por bueno.'}
                                {lectura.veredicto === 'OTRO_BENEFICIARIO' && lectura.leido?.beneficiario
                                    && ` Dice «${lectura.leido.beneficiario}».`}
                            </Notice>
                        )}

                        {lectura && !bloqueado && (lectura.avisos || []).length > 0 && (
                            <Notice variant="warning">{lectura.avisos.join(' ')}</Notice>
                        )}
                    </div>
                )}

                {/* El interruptor va con CUALQUIER forma: un pago del ISSS por
                    transferencia también necesita firma, y antes había que
                    mentir eligiendo «Otro» para conseguirla. Con «Otro» viene
                    encendido y no se apaga. */}
                <div data-surface="card" className="rounded-xl p-3 flex items-center justify-between gap-3">
                    <span className="min-w-0">
                        <span className="block text-body-sm font-bold text-content">
                            Solicitar aprobación
                        </span>
                        <span className="block text-micro text-content-3">
                            {esOtro
                                ? '«Otro» siempre va a aprobación.'
                                : 'El abono entra ya y alguien lo revisa después.'}
                        </span>
                    </span>
                    <Switch checked={pideAprobacion} disabled={esOtro} variant="success"
                        size="sm" onChange={setAprobacion} />
                </div>

                {esOtro && (
                    <PortalInput label="Monto del pago" inputMode="decimal" value={montoDoc}
                        onChange={(e) => setMontoDoc(e.target.value)} />
                )}

                {pideAprobacion && (
                    /* El motivo es lo que quien aprueba va a leer, así que es
                       obligatorio. Con las otras formas el papel habla solo; acá
                       no hay papel que hable. */
                    <PortalTextarea label="Motivo" value={motivo} rows={2}
                        placeholder="ISSS, planilla de agosto"
                        onChange={(e) => setMotivo(e.target.value)} />
                )}

                {/* Los montos sólo después de que el papel pasó: pedirlos antes
                    es invitar a escribir lo que se esperaba. */}
                {(!conPapel || (lectura && !bloqueado)) && (
                    <>
                        {conPapel && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <PortalInput label="Monto del comprobante" inputMode="decimal"
                                    value={montoDoc} onChange={(e) => setMontoDoc(e.target.value)} />
                                <PortalInput label="Fecha del comprobante" type="date"
                                    value={fechaDoc} onChange={(e) => setFechaDoc(e.target.value)} />
                                <PortalInput label="Número del comprobante" value={documento} maxLength={40}
                                    onChange={(e) => setDocumento(e.target.value)} />
                                {forma === 'Tarjeta' && (
                                    <LiquidSelect label="POS" value={pos} onChange={(v) => setPos(v || '')}
                                        options={posDisponibles.map((p) => ({ value: p.codigo, label: p.nombre }))} />
                                )}
                            </div>
                        )}

                        {/* ── A qué créditos se aplica ────────────────────── */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-body-sm font-bold text-content">
                                    {repartir ? 'A qué créditos se aplica' : 'Cuánto se le abona'}
                                </span>
                                {repartir && totalPago > 0 && (
                                    <Button variant="ghost" size="sm"
                                        onClick={() => repartirSolo(totalPago)}>
                                        Repartir del más viejo
                                    </Button>
                                )}
                            </div>

                            {listaDeCreditos.map((h) => {
                                const esEste = String(h.id) === String(credito.id);
                                const puesto = Number(reparto[h.id]) || 0;
                                const debe = Number(h.saldo) || 0;
                                const seExcede = puesto > debe + 0.004;
                                return (
                                    /* Cada crédito en su propia tarjeta y no como
                                       dos renglones sueltos: con dos del mismo día
                                       y el mismo cliente, la fila con un campo al
                                       lado no decía qué era el campo ni contra qué
                                       tope. Ahora dice «Abona … de $X» y trae el
                                       atajo de poner todo. */
                                    <div key={h.id} data-surface="card"
                                        data-tono={seExcede ? 'danger' : undefined}
                                        className="rounded-xl p-2.5 flex items-center gap-3 min-w-0">
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-body-sm text-content truncate">
                                                    {fechaCorta(h.fecha)} · {h.documento}
                                                </span>
                                                {esEste && listaDeCreditos.length > 1 && (
                                                    <Badge variant="brand" size="sm">este</Badge>
                                                )}
                                            </span>
                                            <span className="block text-micro text-content-3">
                                                debe {formatMoney(debe)} · {h.dias ?? credito.dias} días
                                            </span>
                                        </span>

                                        <span className="shrink-0 flex items-center gap-1.5">
                                            <span className="w-24">
                                                <PortalInput label="Abona" inputMode="decimal" placeholder="0.00"
                                                    value={reparto[h.id] ?? ''}
                                                    onChange={(e) => setReparto((r) => ({ ...r, [h.id]: e.target.value }))} />
                                            </span>
                                            {/* «Todo» es el caso normal —se paga el
                                                crédito completo— y escribir $35.57
                                                a mano es donde se equivoca uno. */}
                                            <Button variant="ghost" size="sm"
                                                title={`Abonar los ${formatMoney(debe)}`}
                                                onClick={() => setReparto((r) => ({ ...r, [h.id]: debe.toFixed(2) }))}>
                                                Todo
                                            </Button>
                                        </span>
                                    </div>
                                );
                            })}

                            {/* «Abonar a otra cuenta» y no la lista completa de
                                entrada: el crédito que se vino a cobrar es el
                                que importa, y ponerlo entre los otros diez del
                                cliente lo esconde. Sólo con documento — un
                                comprobante es uno y puede cubrir varios; el
                                efectivo se cobra de a uno. */}
                            {puedeRepartir && !repartir && (
                                <Button variant="ghost" size="sm" icon={HandCoins}
                                    onClick={() => setRepartir(true)}>
                                    Abonar también a otra cuenta ({otros.length})
                                </Button>
                            )}

                            <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border/60">
                                <span className="text-body-sm text-content-2">
                                    {(conPapel || esOtro) ? 'Va aplicado' : 'Total a cobrar'}
                                </span>
                                <span className={`text-body font-black tabular-nums ${
                                    cuadra || (!conPapel && !esOtro) ? 'text-content' : 'text-danger-text'}`}>
                                    {formatMoney(sumaRepartida)}
                                    {(conPapel || esOtro) && totalPago > 0 && ` de ${formatMoney(totalPago)}`}
                                </span>
                            </div>

                            {(conPapel || esOtro) && totalPago > 0 && !cuadra && (
                                /* La suma tiene que dar EXACTO. Aceptar menos
                                   dejaría una diferencia sin dueño: el banco
                                   movió $50 y el portal explicaría $45. */
                                <Notice variant="warning">
                                    {sumaRepartida < totalPago
                                        ? `Faltan ${formatMoney(totalPago - sumaRepartida)} por aplicar.`
                                        : `Sobran ${formatMoney(sumaRepartida - totalPago)} sobre el comprobante.`}
                                </Notice>
                            )}
                        </div>

                        {forma === 'Efectivo' && (
                            <Notice variant="info">
                                El efectivo entra al cajón y cuenta para el corte del día.
                            </Notice>
                        )}
                    </>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button variant="primary" disabled={ocupado || !listo} onClick={cobrar}>
                        Cobrar
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}

/** Todo lo que el cliente debe en esa sala. Es contra esto que se compara el
 *  monto del papel: contra el saldo de UN crédito, una transferencia que paga
 *  tres se rechazaría — que es justo el caso que hay que soportar. */
function sumaDeSaldos(hermanos, credito) {
    const lista = hermanos?.length ? hermanos : [credito];
    return lista.reduce((t, h) => t + (Number(h.saldo) || 0), 0);
}


/**
 * Pedir que se anule o se corrija un abono ya cobrado.
 *
 * Quien cobró NO lo deshace. «Si se quiere editar un abono, no permite; que sea
 * como solicitud a supervisor» (usuario, 2-sep). Y corregir se aplica BORRANDO
 * el abono y volviéndolo a hacer, que es lo único que el sistema de la caja
 * permite: su panel abona y borra, no edita.
 */
function PedirCorreccion({ credito, abono, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [que, setQue] = useState('ANULAR');
    const [montoNuevo, setMontoNuevo] = useState(String(abono.monto ?? ''));
    const [formaNueva, setFormaNueva] = useState(abono.forma || 'Efectivo');
    const [documento, setDocumento] = useState(abono.documento || '');
    const [motivo, setMotivo] = useState('');
    const [ocupado, setOcupado] = useState(false);

    // El comprobante, cuando lo que cambia es la forma de pago: es el mismo
    // modal de foto y reconocimiento del cobro, por pedido del usuario.
    const [archivo, setArchivo] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [lectura, setLectura] = useState(null);
    const conPapel = que === 'FORMA' && formaNueva !== 'Efectivo';

    const leer = useCallback(async (f) => {
        setArchivo(f); setLectura(null);
        if (!f) return;
        setLeyendo(true);
        const r = await leerPagoDeCredito(f, { forma: formaNueva, saldo: Number(abono.monto) || 0 });
        setLeyendo(false);
        if (r?.error) { showToast('No se pudo leer', mensajeAmigable(r.error), 'warning'); return; }
        setLectura(r);
        if (r.sugerido?.documento) setDocumento(String(r.sugerido.documento));
    }, [formaNueva, abono.monto, showToast]);

    const bloqueado = lectura && lectura.veredicto !== 'OK';
    const valido = motivo.trim().length >= 5 && !bloqueado
        && (que !== 'MONTO' || Number(montoNuevo) > 0)
        && (!conPapel || (archivo && lectura));

    const pedir = useCallback(async () => {
        setOcupado(true);
        const r = await pedirCorreccionDeAbono({
            sala: credito.branch_id, credito: credito.credito,
            abonoErp: abono.erp_id_borrable, que, motivo: motivo.trim(),
            montoActual: Number(abono.monto), montoNuevo: Number(montoNuevo),
            formaActual: abono.forma, formaNueva,
            documentoNuevo: documento || null,
            fechaDocumento: lectura?.sugerido?.fecha || null,
            pos: lectura?.sugerido?.pos || null,
            lectura: lectura || null,
            cliente: credito.cliente,
        });
        setOcupado(false);
        if (r?.error || r?.ok === false) {
            showToast('No se pudo pedir', mensajeAmigable(r.error || r), 'error');
            return;
        }
        showToast('Solicitud enviada', 'La decide quien tenga el permiso de cuentas por cobrar.', 'success');
        onListo?.();
    }, [credito, abono, que, motivo, montoNuevo, formaNueva, documento, lectura, showToast, onListo]);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Pedir una corrección">
            <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
                <div>
                    <h3 className="text-h3 font-bold text-content">Pedir una corrección</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {formatMoney(abono.monto)} · {abono.forma} · {fechaCorta(abono.fecha)}
                    </p>
                </div>

                {/* Se dice ANTES de elegir: corregir no es un UPDATE allá, y
                    quien pide tiene que saber qué va a pasar de verdad. */}
                <Notice variant="info">
                    Corregir un abono se aplica <strong>borrándolo y volviéndolo a hacer</strong> —
                    es lo único que el sistema de la caja permite—, así que en su historial van a
                    quedar los dos renglones.
                </Notice>

                <LiquidSelect label="Qué hay que hacer" value={que} onChange={(v) => setQue(v || 'ANULAR')}
                    clearable={false}
                    options={[
                        { value: 'ANULAR', label: 'Anularlo: no debió cobrarse' },
                        { value: 'MONTO',  label: 'Corregir el monto' },
                        { value: 'FORMA',  label: 'Corregir la forma de pago' },
                    ]} />

                {que === 'MONTO' && (
                    <PortalInput label="Monto correcto" inputMode="decimal" value={montoNuevo}
                        onChange={(e) => setMontoNuevo(e.target.value)} />
                )}

                {que === 'FORMA' && (
                    <>
                        <LiquidSelect label="Forma correcta" value={formaNueva}
                            onChange={(v) => { setFormaNueva(v || 'Efectivo'); setArchivo(null); setLectura(null); }}
                            options={FORMAS.map((f) => ({ value: f, label: f }))} clearable={false} />
                        {conPapel && (
                            <>
                                <FileField label="Foto del comprobante" accept="image/*" value={archivo}
                                    onChange={leer} onClear={() => leer(null)} />
                                {leyendo && <LoadingState label="Leyendo el comprobante" />}
                                {bloqueado && (
                                    <Notice variant="danger" icon={AlertTriangle}>
                                        {MOTIVO_DEL_FRENO[lectura.veredicto]
                                            || 'El comprobante no se pudo dar por bueno.'}
                                    </Notice>
                                )}
                                <PortalInput label="Número del comprobante" value={documento} maxLength={40}
                                    onChange={(e) => setDocumento(e.target.value)} />
                            </>
                        )}
                    </>
                )}

                <PortalTextarea label="Por qué" value={motivo} rows={3}
                    placeholder="Qué pasó, en una frase"
                    onChange={(e) => setMotivo(e.target.value)} />

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button variant="primary" disabled={ocupado || !valido} onClick={pedir}>
                        Pedir
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}
