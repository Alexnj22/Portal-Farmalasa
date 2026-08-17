import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, HandCoins, Package } from 'lucide-react';
import Button from '../common/Button';
import FileField from '../common/FileField';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import PruebaDeIdentidad from './PruebaDeIdentidad';
import {
    fetchEntidadesDeSalida, fetchTiposDeSalida, probarIdentidad, registrarSalida, subirComprobante,
} from '../../data/bolsas';
import { disponibles, elegirBolsas, totalDisponible } from '../../utils/bolsasReparto';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';

/**
 * Sacar dinero de una bolsa — el «Entrega de remesas» que pidió el usuario.
 *
 * ── El portal elige la bolsa, no la persona ────────────────────────────────
 * Regla del usuario: **la más vieja que alcance sola**. Se muestra cuál eligió y
 * cuánto va a quedarle, porque el papel que va a entrar a esa bolsa dice
 * exactamente eso. Sólo combina cuando ninguna alcanza, y entonces lo avisa: dos
 * vales en dos bolsas no es lo mismo que uno. La cuenta vive en
 * `utils/bolsasReparto` para poder probarla.
 *
 * ── El formulario sale del CATÁLOGO ────────────────────────────────────────
 * Qué campos exige cada motivo son datos (`bolsas_tipos_salida`), no `if`s
 * escritos acá: una remesa pide remesadora, boleta y foto; un anticipo no pide
 * ninguno. Escrito a mano, un motivo nuevo aparecería en la base y no en la
 * pantalla.
 *
 * Y desde el 2026-08-17 **las opciones de ese campo también** salen de una tabla
 * (`bolsas_entidades`): las ocho remesadoras con las que trabaja la sala. Un
 * campo libre recibía la misma remesadora escrita de tres formas y después no
 * había con qué agruparlas. El motivo que no tiene lista —«Pago a proveedor»—
 * sigue siendo un campo libre: lo decide el catálogo, no un `if` acá.
 *
 * ── Quien retira el efectivo se IDENTIFICA, no se elige de una lista ───────
 * Decisión del usuario: «debe escribir el usuario y la contraseña, así nos
 * aseguramos que sí sea él». Elegir un nombre lo hace cualquiera que sepa
 * escribirlo. La comprobación es del SERVIDOR —el navegador diciendo «ya
 * verifiqué» no es una verificación— y la clave viaja sólo en esa llamada: no se
 * guarda en ninguna tabla ni queda en el estado más de lo que dura el envío.
 *
 * En una remesa no hay a quién identificar: quien recibe es el cliente y lo
 * identifica la boleta del POS.
 */

const hhmm = (hora) => String(hora || '').slice(0, 5);
// El mediodía en UTC y no la fecha pelada: `2026-08-15` interpretado como
// medianoche se corre un día para atrás con el huso de la sala.
const fechaCorta = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
}) : '');

export default function SalidaDeBolsa({ abierto, bolsas, saldos, onClose, onHecho }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);

    const [tipos, setTipos] = useState([]);
    const [entidades, setEntidades] = useState([]);
    const [tipo, setTipo] = useState('');
    const [monto, setMonto] = useState('');
    const [entidad, setEntidad] = useState('');
    const [boleta, setBoleta] = useState('');
    const [nota, setNota] = useState('');
    const [foto, setFoto] = useState(null);
    const [quien, setQuien] = useState('');
    const [metodo, setMetodo] = useState('CLAVE');
    const [secreto, setSecreto] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!abierto) return;
        // El motivo NO viene elegido de fábrica. Elegirlo por alguien mostraba
        // «Remesadora», «Número de boleta» y «Foto del comprobante» sobre una
        // decisión que nadie tomó —la más común no es la única—, y un motivo
        // preseleccionado se registra sin mirarlo. El panel se arma DESPUÉS de
        // la selección: hasta que no hay motivo, no hay campos de motivo.
        fetchTiposDeSalida().then(setTipos);
        fetchEntidadesDeSalida().then(setEntidades);

        // ── El motor de impresión se baja ANTES de escribir ─────────────────
        // Los dos papeles se arman con `import()` y eso los deja atados a un
        // chunk del servidor. Tras un despliegue, el chunk con el hash viejo ya
        // no existe: el `import()` falla, `main.jsx` recarga la página para
        // tomar el bundle nuevo, y la recarga pasa JUSTO DESPUÉS de registrar la
        // salida — el dinero queda escrito y ni el vale ni la etiqueta salen.
        // Pasó el 17-ago-2026 con la remesa REM-1000: el portal se recargó un
        // segundo después de escribir y la bolsa se quedó sin su vale adentro.
        // Bajarlo al ABRIR el diálogo no evita el chunk muerto —eso no se puede
        // desde acá—, lo adelanta a un momento en que recargar no cuesta nada.
        import('../../utils/ticketPrint').catch(() => {});
        import('../../utils/bolsaComprobante').catch(() => {});
    }, [abierto]);

    // Al cerrar se olvida TODO, y la clave la primera. Un secreto que sobrevive
    // al diálogo es un secreto que alguien puede volver a mandar sin saberlo.
    // El motivo también: si sobrevive, la próxima apertura muestra los campos de
    // la salida anterior y vuelve a ser una decisión que nadie tomó.
    useEffect(() => {
        if (abierto) return;
        setTipo(''); setMonto(''); setEntidad(''); setBoleta(''); setNota(''); setFoto(null);
        setQuien(''); setSecreto(''); setError(null);
    }, [abierto]);

    const t = useMemo(() => tipos.find((x) => x.codigo === tipo) || null, [tipos, tipo]);

    /** Las opciones del campo «entidad» de ESTE motivo. Vacío = campo libre. */
    const opciones = useMemo(
        () => entidades.filter((e) => e.tipo === tipo).map((e) => ({ value: e.nombre, label: e.nombre })),
        [entidades, tipo],
    );

    // Cambiar de motivo VACÍA la entidad. Sin esto, elegir «Remesa · RIA» y
    // corregir a «Pago a proveedor» dejaba a RIA escrita como proveedor: el
    // campo se llama igual en los dos, pero el dato no es el mismo. Va en el
    // manejador y no en un efecto sobre `tipo`: los dos cambian a la vez y son
    // la misma decisión de quien usa la pantalla.
    const elegirMotivo = useCallback((codigo) => { setTipo(codigo); setEntidad(''); }, []);

    const lista = useMemo(() => disponibles(bolsas, saldos), [bolsas, saldos]);
    const n = Number(String(monto).replace(',', '.'));
    const eleccion = useMemo(
        () => elegirBolsas(lista, Number.isFinite(n) ? n : 0),
        [lista, n],
    );

    const falta = useMemo(() => {
        if (!t) return 'Falta el motivo.';
        if (!Number.isFinite(n) || n <= 0) return 'Falta cuánto.';
        if (!eleccion.alcanza) {
            return `En la sala hay ${formatMoney(totalDisponible(lista))} en bolsas: no alcanza.`;
        }
        if (t.etiqueta_entidad && !entidad.trim()) return `Falta ${t.etiqueta_entidad.toLowerCase()}.`;
        if (t.pide_boleta && !boleta.trim()) return 'Falta el número de boleta.';
        if (t.pide_foto && !foto) return 'Falta la foto del comprobante.';
        if (t.pide_receptor && !quien) return 'Falta quién se lleva el efectivo.';
        if (t.pide_receptor && !secreto.trim()) {
            return metodo === 'CARNE' ? 'Falta escanear el carné.' : 'Falta la contraseña.';
        }
        return null;
    }, [t, n, eleccion, lista, entidad, boleta, foto, quien, secreto, metodo]);

    const guardar = useCallback(async () => {
        if (falta || guardando) return;
        setGuardando(true);
        setError(null);
        try {
            let fotoUrl = null;
            if (foto) {
                fotoUrl = await subirComprobante(foto, {
                    salaId: eleccion.repartos[0] && bolsas.find((b) => b.id === eleccion.repartos[0].bolsa_id)?.branch_id,
                    userId: user?.id,
                });
            }

            // Primero se prueba la identidad; recién si sale bien se escribe el
            // dinero. Son dos llamadas a propósito: la del secreto confirma
            // sola, así que un intento fallido queda registrado aunque lo que
            // sigue se aborte. Ver `probarIdentidad` en `data/bolsas.js`.
            //
            // «No coincide» llega como `motivo` y no como `error`: es un
            // RESULTADO de la comprobación, y tiene que serlo para que el
            // servidor pueda confirmar la transacción y dejar registrado el
            // intento. Un `error` acá es de red o de permisos.
            let vale = null;
            if (t.pide_receptor) {
                const r = await probarIdentidad({ employeeId: quien, metodo, secreto });
                setSecreto('');   // se olvida apenas se manda, salga bien o mal
                if (r.error) { setError(mensajeAmigable(r.error, 'Vuelve a intentar.')); return; }
                if (r.motivo) { setError(r.motivo); return; }
                vale = r.vale;
            }

            const { data, error: err } = await registrarSalida({
                tipo: t.codigo,
                monto: n,
                repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
                entidad, numeroBoleta: boleta, fotoUrl, nota,
                recibidoPor: t.pide_receptor ? quien : null,
                metodo: t.pide_receptor ? metodo : null,
                vale,
            });
            setSecreto('');
            if (err) { setError(mensajeAmigable(err, 'Vuelve a intentar en un momento.')); return; }

            showToast?.('Salida registrada', `${data.folio} · ${formatMoney(n)}`, 'success');
            onHecho?.(data, eleccion.repartos);
            onClose?.();
        } catch (e) {
            setSecreto('');
            setError(mensajeAmigable(e, 'No se pudo registrar.'));
        } finally {
            setGuardando(false);
        }
    }, [falta, guardando, foto, eleccion, bolsas, user, t, n, entidad, boleta, nota,
        quien, metodo, secreto, showToast, onHecho, onClose]);

    return (
        <LiquidModal open={!!abierto} onClose={guardando ? undefined : onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel="Sacar dinero de una bolsa">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Sacar dinero de una bolsa</h3>
                    <p className="text-caption text-content-3">
                        {lista.length
                            ? `${lista.length} ${lista.length === 1 ? 'bolsa' : 'bolsas'} en la sala · ${formatMoney(totalDisponible(lista))}`
                            : 'No hay bolsas con efectivo en la sala'}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {!lista.length && (
                    <Notice variant="info" icon={Package}>
                        <span className="font-bold">No hay de dónde sacar</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Las bolsas nacen al confirmar un corte. Si el efectivo ya se entregó,
                            el dinero para la remesa sale de la caja.
                        </span>
                    </Notice>
                )}

                {/* El motivo va PRIMERO porque gobierna el resto del panel:
                    de él dependen la remesadora, la boleta, la foto y si hay
                    que identificar a alguien. Leerlo después de rellenar
                    campos que él mismo decide es leerlo al revés. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                            Motivo
                        </span>
                        <LiquidSelect
                            value={tipo} onChange={elegirMotivo}
                            options={tipos.map((x) => ({ value: x.codigo, label: x.etiqueta }))}
                            placeholder="Elegir…" ariaLabel="Motivo de la salida"
                        />
                    </div>
                    <PortalInput
                        label="Cuánto" name="monto" type="number" inputMode="decimal"
                        step="0.01" min="0" icon={HandCoins}
                        value={monto} onChange={(e) => setMonto(e.target.value)}
                        placeholder="0.00" inputClassName="tabular-nums"
                    />
                </div>

                {/* De dónde sale. Se muestra y no sólo se calcula: el papel que
                    va a entrar a esa bolsa dice justamente esto.

                    El folio no alcanza para saber CUÁL es sobre la mesa: las
                    bolsas de una sala se distinguen por el corte del que
                    nacieron, y eso —día y hora— es lo que dice la etiqueta
                    pegada afuera. Pedido del usuario el 2026-08-17. */}
                {eleccion.repartos.length > 0 && (
                    <div data-surface="card" className="p-3 space-y-1.5">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3">
                            Sale de
                        </span>
                        {eleccion.repartos.map((r) => {
                            const b = lista.find((x) => x.id === r.bolsa_id);
                            return (
                                <div key={r.bolsa_id} className="flex items-baseline justify-between gap-2">
                                    <span className="text-label text-content truncate">
                                        {r.folio}
                                        <span className="text-caption text-content-3">
                                            {b ? ` · corte del ${fechaCorta(b.fecha)} ${hhmm(b.hora)}` : ''}
                                            {' '}· quedan {formatMoney((b?.saldo || 0) - r.monto)}
                                        </span>
                                    </span>
                                    <span className="text-label font-bold tabular-nums text-content shrink-0">
                                        {formatMoney(r.monto)}
                                    </span>
                                </div>
                            );
                        })}
                        {eleccion.combinada && (
                            <p className="text-caption text-warning-text pt-1">
                                Ninguna bolsa alcanzaba sola: van a salir {eleccion.repartos.length} vales,
                                uno para cada bolsa.
                            </p>
                        )}
                    </div>
                )}

                {/* ── De acá abajo, todo lo pide el MOTIVO ─────────────────────
                    Sin motivo elegido no se pinta ninguno: la remesadora es de
                    una remesa, no del formulario. Cuál aparece y cómo se rotula
                    sale del catálogo (`bolsas_tipos_salida`), no de `if`s acá.

                    Y si el campo tiene lista propia —las remesadoras—, es un
                    desplegable: así lo que se guarda coincide con el catálogo
                    por construcción y no por cómo lo escribió cada quien. */}
                {t?.etiqueta_entidad && (opciones.length ? (
                    <div>
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                            {t.etiqueta_entidad}
                        </span>
                        <LiquidSelect
                            value={entidad} onChange={setEntidad}
                            options={opciones}
                            placeholder="Elegir…" ariaLabel={t.etiqueta_entidad}
                        />
                    </div>
                ) : (
                    <PortalInput
                        label={t.etiqueta_entidad} name="entidad"
                        value={entidad} onChange={(e) => setEntidad(e.target.value)}
                        placeholder="A quién se le paga"
                    />
                ))}
                {t?.pide_boleta && (
                    <PortalInput
                        label="Número de boleta" name="boleta"
                        value={boleta} onChange={(e) => setBoleta(e.target.value)}
                        placeholder="El de la boleta del POS"
                    />
                )}
                {/* `FileField` y no un `<input type="file">` suelto: el canónico
                    de §15.9. Las dos excepciones vivas son selectores de foto
                    donde el disparador ES la imagen (avatar, foto de producto) —
                    acá el adjunto es una fila más del formulario, que es
                    exactamente el caso que el canónico resuelve, con su límite
                    de tamaño y su estado de «falta y es error». */}
                {t?.pide_foto && (
                    <FileField
                        label="Foto del comprobante"
                        accept="image/*"
                        maxSizeMB={10}
                        file={foto}
                        onChange={setFoto}
                        emptyState="pending"
                        hint="La boleta que imprimió el POS."
                    />
                )}

                {/* Quién se lleva el efectivo. En una remesa no va: quien recibe
                    es el cliente y lo identifica la boleta del POS. */}
                {t?.pide_receptor && (
                    <PruebaDeIdentidad
                        quien={quien} onQuien={setQuien}
                        metodo={metodo} onMetodo={setMetodo}
                        secreto={secreto} onSecreto={setSecreto}
                    />
                )}

                <PortalTextarea
                    label="Detalle (opcional)" name="nota" rows={2}
                    value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="Cualquier cosa que ayude a entenderlo después"
                />

                {error && (
                    <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center justify-between gap-3 w-full flex-wrap">
                    <span className="text-caption text-content-3 min-w-0 truncate">
                        {falta || 'Se imprime el vale para dejarlo dentro de la bolsa'}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                        <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button variant="primary" icon={HandCoins} loading={guardando}
                            disabled={!!falta} onClick={guardar}>
                            Registrar e imprimir
                        </Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
