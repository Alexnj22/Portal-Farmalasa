import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Trash2, User } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import BuscadorDeProducto from '../common/BuscadorDeProducto';
import { clearDraft, loadDraft, saveDraft } from '../../utils/draftUtils';
import { unaSolaVez } from '../../utils/unaSolaVez';
import { formatMoney } from '../../utils/formatNumber';
import { DIAS_DE_RESERVA, POLITICA_DE_RESERVA, vencimientoDeReserva } from '../../utils/abonoTicket';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';

/**
 * El abono de un cliente para apartar un producto.
 *
 * ── Por qué es su propio diálogo y no un campo más del ingreso ─────────────
 * El resto de los ingresos se anotan con tres datos: cuánto, de qué y la
 * boleta. Éste levanta un compromiso —un producto apartado, un plazo, un saldo
 * pendiente— y sale un papel que el cliente se lleva. Pedir todo eso dentro del
 * formulario corto lo volvería largo para los otros seis tipos, que son el 95%
 * de las veces.
 *
 * ── El precio se escribe, no se busca ─────────────────────────────────────
 * El buscador del catálogo devuelve nombre e id, no precio — y aunque lo
 * devolviera, el que rige es el que la sala le está cotizando al cliente en ese
 * momento. Es el que va impreso y el que queda fijo por el plazo (cláusula 4),
 * así que tiene que ser el que alguien escribió a sabiendas, no uno que el
 * formulario puso solo.
 *
 * ── «Por definir» es un ESTADO, no un campo vacío ─────────────────────────
 * Un encargo que todavía no se cotiza no tiene precio pactado. Dejarlo sin
 * precio es la respuesta correcta, y el papel entonces no imprime monto en ese
 * renglón ni promete un saldo. Poner un número tentativo lo convierte en
 * pactado: el cliente vuelve con el papel en la mano y ese número es el que va
 * a exigir.
 */

/** Un renglón nuevo, vacío. `precio: ''` es «por definir» hasta que se escriba. */
const renglonNuevo = () => ({
    clave: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    erp_product_id: null, nombre: '', presentacion: '', cantidad: '1', precio: '',
});

/* El borrador se guarda POR SALA.
 *
 * La sesión de sala se cierra sola a los cinco minutos, y este formulario tiene
 * siete campos de captura: el nombre, el teléfono y una fila por producto con
 * su cantidad, presentación y precio. Perderlo con el cliente parado enfrente
 * es lo que hace que la próxima vez se anote en un papel y no en el portal.
 *
 * Por sala y no una sola clave: dos salas en el mismo equipo —administración
 * mirando dos cajas— se pisarían el borrador. */
const claveDeBorrador = (sala) => `abono_cliente_${sala ?? 'sin-sala'}`;

export default function DialogoAbono({ abierto, ocupado, sala, onClose, onGuardar }) {
    const guardado = abierto ? loadDraft(claveDeBorrador(sala)) : null;
    const [cliente, setCliente] = useState(() => guardado?.cliente ?? '');
    const [telefono, setTelefono] = useState(() => guardado?.telefono ?? '');
    const [renglones, setRenglones] = useState(
        () => (guardado?.renglones?.length ? guardado.renglones : [renglonNuevo()]),
    );
    const [abonado, setAbonado] = useState(() => guardado?.abonado ?? '');
    const [buscando, setBuscando] = useState(null);   // clave del renglón que busca
    const [verPolitica, setVerPolitica] = useState(false);

    const cambiar = useCallback((clave, campo, valor) => {
        setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, [campo]: valor } : r)));
    }, []);

    const quitar = useCallback((clave) => {
        // Nunca se queda en cero: un abono sin renglones no dice qué se apartó,
        // y el formulario sin ninguna fila no tiene por dónde empezar de nuevo.
        setRenglones((rs) => (rs.length > 1 ? rs.filter((r) => r.clave !== clave) : rs));
    }, []);

    const elegirDelCatalogo = useCallback((clave, p) => {
        setRenglones((rs) => rs.map((r) => (r.clave === clave
            ? { ...r, erp_product_id: p.id, nombre: p.nombre || '' }
            : r)));
        setBuscando(null);
    }, []);

    /* El total, y CUÁNDO no se puede decir.
     *
     * Basta UN renglón sin precio para que el total no exista: sumar los que sí
     * tienen daría una cifra que parece el total y no lo es, y esa es la que el
     * cliente leería en el papel. `null` es la respuesta honesta y es lo que
     * imprime «Por definir». */
    const total = useMemo(() => {
        if (!renglones.length) return null;
        let suma = 0;
        for (const r of renglones) {
            const p = String(r.precio ?? '').trim();
            if (p === '') return null;
            const n = Number(p) * (Number(r.cantidad) || 0);
            if (!Number.isFinite(n)) return null;
            suma += n;
        }
        return suma;
    }, [renglones]);

    const monto = Number(abonado);
    const saldo = total == null ? null : Math.max(0, total - (Number.isFinite(monto) ? monto : 0));

    const conNombre = renglones.filter((r) => String(r.nombre ?? '').trim().length > 1);
    // El abono mayor que el total sería un saldo negativo impreso en un
    // comprobante que el cliente se lleva. Se frena acá y en el servidor.
    const excede = total != null && Number.isFinite(monto) && monto > total;
    const valido = cliente.trim().length >= 3
        && conNombre.length > 0
        && Number.isFinite(monto) && monto > 0
        && !excede;

    /* El día se calcula UNA vez, al abrir, y no en cada render: el reloj no es
     * una función pura, y con el diálogo abierto pasada la medianoche el
     * vencimiento cambiaría solo entre el momento en que se lee y el momento en
     * que se aprieta «Anotar». El papel diría un día y la base otro.
     *
     * Y es la hora de EL SALVADOR (−6), no la del equipo: el plazo lo cuenta el
     * día de la sala. */
    const [vence] = useState(() => vencimientoDeReserva(
        new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10),
    ));

    /* Se guarda con cada tecla, no al cerrar: la sesión no se cierra por un
     * botón, se cierra sola — y un guardado «al salir» nunca corre cuando lo
     * que se lleva el trabajo es el temporizador. */
    useEffect(() => {
        if (!abierto) return;
        saveDraft(claveDeBorrador(sala), { cliente, telefono, renglones, abonado });
    }, [abierto, sala, cliente, telefono, renglones, abonado]);

    /* Para que el botón DIGA que está trabajando, no sólo que no se puede
     * tocar. El cerrojo real es `unaSolaVez`, de abajo; esto es lo que ve la
     * persona que está esperando con el cliente enfrente. */
    const [enviando, setEnviando] = useState(false);

    /* La clave de ESTE envío, una sola para todos sus reintentos. El diálogo se
     * monta en cada apertura, así que un ref inicializado una vez ya da una por
     * apertura — y el servidor contesta con el movimiento que ya escribió si la
     * misma clave vuelve a llegar. Ver `operar-caja` y `utils/unaSolaVez`. */
    const claveDeEnvio = useRef(null);
    if (claveDeEnvio.current === null) {
        claveDeEnvio.current = globalThis.crypto?.randomUUID?.()
            ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    /* El cuerpo vive en un ref para que el cerrojo sea UNO SOLO durante toda la
     * vida del diálogo: envolver una función nueva en cada render daría un
     * cerrojo nuevo por render, o sea ninguno. */
    const cuerpoDeGuardar = useRef(null);
    cuerpoDeGuardar.current = async () => {
        setEnviando(true);
        try {
            // El borrador se borra ANTES de mandar: si el envío falla, el
            // formulario sigue en pantalla con todo puesto, así que no hay nada
            // que recuperar. Dejarlo haría que el próximo abono empiece con los
            // datos del anterior.
            clearDraft(claveDeBorrador(sala));
            return await enviar();
        } catch (e) {
            /* Un `try/finally` sin `catch` acá NO era el bug clásico del
             * spinner que se apaga callado: un abono que falla se avisa igual,
             * porque `operar()` convierte todo tropiezo en `{ error }` y quien
             * llama lo muestra.
             *
             * Lo que sí se caía en silencio es lo ÚLTIMO que hace el guardado:
             * imprimir el comprobante. `imprimirDocumento` no tiene `catch` de
             * primer nivel y hace un `import()` dinámico para hablarle a la
             * cola de la caja — o sea que un chunk que no carga (lo normal
             * después de publicar una versión) lanza. Ese throw subía por acá,
             * salía de `unaSolaVez` y moría como promesa rechazada en el
             * `onClick`, sin un toast.
             *
             * Y el momento es el peor posible: la pantalla ya dijo «Abono
             * anotado · el comprobante va a la impresora». El abono está a
             * salvo —lo escribió el servidor— pero no sale papel y nadie se
             * entera hasta que el cliente lo pide.
             *
             * Se avisa y NO se relanza: el abono ya ocurrió, así que volver a
             * apretar no corresponde. */
            console.error('guardar abono:', e);
            useToastStore.getState().showToast(
                'El abono quedó anotado, pero algo falló después',
                mensajeAmigable(e, 'Revisa si salió el comprobante; si no, vuelve a imprimirlo desde la lista.'),
                'warning',
            );
        } finally {
            // Se suelta siempre: si sólo se soltara al salir bien, un fallo de
            // red dejaría el botón muerto con el formulario lleno.
            setEnviando(false);
        }
    };

    /* Dos toques seguidos anotan UN abono. El botón se apaga con `ocupado`, que
     * lo enciende el padre — o sea un render después—, así que entre el primer
     * toque y el apagado hay una ventana real. Es el mismo defecto que dejó 13
     * movimientos de caja duplicados en septiembre; ver `utils/unaSolaVez`. */
    const guardar = useMemo(() => unaSolaVez((...a) => cuerpoDeGuardar.current(...a)), []);

    const enviar = () => onGuardar({
        /* La clave de ESTE envío, una sola para todos sus reintentos. El
         * cerrojo de arriba cubre el doble toque; esto cubre lo que el
         * navegador no ve —dos pestañas, un reintento de red— porque el
         * servidor contesta con el movimiento que ya escribió. El diálogo se
         * monta en cada apertura, así que cada una trae la suya. */
        clave: claveDeEnvio.current,
        cliente_nombre: cliente.trim(),
        cliente_telefono: telefono.trim() || null,
        monto,
        total,
        vence_el: vence,
        renglones: conNombre.map((r) => ({
            erp_product_id: r.erp_product_id,
            nombre: String(r.nombre).trim(),
            presentacion: String(r.presentacion ?? '').trim() || null,
            cantidad: Number(r.cantidad) || 1,
            // `null` y no `0`: es «por definir», y un cero es un precio.
            precio: String(r.precio ?? '').trim() === '' ? null : Number(r.precio),
        })),
    });

    if (!abierto) return null;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Abono para apartar producto">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Abono para apartar producto</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        El dinero entra a la caja y sale un comprobante para el cliente.
                        Vale hasta el <b className="text-content">{vence}</b> ({DIAS_DE_RESERVA} días).
                    </p>
                </div>

                <div className="space-y-3">
                    <PortalInput label="Nombre del cliente" value={cliente} maxLength={60} icon={User}
                        onChange={(e) => setCliente(e.target.value)} placeholder="como aparece en su documento" />
                    {/* El teléfono va impreso porque es con lo que la sala avisa
                        cuando el encargo llega. Sin él, el comprobante sirve para
                        reclamar pero no para avisar. */}
                    <PortalInput label="Teléfono" value={telefono} inputMode="tel" maxLength={20}
                        onChange={(e) => setTelefono(e.target.value)} placeholder="7712-4408" />
                </div>

                <div className="space-y-2">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                        Qué se aparta
                    </h4>

                    {renglones.map((r) => (
                        <div key={r.clave} data-surface="card" className="rounded-xl p-3 space-y-2">
                            {buscando === r.clave ? (
                                <>
                                    <BuscadorDeProducto
                                        placeholder="Buscar en el catálogo…"
                                        invitacion={{ icono: Search, texto: 'Escribe el nombre del producto' }}
                                        onElegir={(p) => elegirDelCatalogo(r.clave, p)} />
                                    <button type="button" onClick={() => setBuscando(null)}
                                        className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                                        Cancelar la búsqueda
                                    </button>
                                </>
                            ) : (
                                <>
                                    <PortalInput label="Producto" value={r.nombre} maxLength={60}
                                        onChange={(e) => cambiar(r.clave, 'nombre', e.target.value)}
                                        placeholder="escríbelo o búscalo en el catálogo" />
                                    {/* El buscador es OPCIONAL a propósito: el
                                        encargo que todavía no existe como
                                        producto se escribe a mano, y ése es
                                        justamente el caso que trajo esta
                                        pantalla. */}
                                    <button type="button" onClick={() => setBuscando(r.clave)}
                                        className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                                        {r.erp_product_id ? 'Buscar otro en el catálogo' : 'Buscarlo en el catálogo'}
                                    </button>

                                    <div className="grid grid-cols-3 gap-2">
                                        <PortalInput label="Cant." inputMode="numeric" value={r.cantidad}
                                            onChange={(e) => cambiar(r.clave, 'cantidad', e.target.value)} />
                                        <PortalInput label="Presentación" value={r.presentacion} maxLength={30}
                                            onChange={(e) => cambiar(r.clave, 'presentacion', e.target.value)}
                                            placeholder="caja 30" />
                                        <PortalInput label="Precio c/u" inputMode="decimal" value={r.precio}
                                            onChange={(e) => cambiar(r.clave, 'precio', e.target.value)}
                                            placeholder="por definir" />
                                    </div>

                                    {renglones.length > 1 && (
                                        <button type="button" onClick={() => quitar(r.clave)}
                                            className="flex items-center gap-1.5 text-caption text-danger-text
                                                       min-h-[var(--tap-min)]">
                                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Quitar
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    ))}

                    <Button variant="secondary" size="sm" icon={Plus}
                        onClick={() => setRenglones((rs) => [...rs, renglonNuevo()])}>
                        Agregar otro producto
                    </Button>
                </div>

                <div className="space-y-2">
                    <PortalInput label="Cuánto abona" inputMode="decimal" value={abonado}
                        onChange={(e) => setAbonado(e.target.value)} placeholder="0.00" />

                    <div className="flex items-baseline justify-between gap-3 text-body-sm">
                        <span className="text-content-2">Total del producto</span>
                        <span className={`tabular-nums font-bold ${total == null ? 'text-warning-text' : 'text-content'}`}>
                            {total == null ? 'Por definir' : formatMoney(total)}
                        </span>
                    </div>
                    {saldo != null && (
                        <div className="flex items-baseline justify-between gap-3 text-body-sm">
                            <span className="text-content-2">Queda pendiente</span>
                            <span className="tabular-nums font-bold text-content">{formatMoney(saldo)}</span>
                        </div>
                    )}
                </div>

                {excede && (
                    <Notice variant="danger">
                        El abono no puede ser mayor que el total. Corrige el monto o el precio.
                    </Notice>
                )}

                {total == null && conNombre.length > 0 && (
                    <Notice variant="info">
                        Algún producto no tiene precio, así que el comprobante dirá
                        <b> «por definir»</b> y no promete un saldo. El precio se acuerda al
                        confirmarlo, y el cliente puede desistir con devolución completa.
                    </Notice>
                )}

                <div>
                    <button type="button" onClick={() => setVerPolitica((v) => !v)}
                        className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                        {verPolitica ? 'Ocultar las condiciones' : 'Ver las condiciones completas'}
                    </button>
                    {/* En el papel van cuatro; acá están las siete, para quien
                        tenga que contestarle al cliente en el mostrador. */}
                    {verPolitica && (
                        <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-caption text-content-2">
                            {POLITICA_DE_RESERVA.map((c) => <li key={c}>{c}</li>)}
                        </ol>
                    )}
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                    {/* `loading` y no sólo `disabled`: un botón gris y mudo se
                        lee como «no funcionó», y ahí es cuando alguien vuelve a
                        tocarlo. Ver `utils/unaSolaVez`. */}
                    <Button variant="primary" loading={enviando}
                        disabled={ocupado || !valido || !sala} onClick={guardar}>
                        {enviando ? 'Anotando…' : 'Anotar e imprimir'}
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}
