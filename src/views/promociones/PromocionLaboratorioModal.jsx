import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2, X, FlaskConical } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import { LoadingState } from '../../components/common/StateViews';
import useBorrador from '../../hooks/useBorrador';
import { useStaffStore } from '../../store/staffStore';
import { SALAS_VENTA } from '../metas/metasUtils';
import {
    crearPromocionLaboratorio, editarPromocionLaboratorio,
    fetchPromocionLaboratorio, fetchLaboratorios, fetchProveedoresDelSistema,
} from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fmtMoneda, mesesRecientes } from './promocionesUtils';

const CLAVE_BORRADOR = 'promocion_laboratorio';

/**
 * Promoción por LABORATORIO — la de niveles y umbral por sala.
 *
 * Es la matriz que el usuario llevaba en Excel: los MONTOS de cada nivel son
 * iguales para todas las salas ($10/$20/$30/$40) y lo que cambia por sala es el
 * UMBRAL de venta que hay que alcanzar. Salud 4 necesita $4,250 para el nivel 1
 * y Salud 5 sólo $1,800, porque no venden lo mismo.
 *
 * ── Por qué la matriz se pinta por SALA y no como tabla ─────────────────────
 * Una tabla de salas × niveles con seis filas y cuatro columnas no entra en un
 * teléfono sin desbordarse, y el desborde no da error: se ve una tabla cortada
 * y nadie sabe que faltan columnas. Un bloque por sala con sus niveles adentro
 * se lee igual de bien en los dos anchos y no necesita corte de pantalla.
 *
 * ── El freno que hay que conocer ────────────────────────────────────────────
 * Los umbrales de cada sala tienen que SUBIR con el nivel. No es capricho: el
 * cálculo resuelve el nivel alcanzado con «el más alto cuyo umbral se cumplió»,
 * así que un nivel 3 más barato que el 2 le pagaría a la sala un nivel que no
 * alcanzó. Lo valida la base; acá se avisa antes para no mandar a fallar.
 */
export default function PromocionLaboratorioModal({ open, promocionId, onClose, onGuardada }) {
    const editando = !!promocionId;
    const salas = useSalasDeVenta();

    const [nombre, setNombre]   = useState('');
    const [mes, setMes]         = useState(() => mesesRecientes()[0]?.value || '');
    const [labs, setLabs]       = useState([]);          // [{id, nombre}]
    const [niveles, setNiveles] = useState(() => nivelesIniciales());
    const [umbrales, setUmbrales] = useState({});        // { `${branchId}:${nivel}`: '4250' }
    const [paga, setPaga]       = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [nota, setNota]       = useState('');

    const [catalogo, setCatalogo] = useState([]);
    const [proveedores, setProveedores] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);

    useEffect(() => {
        if (!open) return;
        fetchLaboratorios().then(setCatalogo).catch(() => setCatalogo([]));
        fetchProveedoresDelSistema().then(setProveedores).catch(() => setProveedores([]));
    }, [open]);

    // Al abrir para EDITAR se trae lo que hay. Al abrir para crear se limpia:
    // sin esto, cerrar y volver a abrir arrastra lo de la promoción anterior.
    useEffect(() => {
        // No hay rama de «limpiar»: la vista monta el modal sólo cuando está
        // abierto, así que cerrarlo lo desmonta y el estado vuelve a nacer. Un
        // reset a mano sería una segunda verdad sobre lo mismo.
        if (!open || !editando) return undefined;
        let vivo = true;
        setCargando(true);
        setFallo(null);
        fetchPromocionLaboratorio(promocionId)
            .then((p) => {
                if (!vivo || !p) return;
                setNombre(p.nombre || '');
                setMes(p.year_month || '');
                setLabs(Array.isArray(p.laboratorios) ? p.laboratorios : []);
                setNiveles((p.niveles || []).map((n) => ({
                    nivel: Number(n.nivel), monto: String(n.monto ?? ''),
                })));
                setUmbrales(Object.fromEntries(
                    (p.umbrales || []).map((u) => [`${u.branch_id}:${u.nivel}`, String(u.umbral ?? '')]),
                ));
                setPaga(p.paga || '');
                setSupplierId(p.supplier_id == null ? '' : String(p.supplier_id));
                setNota(p.nota || '');
            })
            .catch((e) => { if (vivo) setFallo(mensajeAmigable(e, 'No se pudo cargar la promoción.')); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, editando, promocionId]);

    const valor = useMemo(
        () => ({ nombre, mes, labs, niveles, umbrales, paga, supplierId, nota }),
        [nombre, mes, labs, niveles, umbrales, paga, supplierId, nota],
    );

    // El borrador es sólo del alta: al editar, lo guardado ES el borrador, y
    // reponerle a alguien un texto de otra promoción sería peor que perderlo.
    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        CLAVE_BORRADOR, valor, { activo: open && !editando },
    );

    const reponer = useCallback(() => {
        if (!recuperado) return;
        setNombre(recuperado.nombre || '');
        setMes(recuperado.mes || '');
        setLabs(Array.isArray(recuperado.labs) ? recuperado.labs : []);
        setNiveles(Array.isArray(recuperado.niveles) && recuperado.niveles.length
            ? recuperado.niveles : nivelesIniciales());
        setUmbrales(recuperado.umbrales || {});
        setPaga(recuperado.paga || '');
        setSupplierId(recuperado.supplierId || '');
        setNota(recuperado.nota || '');
        descartar();
    }, [recuperado, descartar]);

    const agregarLab = (id) => {
        const n = Number(id);
        if (!n || labs.some((l) => Number(l.id) === n)) return;
        const encontrado = catalogo.find((l) => Number(l.id) === n);
        if (encontrado) setLabs((xs) => [...xs, encontrado]);
    };
    const quitarLab = (id) => setLabs((xs) => xs.filter((l) => Number(l.id) !== Number(id)));

    const agregarNivel = () => setNiveles((ns) => ([
        ...ns, { nivel: (ns.at(-1)?.nivel || 0) + 1, monto: '' },
    ]));

    // Quitar un nivel del medio dejaría un hueco (1, 3, 4) y sus umbrales
    // huérfanos, así que se renumeran los dos juntos.
    const quitarNivel = (nivel) => {
        setNiveles((ns) => ns.filter((n) => n.nivel !== nivel)
            .map((n, i) => ({ ...n, nivel: i + 1 })));
        setUmbrales((u) => {
            const quedan = niveles.filter((n) => n.nivel !== nivel).map((n) => n.nivel);
            const salida = {};
            for (const [k, v] of Object.entries(u)) {
                const [b, nv] = k.split(':').map(Number);
                const i = quedan.indexOf(nv);
                if (i >= 0) salida[`${b}:${i + 1}`] = v;
            }
            return salida;
        });
    };

    const setNivel = (nivel, monto) =>
        setNiveles((ns) => ns.map((n) => (n.nivel === nivel ? { ...n, monto } : n)));

    const setUmbral = (branchId, nivel, v) =>
        setUmbrales((u) => ({ ...u, [`${branchId}:${nivel}`]: v }));

    // ── Lo que hay que avisar ANTES de mandar ────────────────────────────────
    const problemas = useMemo(() => {
        const out = [];
        if (!nombre.trim()) out.push('Falta el nombre.');
        if (!mes) out.push('Falta el mes.');
        if (!labs.length) out.push('Elige al menos un laboratorio.');
        if (!niveles.length) out.push('Tiene que haber al menos un nivel.');
        if (niveles.some((n) => !(Number(n.monto) > 0))) {
            out.push('Cada nivel necesita un monto mayor que cero.');
        }
        const conUmbral = salas.filter((s) =>
            niveles.some((n) => Number(umbrales[`${s.id}:${n.nivel}`]) > 0));
        if (!conUmbral.length) out.push('Ninguna sala tiene umbral: nadie podría alcanzar un nivel.');
        for (const s of conUmbral) {
            let previo = null;
            for (const n of niveles) {
                const v = Number(umbrales[`${s.id}:${n.nivel}`]);
                if (!(v > 0)) continue;
                if (previo !== null && v <= previo) {
                    out.push(`En ${s.name} el nivel ${n.nivel} no pide más venta que el anterior.`);
                    break;
                }
                previo = v;
            }
        }
        if (paga === 'proveedor' && !supplierId) out.push('Elige el proveedor que paga.');
        return out;
    }, [nombre, mes, labs, niveles, umbrales, salas, paga, supplierId]);

    const guardar = async () => {
        setFallo(null);
        setGuardando(true);
        try {
            const payload = {
                nombre: nombre.trim(),
                laboratorios: labs.map((l) => Number(l.id)),
                niveles: niveles.map((n) => ({ nivel: n.nivel, monto: Number(n.monto) })),
                umbrales: Object.entries(umbrales)
                    .filter(([, v]) => Number(v) > 0)
                    .map(([k, v]) => {
                        const [branch_id, nivel] = k.split(':').map(Number);
                        return { branch_id, nivel, umbral: Number(v) };
                    }),
                paga: paga || null,
                supplierId: paga === 'proveedor' && supplierId ? Number(supplierId) : null,
                nota: nota.trim() || null,
            };
            if (editando) await editarPromocionLaboratorio({ id: promocionId, ...payload });
            else          await crearPromocionLaboratorio({ mes, ...payload });
            if (!editando) descartar();
            onGuardada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo guardar la promoción.'));
        } finally {
            setGuardando(false);
        }
    };

    const opcionesLab = useMemo(() => ([
        { value: '', label: 'Agregar un laboratorio…' },
        ...catalogo
            .filter((l) => !labs.some((x) => Number(x.id) === Number(l.id)))
            .map((l) => ({ value: String(l.id), label: l.nombre })),
    ]), [catalogo, labs]);

    return (
        <LiquidModal
            open={open}
            onClose={onClose}
            maxWidth="max-w-3xl"
            ariaLabel={editando ? 'Editar promoción por laboratorio' : 'Nueva promoción por laboratorio'}
        >
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">
                    {editando ? 'Editar promoción por laboratorio' : 'Nueva promoción por laboratorio'}
                </h2>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando ? <LoadingState label="Cargando la promoción…" /> : (
                    <div className="space-y-4">
                        {hayBorrador && (
                            <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />
                        )}

                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-[1fr_auto]">
                            <PortalInput
                                label="Nombre de la promoción"
                                name="nombre"
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                placeholder="El nombre que va a ver la sala"
                                required
                            />
                            <Campo rotulo="Mes" falta={!mes}>
                                {/* El mes no se cambia al editar: mover un programa de
                                    mes le cambiaría la venta medida a las seis salas
                                    de golpe, y eso no es una corrección. */}
                                <LiquidSelect
                                    value={mes}
                                    onChange={setMes}
                                    options={mesesRecientes()}
                                    disabled={editando}
                                    clearable={false}
                                    ariaLabel="Mes de la promoción"
                                />
                            </Campo>
                        </div>

                        <div>
                            <Campo rotulo="Laboratorios" falta={!labs.length}>
                                {/* `clearable={false}` porque su valor siempre vuelve
                                    a vacío: la ✕ borraría algo que no está puesto. */}
                                <LiquidSelect
                                    value=""
                                    onChange={agregarLab}
                                    options={opcionesLab}
                                    clearable={false}
                                    ariaLabel="Agregar un laboratorio"
                                />
                            </Campo>
                            {labs.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {labs.map((l) => (
                                        <span
                                            key={l.id}
                                            className="inline-flex items-center gap-1 rounded-full border border-border-card bg-surface-card-hover pl-2.5 pr-1 py-1 text-caption text-content"
                                        >
                                            {l.nombre}
                                            <Button
                                                variant="ghost" size="sm" iconOnly icon={X}
                                                title={`Quitar ${l.nombre}`}
                                                onClick={() => quitarLab(l.id)}
                                            />
                                        </span>
                                    ))}
                                </div>
                            )}
                            <p className="text-caption text-content-3 mt-1.5">
                                Cuenta la venta del mes de todos los productos de estos laboratorios.
                            </p>
                        </div>

                        {/* ── Los montos: iguales para todas las salas ───────── */}
                        <section className="rounded-card border border-border-card p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-body font-semibold text-content">
                                    Cuánto gana cada persona
                                </h3>
                                <Button variant="secondary" size="sm" icon={Plus} onClick={agregarNivel}>
                                    Otro nivel
                                </Button>
                            </div>
                            <p className="text-caption text-content-3">
                                El monto de cada nivel es el mismo para las seis salas. Lo que cambia
                                por sala es cuánto tiene que vender para alcanzarlo.
                            </p>
                            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                                {niveles.map((n) => (
                                    <div key={n.nivel} className="flex items-end gap-1">
                                        <PortalInput
                                            label={`Nivel ${n.nivel}`}
                                            name={`nivel-${n.nivel}`}
                                            value={n.monto}
                                            onChange={(e) => setNivel(n.nivel, e.target.value)}
                                            inputMode="decimal"
                                            prefix="$"
                                        />
                                        {niveles.length > 1 && (
                                            <Button
                                                variant="ghost" size="sm" iconOnly icon={Trash2}
                                                title={`Quitar el nivel ${n.nivel}`}
                                                onClick={() => quitarNivel(n.nivel)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* ── La matriz: un bloque por sala ─────────────────── */}
                        <section className="space-y-2">
                            <h3 className="text-body font-semibold text-content">
                                Cuánto tiene que vender cada sala
                            </h3>
                            <p className="text-caption text-content-3">
                                Dejar un nivel en blanco significa que esa sala no lo puede alcanzar.
                            </p>
                            {salas.map((s) => (
                                <div key={s.id} className="rounded-card border border-border-card p-3">
                                    <span className="block text-label uppercase tracking-wide font-semibold text-content-2 mb-2">
                                        {s.name}
                                    </span>
                                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                                        {niveles.map((n) => (
                                            <PortalInput
                                                key={n.nivel}
                                                label={`N${n.nivel} · ${n.monto ? fmtMoneda(n.monto) : '—'}`}
                                                name={`u-${s.id}-${n.nivel}`}
                                                value={umbrales[`${s.id}:${n.nivel}`] || ''}
                                                onChange={(e) => setUmbral(s.id, n.nivel, e.target.value)}
                                                inputMode="decimal"
                                                prefix="$"
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </section>

                        {/* ── Quién paga ────────────────────────────────────── */}
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                            <Campo rotulo="Quién paga el bono">
                                <LiquidSelect
                                    value={paga}
                                    onChange={(v) => { setPaga(v); if (v !== 'proveedor') setSupplierId(''); }}
                                    options={[
                                        { value: '',           label: 'Todavía no se sabe' },
                                        { value: 'empresa',    label: 'La empresa' },
                                        { value: 'proveedor',  label: 'Un proveedor' },
                                    ]}
                                />
                            </Campo>
                            {paga === 'proveedor' && (
                                <Campo rotulo="Proveedor" falta={!supplierId}>
                                    <LiquidSelect
                                        value={supplierId}
                                        onChange={setSupplierId}
                                        options={[
                                            { value: '', label: 'Elige el proveedor' },
                                            ...proveedores.map((p) => ({ value: String(p.id), label: p.nombre })),
                                        ]}
                                        ariaLabel="Proveedor que paga el bono"
                                    />
                                </Campo>
                            )}
                        </div>

                        <PortalTextarea
                            label="Nota"
                            name="nota"
                            value={nota}
                            onChange={(e) => setNota(e.target.value)}
                            placeholder="Lo que haga falta recordar de este acuerdo"
                            rows={2}
                        />

                        {problemas.length > 0 && (
                            <Notice variant="warning" icon={AlertTriangle}>
                                <ul className="list-disc pl-4 space-y-0.5">
                                    {problemas.map((p) => <li key={p}>{p}</li>)}
                                </ul>
                            </Notice>
                        )}

                        {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose} disabled={guardando}>
                    Cancelar
                </Button>
                <Button
                    icon={FlaskConical}
                    onClick={guardar}
                    loading={guardando}
                    disabled={problemas.length > 0 || cargando}
                >
                    {editando ? 'Guardar cambios' : 'Crear promoción'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

const nivelesIniciales = () => [1, 2, 3, 4].map((nivel) => ({ nivel, monto: '' }));

/**
 * Las seis salas de VENTA, del catálogo canónico.
 *
 * Igual que en `PromocionModal`: filtrar por `!b.es_bodega` deja entrar a
 * Administración, porque el `branches` del store trae sólo `id` y `name` y la
 * negación de una propiedad que no existe es cierta para todos.
 */
function useSalasDeVenta() {
    const branches = useStaffStore((s) => s.branches);
    return useMemo(
        () => SALAS_VENTA
            .map((id) => (branches || []).find((b) => Number(b.id) === id))
            .filter(Boolean),
        [branches],
    );
}

/** El rótulo de un control que no trae el suyo — `LiquidSelect` no lleva. */
function Campo({ rotulo, falta = false, children }) {
    return (
        <div className="flex flex-col gap-1 min-w-0">
            <span className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                {rotulo}
                {falta && <span className="text-danger" aria-label="requerido">*</span>}
            </span>
            {children}
        </div>
    );
}
