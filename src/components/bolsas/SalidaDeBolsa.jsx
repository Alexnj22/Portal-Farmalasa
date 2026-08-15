import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, HandCoins, Package, ScanLine, ShieldCheck } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import {
    fetchTiposDeSalida, registrarSalida, subirComprobante,
} from '../../data/bolsas';
import { disponibles, elegirBolsas, totalDisponible } from '../../utils/bolsasReparto';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
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
 * escritos acá: una remesa pide banco, boleta y foto; un anticipo no pide
 * ninguno. Escrito a mano, un motivo nuevo aparecería en la base y no en la
 * pantalla.
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

const METODOS = [
    { value: 'CARNE', label: 'Carné' },
    { value: 'CLAVE', label: 'Usuario y contraseña' },
];

export default function SalidaDeBolsa({ abierto, bolsas, saldos, onClose, onHecho }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const empleados = useStaff((st) => st.employees);

    const [tipos, setTipos] = useState([]);
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
        fetchTiposDeSalida().then((t) => { setTipos(t); setTipo((v) => v || t[0]?.codigo || ''); });
    }, [abierto]);

    // Al cerrar se olvida TODO, y la clave la primera. Un secreto que sobrevive
    // al diálogo es un secreto que alguien puede volver a mandar sin saberlo.
    useEffect(() => {
        if (abierto) return;
        setMonto(''); setEntidad(''); setBoleta(''); setNota(''); setFoto(null);
        setQuien(''); setSecreto(''); setError(null);
    }, [abierto]);

    const t = useMemo(() => tipos.find((x) => x.codigo === tipo) || null, [tipos, tipo]);

    const lista = useMemo(() => disponibles(bolsas, saldos), [bolsas, saldos]);
    const n = Number(String(monto).replace(',', '.'));
    const eleccion = useMemo(
        () => elegirBolsas(lista, Number.isFinite(n) ? n : 0),
        [lista, n],
    );

    const gente = useMemo(() => (empleados || [])
        .filter((e) => e.status === 'ACTIVO')
        .map((e) => ({ value: e.id, label: e.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')), [empleados]);

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

            const { data, error: err } = await registrarSalida({
                tipo: t.codigo,
                monto: n,
                repartos: eleccion.repartos.map(({ bolsa_id, monto: m }) => ({ bolsa_id, monto: m })),
                entidad, numeroBoleta: boleta, fotoUrl, nota,
                recibidoPor: t.pide_receptor ? quien : null,
                metodo: t.pide_receptor ? metodo : null,
                secreto: t.pide_receptor ? secreto : null,
            });
            // La clave se olvida apenas se manda, salga bien o mal.
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput
                        label="Cuánto" name="monto" type="number" inputMode="decimal"
                        step="0.01" min="0" icon={HandCoins}
                        value={monto} onChange={(e) => setMonto(e.target.value)}
                        placeholder="0.00" inputClassName="tabular-nums"
                    />
                    <div>
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                            Motivo
                        </span>
                        <LiquidSelect
                            value={tipo} onChange={setTipo}
                            options={tipos.map((x) => ({ value: x.codigo, label: x.etiqueta }))}
                            placeholder="Elegir…" ariaLabel="Motivo de la salida"
                        />
                    </div>
                </div>

                {/* De dónde sale. Se muestra y no sólo se calcula: el papel que
                    va a entrar a esa bolsa dice justamente esto. */}
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

                {/* Lo que pide el motivo elegido — sale del catálogo. */}
                {t?.etiqueta_entidad && (
                    <PortalInput
                        label={t.etiqueta_entidad} name="entidad"
                        value={entidad} onChange={(e) => setEntidad(e.target.value)}
                        placeholder={t.etiqueta_entidad === 'Banco' ? 'Banco del POS' : 'A quién se le paga'}
                    />
                )}
                {t?.pide_boleta && (
                    <PortalInput
                        label="Número de boleta" name="boleta"
                        value={boleta} onChange={(e) => setBoleta(e.target.value)}
                        placeholder="El de la boleta del POS"
                    />
                )}
                {t?.pide_foto && (
                    <div>
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                            Foto del comprobante
                        </span>
                        <label data-surface="card" className="flex items-center gap-2 p-3 cursor-pointer">
                            <Camera size={16} className="text-content-3 shrink-0" />
                            <span className="text-label text-content truncate">
                                {foto ? foto.name : 'Tomar o elegir la foto'}
                            </span>
                            <input
                                type="file" accept="image/*" capture="environment"
                                className="sr-only"
                                aria-label="Foto del comprobante"
                                onChange={(e) => setFoto(e.target.files?.[0] || null)}
                            />
                        </label>
                    </div>
                )}

                {/* Quién se lleva el efectivo. En una remesa no va: quien recibe
                    es el cliente y lo identifica la boleta del POS. */}
                {t?.pide_receptor && (
                    <div data-surface="card" className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <ShieldCheck size={15} className="text-content-3 shrink-0" />
                            <span className="text-label font-bold text-content">Quién se lleva el efectivo</span>
                        </div>
                        <LiquidSelect
                            value={quien} onChange={setQuien} options={gente}
                            placeholder="Buscar a la persona…" ariaLabel="Quién se lleva el efectivo"
                        />
                        <SegmentedControl
                            value={metodo}
                            onChange={(v) => { setMetodo(v); setSecreto(''); }}
                            options={METODOS}
                        />
                        <PortalInput
                            label={metodo === 'CARNE' ? 'Escanear el carné' : 'Su contraseña'}
                            name="secreto"
                            type={metodo === 'CARNE' ? 'text' : 'password'}
                            icon={metodo === 'CARNE' ? ScanLine : undefined}
                            value={secreto} onChange={(e) => setSecreto(e.target.value)}
                            placeholder={metodo === 'CARNE' ? 'Pasá el carné por el lector' : '••••••••'}
                            autoComplete="off"
                        />
                        <p className="text-caption text-content-3">
                            Se comprueba contra su cuenta. No se guarda en ninguna parte.
                        </p>
                    </div>
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
