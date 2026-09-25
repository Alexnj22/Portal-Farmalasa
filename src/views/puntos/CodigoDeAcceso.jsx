/**
 * El código de acceso a «Mis puntos».
 *
 * Vivía en la ficha del cliente (FormClienteDetail) y se mudó a la vista
 * «Puntos» el 2026-09-25, con todo lo demás de puntos: el usuario pidió que la
 * ficha deje de mostrar puntos y que la vista los muestre enteros. El código se
 * mueve tal cual —sus reglas de quién ve la llave y a dónde sale el papel son
 * las mismas—; sólo cambian los imports.
 */
import React, { useState, useEffect } from 'react';
import { KeyRound, Eye, Printer, RefreshCw } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import ElegirSalaDeImpresion from '../../components/personal/ElegirSalaDeImpresion';
import { fetchSalasConCaja } from '../../data/impresion';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { estadoCodigoAcceso, verCodigoAcceso, emitirCodigoAcceso, salaDeHoy } from '../../data/puntos';
import { fechaTexto } from '../../utils/fecha';

/**
 * El código de acceso a «Mis puntos», en la ficha.
 *
 * ── Por qué el código NO se muestra al abrir ────────────────────────────────
 * Porque es una llave: quien la ve puede consultar el saldo de esa persona. Se
 * muestra que EXISTE y desde cuándo —eso no compromete nada— y verlo es un
 * botón aparte que queda anotado en la bitácora con quién y cuándo. Sin esa
 * separación, abrir cualquier ficha registraría que alguien miró la llave, y la
 * bitácora dejaría de distinguir al que la consultó del que sólo pasó por ahí.
 *
 * ── Se puede emitir para CUALQUIER cliente ─────────────────────────────────
 * No sólo para extranjeros. Lo que depende de la categoría es otra cosa: si el
 * código alcanza SOLO, sin teléfono. Para una ficha extranjera sí —su teléfono
 * no sirve de llave porque el circuito de Hacienda se lo reemplaza por el de la
 * farmacia—; para el resto va acompañado del teléfono, y eso es lo que permite
 * que el código sea de siete caracteres y no de una docena.
 */
export default function CodigoDeAcceso({ customerId, nombre, puedeEditar }) {
    // `showToast(titulo, mensaje, tipo)` — así lo expone el store, y así lo usa
    // el resto de este archivo. `addToast` no existe.
    const aviso = (titulo, mensaje, tipo) =>
        useToastStore.getState().showToast(titulo, mensaje, tipo);
    const { user, getScope } = useAuth();
    const branches = useStaff(s => s.branches) || [];
    const [estado, setEstado] = useState(null);
    const [codigo, setCodigo] = useState(null);
    const [ocupado, setOcupado] = useState(false);
    // ¿En qué sala se imprime? Se PREGUNTA, no se deduce de la ficha de quien
    // aprieta: medido el 2026-09-01, las 48 personas activas tienen sucursal
    // asignada, así que «el empleado sin sucursal» no existe y esa condición
    // nunca dispararía. Lo que sí pasa es que alguien de supervisión atienda
    // desde el mostrador de OTRA sala —o desde su casa—, y ahí su sucursal
    // asignada es justo el destino equivocado: el papel saldría lejos del
    // cliente que lo está esperando.
    const [preguntando, setPreguntando] = useState(false);
    const [salas, setSalas] = useState([]);
    const [cargandoSalas, setCargandoSalas] = useState(false);
    const [falloSalas, setFalloSalas] = useState(false);

    useEffect(() => {
        let vivo = true;
        estadoCodigoAcceso(customerId)
            .then(e => { if (vivo) setEstado(e); })
            .catch(() => { if (vivo) setEstado({ tiene: false }); });
        return () => { vivo = false; };
    }, [customerId]);

    const conError = (accion) => async (fn) => {
        setOcupado(true);
        try { await fn(); } catch (e) {
            aviso('No se pudo',
                e?.message === 'FORBIDDEN'
                    ? `No tienes permiso para ${accion}.`
                    : `No se pudo ${accion}. ${e?.message ?? 'Intenta de nuevo.'}`,
                'error');
        } finally { setOcupado(false); }
    };

    const ver = () => conError('ver el código')(async () => {
        setCodigo(await verCodigoAcceso(customerId));
    });

    const emitir = () => conError('generar el código')(async () => {
        const r = await emitirCodigoAcceso(customerId);
        setCodigo(r?.codigo ?? null);
        setEstado(await estadoCodigoAcceso(customerId));
        aviso(r?.veces_emitido > 1 ? 'Código nuevo' : 'Código generado',
            r?.veces_emitido > 1
                ? 'El anterior dejó de servir en este momento.'
                : 'Ya se puede imprimir y entregar.',
            'success');
    });

    // El import es diferido: la ticketera y su maquetación pesan, y esta ficha
    // se abre muchas más veces de las que alguien imprime un papel.
    const imprimir = ({ salaId }) => () => conError('imprimir el papel')(async () => {
        setPreguntando(false);
        const valor = codigo ?? await verCodigoAcceso(customerId);
        if (!valor) { aviso('Sin código', 'Este cliente todavía no tiene uno. Genéralo primero.', 'error'); return; }
        const { imprimirTicketDeCodigo } = await import('../../utils/puntosCodigoTicket');
        await imprimirTicketDeCodigo(
            { nombre, codigo: valor, emitidoPor: user?.name || user?.email || '' },
            { sala: salaId },
        );
    });

    // ── A dónde sale el papel ─────────────────────────────────────────────
    // Sin diálogo para quien atiende (decisión del usuario, 2026-09-01): un paso
    // de más en cada impresión se paga todos los días.
    //
    //   1. ¿Se mueve entre salas, o no tiene sucursal? → que ELIJA
    //   2. Si no, la cola de su sucursal, directo
    //   3. Si su caja no está disponible → el diálogo igual
    //
    // ── Quién «se mueve entre salas» sale del ALCANCE, no del cargo ─────────
    // `getScope('ventas')`: los tres cargos de sala —dependiente, jefe/a de
    // sala, regente— lo tienen en `BRANCH`, y supervisión y gerencia en `ALL`.
    // O sea que la persona que anda por varias salas ya está marcada como tal en
    // los permisos, y no hay que mantener una lista de cargos que se
    // desactualiza sola.
    //
    // Se mira `ventas` y NO `clientes` a propósito: `clientes` está en `ALL`
    // para todo el mundo —un cliente no pertenece a una sala— así que ahí el
    // alcance no distingue a nadie. Medido antes de elegirlo.
    const alImprimir = () => conError('leer las cajas de impresión')(async () => {
        const andaPorVariasSalas = getScope('ventas') === 'ALL';
        // La sala se pregunta a la BASE, no se lee de la sesión: hoy contesta la
        // de la ficha, y el día que los horarios digan la del día contesta ésa
        // —quien va de apoyo imprime donde está— sin tocar esta pantalla. Si la
        // consulta falla se cae a la de la sesión, que es lo que había antes.
        let miSala = null;
        try { miSala = await salaDeHoy(); } catch { miSala = user?.branchId ?? null; }
        if (miSala == null) miSala = user?.branchId ?? null;

        if (!andaPorVariasSalas && miSala != null) {
            await imprimir({ salaId: Number(miSala) })();
            const nombre = branches.find(b => String(b.id) === String(miSala))?.name || 'tu sala';
            aviso('Enviado a imprimir', `El papel sale por la ticketera de ${nombre}.`, 'success');
            return;
        }

        // Se mueve entre salas, o no tiene una: hay que preguntar. La lista se
        // lee EN EL CLIC y no en un efecto — una caja se apaga en cualquier
        // momento, así que lo que se ofrece es de ese instante.
        setCargandoSalas(true);
        let lista = [];
        let fallo = false;
        try {
            const r = await fetchSalasConCaja();
            lista = r?.salas ?? [];
            fallo = !!r?.error;
        } catch { fallo = true; } finally { setCargandoSalas(false); }

        setSalas(lista);
        setFalloSalas(fallo);
        setPreguntando(true);
    });

    const legible = codigo
        ? `${codigo.slice(0, 3)} - ${codigo.slice(3)}`
        : null;

    return (
        <div data-surface="card" className="p-4 space-y-3">
            <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-content-2" aria-hidden="true" />
                <span className="text-caption">Código de acceso</span>
                {estado?.tiene
                    ? <Badge size="sm" variant="success">Emitido</Badge>
                    : <Badge size="sm" variant="neutral">Sin código</Badge>}
            </div>

            {/* Ya no se distingue la ficha extranjera: el código entra SOLO en
                todas. Distinguirla obligaba a explicar dos reglas a quien
                atiende, y la que sobraba era la del teléfono — ver la migración
                `20260903164641_puntos_el_codigo_entra_solo`. */}
            <p className="text-sm text-content-2">
                El cliente entra a Mis puntos con este código, sin ningún otro dato.
                Sirve cuando no tiene su documento a mano.
            </p>

            {legible && (
                <p className="text-center font-mono text-2xl tracking-[0.2em] py-2">{legible}</p>
            )}

            {estado?.tiene && !legible && (
                <p className="text-xs text-content-3">
                    Emitido el {fechaTexto(estado.emitido_at)}
                    {estado.veces_emitido > 1 && ` · ${estado.veces_emitido} veces`}
                </p>
            )}

            <div className="flex flex-wrap gap-2">
                {estado?.tiene && !legible && (
                    <Button size="sm" variant="secondary" icon={Eye} onClick={ver} disabled={ocupado}>
                        Ver el código
                    </Button>
                )}
                {puedeEditar && (
                    <Button size="sm" variant={estado?.tiene ? 'ghost' : 'primary'}
                        icon={estado?.tiene ? RefreshCw : KeyRound}
                        onClick={emitir} disabled={ocupado}>
                        {estado?.tiene ? 'Generar uno nuevo' : 'Generar código'}
                    </Button>
                )}
                {estado?.tiene && (
                    <Button size="sm" variant="secondary" icon={Printer}
                        onClick={alImprimir} disabled={ocupado || cargandoSalas}>
                        Imprimir
                    </Button>
                )}
            </div>

            {estado?.tiene && (
                <p className="text-xs text-content-3">
                    Ver el código queda registrado. Generar uno nuevo deja el anterior sin efecto.
                </p>
            )}

            <ElegirSalaDeImpresion
                open={preguntando}
                onClose={() => setPreguntando(false)}
                onElegir={(elec) => imprimir(elec)()}
                salas={salas}
                cargando={cargandoSalas}
                fallo={falloSalas}
                titulo="Imprimir el código de acceso" />
        </div>
    );
}
