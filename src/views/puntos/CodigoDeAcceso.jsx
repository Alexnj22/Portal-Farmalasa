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
import { KeyRound, Eye, Printer, RefreshCw, Copy, MessageCircle } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import ElegirSalaDeImpresion from '../../components/personal/ElegirSalaDeImpresion';
import { fetchSalasConCaja } from '@nucleo/data/impresion';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { mensajeDelCodigo, telefonoParaWhatsapp } from '@nucleo/utils/codigoDePuntos';
import { estadoCodigoAcceso, verCodigoAcceso, emitirCodigoAcceso, salaDeHoy } from '@nucleo/data/puntos';
import { fechaTexto } from '@nucleo/utils/fecha';

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
export default function CodigoDeAcceso({ customerId, nombre, telefono, puedeEditar }) {
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
        const { imprimirTicketDeCodigo } = await import('@nucleo/utils/puntosCodigoTicket');
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

    // ── Copiar y mandar por WhatsApp (rediseño del 2026-09-28) ────────────
    // Lo práctico en el mostrador no es dictar siete letras: es mandárselas al
    // teléfono del cliente con el enlace que ya abre su saldo. El enlace lleva
    // el código adentro (`/mis-puntos?codigo=…`), igual que el QR del papel.
    // Pedir el código para copiarlo o mandarlo pasa por `verCodigoAcceso`, así
    // que también queda en la bitácora.
    const valorParaUsar = async () => codigo ?? (await verCodigoAcceso(customerId));

    const copiar = () => conError('copiar el código')(async () => {
        const valor = await valorParaUsar();
        if (!valor) return;
        setCodigo(valor);
        await navigator.clipboard.writeText(valor);
        aviso('Copiado', 'El código está en el portapapeles.', 'success');
    });

    const telWhatsapp = telefonoParaWhatsapp(telefono);
    const whatsapp = () => {
        // La ventana se abre EN el clic, antes de cualquier espera: si se abre
        // después de un `await`, el navegador la trata como ventana emergente y
        // la bloquea. Se abre vacía y se le pone la dirección cuando llega el
        // código.
        // Sin 'noopener' en el tercer argumento: con él `window.open` devuelve
        // null y no habría ventana a la que ponerle la dirección. El vínculo
        // con esta pestaña se corta a mano.
        const ventana = window.open('', '_blank');
        if (ventana) ventana.opener = null;
        conError('preparar el mensaje')(async () => {
            const valor = await valorParaUsar();
            if (!valor) { ventana?.close(); return; }
            setCodigo(valor);
            const enlace = `${window.location.origin}/mis-puntos?codigo=${valor}`;
            const texto = mensajeDelCodigo({ nombre, codigo: valor, enlace });
            const url = `https://wa.me/${telWhatsapp}?text=${encodeURIComponent(texto)}`;
            // Si el navegador bloqueó la ventana, se avisa en vez de sacar a
            // la persona del portal.
            if (ventana) ventana.location.href = url;
            else aviso('No se abrió WhatsApp', 'El navegador bloqueó la ventana. Permite las ventanas de este sitio e intenta de nuevo.', 'error');
        });
    };

    const tiene = !!estado?.tiene;
    // Las casillas: el código de verdad, o puntos mientras no se pidió verlo.
    const casillas = (codigo ?? '•••••••').split('');

    return (
        <div data-surface="card" className="p-4 sm:p-5 flex flex-col gap-4 min-w-0">
            <div className="flex items-start gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand-text flex items-center justify-center shrink-0">
                    <KeyRound size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-body-sm font-black text-content">Acceso a Mis puntos</h3>
                        {tiene
                            ? <Badge size="sm" variant="success">Activo</Badge>
                            : <Badge size="sm" variant="neutral">Sin código</Badge>}
                    </div>
                    {/* Ya no se distingue la ficha extranjera: el código entra SOLO
                        en todas — ver `20260903164641_puntos_el_codigo_entra_solo`. */}
                    <p className="text-caption text-content-3 mt-0.5">
                        {tiene
                            ? <>Con este código el cliente ve su saldo en su teléfono, sin otro dato. Emitido el {fechaTexto(estado.emitido_at)}{estado.veces_emitido > 1 ? ` · ${estado.veces_emitido} veces` : ''}.</>
                            : 'Sirve para que el cliente vea su saldo en su teléfono cuando no tiene su documento a mano.'}
                    </p>
                </div>
            </div>

            {tiene && (
                <div className="flex items-center justify-center gap-1.5" aria-label={codigo ? `Código ${codigo}` : 'Código oculto'}>
                    {casillas.map((c, i) => (
                        <React.Fragment key={i}>
                            {i === 3 && <span className="w-2 h-0.5 rounded-full bg-content-3 mx-0.5" aria-hidden="true" />}
                            <span className={`w-9 h-11 sm:w-10 sm:h-12 rounded-btn border border-border-card bg-surface-card-hover
                                              flex items-center justify-center font-mono font-black text-title
                                              ${codigo ? 'text-content' : 'text-content-3'}`}>
                                {c}
                            </span>
                        </React.Fragment>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {tiene && !codigo && (
                    <Button size="sm" variant="secondary" icon={Eye} onClick={ver} disabled={ocupado}>
                        Ver
                    </Button>
                )}
                {tiene && (
                    <Button size="sm" variant="secondary" icon={Copy} onClick={copiar} disabled={ocupado}>
                        Copiar
                    </Button>
                )}
                {tiene && telWhatsapp && (
                    <Button size="sm" variant="secondary" icon={MessageCircle} onClick={whatsapp} disabled={ocupado}>
                        Enviar por WhatsApp
                    </Button>
                )}
                {tiene && (
                    <Button size="sm" variant="secondary" icon={Printer}
                        onClick={alImprimir} disabled={ocupado || cargandoSalas}>
                        Imprimir
                    </Button>
                )}
                {puedeEditar && (
                    <Button size="sm" variant={tiene ? 'ghost' : 'primary'}
                        icon={tiene ? RefreshCw : KeyRound}
                        onClick={emitir} disabled={ocupado}>
                        {tiene ? 'Generar uno nuevo' : 'Generar código'}
                    </Button>
                )}
            </div>

            {tiene && (
                <p className="text-caption text-content-3">
                    Ver, copiar o enviar el código queda registrado. Generar uno nuevo deja el anterior sin efecto.
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
