import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, AlertTriangle, Check, Tag } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import AvisoDeBorrador from '../../components/common/AvisoDeBorrador';
import useBorrador from '../../hooks/useBorrador';
import { useStaffStore } from '../../store/staffStore';
import { crearPromocion, fetchPresentacionesDeProducto } from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';
import { hoySV, fmtUnidades, rotuloPresentacion } from './promocionesUtils';

const CLAVE_BORRADOR = 'promocion_nueva';

/** Las seis salas de venta. Bodega queda afuera: el lote se reparte entre las
 *  salas que venden, y ésa es la regla que hace que el total no cambie cuando
 *  un traslado mueve producto. */
const useSalasDeVenta = () => {
    const branches = useStaffStore((s) => s.branches);
    return useMemo(
        () => (branches || []).filter((b) => !b.es_bodega && b.name !== 'Bodega'),
        [branches],
    );
};

export default function PromocionModal({ open, onClose, onGuardada }) {
    const salas = useSalasDeVenta();

    const [nombre, setNombre]   = useState('');
    const [nota, setNota]       = useState('');
    const [renglones, setRenglones] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);

    const valor = useMemo(() => ({ nombre, nota, renglones }), [nombre, nota, renglones]);

    /* Un formulario largo se guarda solo: la sesión de sala se cierra a los 5
       minutos y lo escrito vive en memoria. El aviso «¿sigues ahí?» evita la
       sorpresa, no la pérdida. No repone solo — devuelve el dato y la pantalla
       decide. */
    const { recuperado, cuando, descartar, hayBorrador } = useBorrador(
        CLAVE_BORRADOR, valor, { activo: open },
    );

    const reponer = useCallback(() => {
        if (!recuperado) return;
        setNombre(recuperado.nombre || '');
        setNota(recuperado.nota || '');
        setRenglones(Array.isArray(recuperado.renglones) ? recuperado.renglones : []);
        descartar();
    }, [recuperado, descartar]);

    const agregar = (prod) => {
        setRenglones((rs) => {
            if (rs.some((r) => r.erp_product_id === prod.id)) return rs;
            return [...rs, {
                erp_product_id: prod.id,
                producto: prod.nombre,
                laboratorio: prod.laboratorio_nombre || 'Sin laboratorio',
                factor_unidades: null,
                inicio: hoySV(),
                fin: '',
                lote_total: '',
                bono_vendedor: '1.00',
                bono_adm: '0.25',
                bono_bodega: '0.25',
                unidades_por_bono: '1',
                reparto: Object.fromEntries(salas.map((s) => [s.id, ''])),
            }];
        });
    };

    const cambiar = (idx, campo, v) =>
        setRenglones((rs) => rs.map((r, i) => (i === idx ? { ...r, [campo]: v } : r)));

    const cambiarReparto = (idx, salaId, v) =>
        setRenglones((rs) => rs.map((r, i) => (
            i === idx ? { ...r, reparto: { ...r.reparto, [salaId]: v } } : r
        )));

    const quitar = (idx) => setRenglones((rs) => rs.filter((_, i) => i !== idx));

    const guardar = async () => {
        setFallo(null);
        setGuardando(true);
        try {
            await crearPromocion({
                nombre,
                nota,
                renglones: renglones.map((r) => ({
                    erp_product_id: r.erp_product_id,
                    factor_unidades: r.factor_unidades,
                    inicio: r.inicio,
                    fin: r.fin,
                    lote_total: Number(r.lote_total) || 0,
                    bono_vendedor: Number(r.bono_vendedor) || 0,
                    bono_adm: Number(r.bono_adm) || 0,
                    bono_bodega: Number(r.bono_bodega) || 0,
                    unidades_por_bono: Number(r.unidades_por_bono) || 1,
                    reparto: Object.entries(r.reparto)
                        .filter(([, u]) => Number(u) > 0)
                        .map(([branch_id, u]) => ({ branch_id: Number(branch_id), unidades: Number(u) })),
                })),
            });
            descartar();
            onGuardada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo crear la promoción.'));
        } finally {
            setGuardando(false);
        }
    };

    const listo = nombre.trim() && renglones.length > 0
        && renglones.every((r) => r.fin && Number(r.lote_total) > 0 && cuadra(r));

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Nueva promoción">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Nueva promoción</h2>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="space-y-4">
                    {hayBorrador && (
                        <AvisoDeBorrador cuando={cuando} onRecuperar={reponer} onDescartar={descartar} />
                    )}

                    <PortalInput
                        label="Nombre de la promoción"
                        name="nombre"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder="Orfenaflex septiembre"
                        helperText="Es el nombre que va a ver la sala."
                        required
                    />

                    {/* El canónico: 150 ms de rebote medidos, piso de dos
                        letras y la barra abierta. Se acota el alto porque acá
                        es UNA sección del formulario, no la pantalla entera. */}
                    <div className="max-h-64 flex flex-col rounded-lg border border-border-card p-2">
                        <BuscadorDeProducto
                            onElegir={agregar}
                            placeholder="Buscar el producto de la promoción…"
                            invitacion={{ icono: Tag, texto: 'Busca el producto que entra en la promoción' }}
                        />
                    </div>

                    {renglones.map((r, i) => (
                        <RenglonEditor
                            key={r.erp_product_id}
                            r={r}
                            salas={salas}
                            onCambiar={(c, v) => cambiar(i, c, v)}
                            onReparto={(s, v) => cambiarReparto(i, s, v)}
                            onQuitar={() => quitar(i)}
                        />
                    ))}

                    <PortalTextarea
                        label="Nota"
                        name="nota"
                        value={nota}
                        onChange={(e) => setNota(e.target.value)}
                        placeholder="Lo que convenga recordar de esta negociación."
                        rows={2}
                    />

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <span className="text-caption text-content-3 mr-auto">
                    Nace en borrador — no cuenta hasta activarla.
                </span>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} loading={guardando} disabled={!listo} onClick={guardar}>
                    Guardar promoción
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

/** ¿El reparto de este renglón suma su lote? Lo valida también la base, pero
 *  decirlo mientras se escribe evita mandar algo que va a rebotar. */
function cuadra(r) {
    const suma = Object.values(r.reparto || {}).reduce((a, u) => a + (Number(u) || 0), 0);
    return suma === (Number(r.lote_total) || 0) && suma > 0;
}

function RenglonEditor({ r, salas, onCambiar, onReparto, onQuitar }) {
    const [presentaciones, setPresentaciones] = useState([]);

    useEffect(() => {
        fetchPresentacionesDeProducto(r.erp_product_id)
            .then((p) => setPresentaciones(p || []))
            .catch(() => setPresentaciones([]));
    }, [r.erp_product_id]);

    const opcionesPres = useMemo(() => ([
        { value: '', label: 'Cualquier presentación' },
        ...presentaciones.map((p) => ({
            value: String(p.factor),
            label: `${p.etiqueta} · ×${p.factor}`,
        })),
    ]), [presentaciones]);

    const suma = Object.values(r.reparto || {}).reduce((a, u) => a + (Number(u) || 0), 0);
    const lote = Number(r.lote_total) || 0;
    const ok = suma === lote && suma > 0;

    // Con una presentación elegida el monto es POR esa presentación, no por
    // unidad. Decirlo en la etiqueta evita el error de poner $1 por caja
    // creyendo que paga por caja cuando pagaría por tableta.
    const unidadPago = r.factor_unidades == null
        ? '$/unidad'
        : `$/${(presentaciones.find((p) => String(p.factor) === String(r.factor_unidades))?.etiqueta || 'presentación')
              .split(' ')[0].toLowerCase()}`;

    return (
        <div className="rounded-lg border border-border-card bg-surface-card p-3 space-y-3">
            <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-body-sm font-semibold text-content">
                    {r.producto}
                </span>
                <span className="text-micro uppercase text-content-3 shrink-0">{r.laboratorio}</span>
                <Button variant="ghost" size="sm" iconOnly icon={Trash2}
                    onClick={onQuitar} title="Quitar producto" />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                <LiquidSelect
                    value={r.factor_unidades == null ? '' : String(r.factor_unidades)}
                    onChange={(v) => onCambiar('factor_unidades', v === '' ? null : Number(v))}
                    options={opcionesPres}
                    clearable={false}
                    compact
                    ariaLabel="Presentación"
                />
                <PortalInput
                    label="Lote (unidades)"
                    name={`lote-${r.erp_product_id}`}
                    value={r.lote_total}
                    onChange={(e) => onCambiar('lote_total', e.target.value)}
                    inputMode="numeric"
                    compact
                />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
                <PortalInput label="Empieza" name={`ini-${r.erp_product_id}`} type="date"
                    value={r.inicio} onChange={(e) => onCambiar('inicio', e.target.value)} compact />
                <PortalInput label="Termina" name={`fin-${r.erp_product_id}`} type="date"
                    value={r.fin} onChange={(e) => onCambiar('fin', e.target.value)} compact required />
            </div>

            <div className="grid gap-2 grid-cols-3">
                <PortalInput label={`Vendedor ${unidadPago}`} name={`bv-${r.erp_product_id}`}
                    value={r.bono_vendedor} onChange={(e) => onCambiar('bono_vendedor', e.target.value)}
                    inputMode="decimal" compact />
                <PortalInput label="Fondo admón." name={`ba-${r.erp_product_id}`}
                    value={r.bono_adm} onChange={(e) => onCambiar('bono_adm', e.target.value)}
                    inputMode="decimal" compact />
                <PortalInput label="Fondo bodega" name={`bb-${r.erp_product_id}`}
                    value={r.bono_bodega} onChange={(e) => onCambiar('bono_bodega', e.target.value)}
                    inputMode="decimal" compact />
            </div>

            <div>
                <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-label uppercase tracking-wide text-content-3 font-semibold">
                        Reparto por sala
                    </span>
                    <span className="flex-1" />
                    <Badge variant={ok ? 'success' : 'warning'} size="sm">
                        {fmtUnidades(suma)} de {fmtUnidades(lote)}
                    </Badge>
                </div>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                    {salas.map((s) => (
                        <PortalInput
                            key={s.id}
                            label={s.name}
                            name={`rep-${r.erp_product_id}-${s.id}`}
                            value={r.reparto?.[s.id] ?? ''}
                            onChange={(e) => onReparto(s.id, e.target.value)}
                            inputMode="numeric"
                            compact
                        />
                    ))}
                </div>
                {!ok && (
                    <p className="text-caption text-warning-text mt-1.5">
                        El reparto tiene que sumar exactamente el lote — si no, alguna sala vendería
                        contra un número que no es suyo y el aviso les mentiría a todas.
                    </p>
                )}
            </div>

            <p className="text-caption text-content-3">
                {r.factor_unidades == null
                    ? 'Cuenta cualquier presentación y paga por unidad base.'
                    : `Sólo cuentan las ventas hechas como ${rotuloPresentacion(r.factor_unidades,
                        presentaciones.find((p) => String(p.factor) === String(r.factor_unidades))?.etiqueta)}, y el monto es por esa presentación.`}
            </p>
        </div>
    );
}
