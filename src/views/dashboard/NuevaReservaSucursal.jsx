import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import Button from '../../components/common/Button';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import SearchInput from '../../components/common/SearchInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';
import { codigoDeReserva, crearReservaEnSucursal, preciosDeProducto } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { imprimirConstanciaDeReserva } from '@nucleo/utils/reservaConstancia';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';

// ═══════════════════════════════════════════════════════════════════════════
// Reservar en la sucursal (2026-10-07): un cliente en el mostrador deja un
// anticipo y se le aparta el producto. Política: anticipo de al menos el 50 %
// y 7 días para retirarlo. Al guardar se imprime la constancia que se le
// entrega (con el código en barras para encontrarla al volver).
// ═══════════════════════════════════════════════════════════════════════════

const METODOS = [
    { value: 'efectivo', label: 'Efectivo' },
    { value: 'tarjeta', label: 'Tarjeta' },
    { value: 'transferencia', label: 'Transferencia' },
];
const redondear = (n) => Math.round(Number(n) * 100) / 100;

export default function NuevaReservaSucursal({ branchId, sala, onClose, onCreada }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((st) => st.appendAuditLog);
    const [cliente, setCliente] = useState(null);
    const [producto, setProducto] = useState(null);
    const [precios, setPrecios] = useState(null);
    const [presentacion, setPresentacion] = useState(null);
    const [cantidad, setCantidad] = useState('1');
    const [anticipo, setAnticipo] = useState('');
    const [metodo, setMetodo] = useState('efectivo');
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        let vivo = true;
        if (!producto) { setPrecios(null); setPresentacion(null); return undefined; }
        preciosDeProducto(producto.id).then((ps) => {
            if (!vivo) return;
            setPrecios(ps);
            setPresentacion(ps.length ? String(ps.length - 1) : null);
        }).catch((err) => { console.error('NuevaReservaSucursal: precios', err); if (vivo) setPrecios([]); });
        return () => { vivo = false; };
    }, [producto]);

    const pres = presentacion != null ? precios?.[Number(presentacion)] : null;
    const cant = Math.trunc(Number(cantidad)) || 0;
    const total = pres ? redondear(pres.precio * cant) : 0;
    const minimo = redondear(total * 0.5);
    const ant = Number(anticipo) || 0;
    const problema = !cliente ? 'Elige el cliente.' : !producto ? 'Elige el producto.' : !pres ? 'Ese producto no tiene precio.'
        : cant < 1 || cant > 50 ? 'La cantidad va de 1 a 50.' : ant < minimo ? `El anticipo mínimo es ${formatMoney(minimo)} (50 %).`
        : ant > total ? 'El anticipo no puede pasar del total.' : null;

    const guardar = async () => {
        if (problema || guardando) return;
        setGuardando(true);
        try {
            const nombre = `${producto.nombre}${pres.tipo ? ` · ${pres.tipo}` : ''}`;
            const r = await crearReservaEnSucursal({
                branchId, customerId: cliente.id, productoId: producto.id, productoNombre: nombre,
                cantidad: cant, precio: pres.precio, anticipo: ant, metodo,
            });
            appendAuditLog?.('RESERVA_EN_SUCURSAL', String(r.id), { anticipo: ant, total, metodo, cliente: cliente.id })?.catch?.(() => {});
            const codigo = codigoDeReserva(r.id);
            try {
                await imprimirConstanciaDeReserva({
                    codigo, cliente: shortEmployeeName(cliente.name), producto: nombre, cantidad: cant, precio: pres.precio,
                    anticipo: ant, metodo: METODOS.find((m) => m.value === metodo)?.label ?? metodo, venceAt: r.vence_at,
                    sala, atendio: shortEmployeeName(user?.name ?? ''),
                }, { sala: branchId });
            } catch (err) {
                console.error('NuevaReservaSucursal: no se imprimió', err);
                showToast('Reserva guardada', 'No se pudo imprimir la constancia: reimprímela desde la lista.', 'warning');
            }
            showToast('Reserva guardada', `${codigo} · saldo ${formatMoney(total - ant)} al retirar`, 'success');
            onCreada?.();
            onClose();
        } catch (err) {
            showToast('No se pudo reservar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Reservar en la sucursal">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">Reservar con anticipo</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <ElegirCliente cliente={cliente} onElegir={setCliente} />
                    {producto ? (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                            <p className="text-body-sm font-semibold text-content truncate min-w-0">{producto.nombre}</p>
                            <Button variant="ghost" size="sm" onClick={() => setProducto(null)}>Cambiar</Button>
                        </div>
                    ) : (
                        <BuscadorDeProducto onElegir={setProducto} placeholder="Producto que se aparta"
                            invitacion={{ texto: 'Busca el producto que el cliente quiere apartar.' }} />
                    )}
                    {precios && precios.length > 1 && (
                        <SegmentedControl label="Presentación" value={presentacion} onChange={setPresentacion} layout="block" columns={Math.min(precios.length, 3)}
                            options={precios.map((p, i) => ({ value: String(i), label: `${p.tipo} · ${formatMoney(p.precio)}` }))} />
                    )}
                    {pres && (
                        <div className="grid grid-cols-2 gap-3">
                            <PortalInput label="Cantidad" type="text" inputMode="numeric" value={cantidad}
                                onChange={(e) => setCantidad(e.target.value.replace(/\D/g, '').slice(0, 2))} helperText={`${formatMoney(pres.precio)} c/u`} />
                            <PortalInput label="Anticipo ($)" type="text" inputMode="decimal" maskType="DECIMAL" value={anticipo}
                                onChange={(e) => setAnticipo(e.target.value)} helperText={total ? `Total ${formatMoney(total)} · mínimo ${formatMoney(minimo)}` : undefined} />
                        </div>
                    )}
                    {pres && <SegmentedControl label="Cómo dejó el anticipo" options={METODOS} value={metodo} onChange={setMetodo} />}
                    {pres && total > 0 && ant >= minimo && ant <= total && (
                        <Notice variant="info">Saldo al retirar: <b>{formatMoney(total - ant)}</b>. Tiene 7 días para retirarlo.</Notice>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                {problema && <span className="text-caption text-content-3 mr-auto">{problema}</span>}
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Printer} disabled={!!problema} loading={guardando} onClick={guardar}>Guardar e imprimir</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function ElegirCliente({ cliente, onElegir }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 300);
    const [resultados, setResultados] = useState([]);
    useEffect(() => {
        let vivo = true;
        if (cliente || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        buscarClientes(q, { select: 'id, name, dui, phone', limite: 6 }).then(({ data, error }) => {
            if (!vivo) return;
            if (error) console.error('NuevaReservaSucursal: no se pudo buscar', error);
            setResultados(data ?? []);
        });
        return () => { vivo = false; };
    }, [q, cliente]);

    if (cliente) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                <div className="min-w-0">
                    <p className="text-caption text-content-3">Cliente</p>
                    <p className="text-body-sm font-semibold text-content truncate">{shortEmployeeName(cliente.name)}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { onElegir(null); setTexto(''); }}>Cambiar</Button>
            </div>
        );
    }
    return (
        <div className="space-y-1.5">
            <SearchInput value={texto} onChange={setTexto} placeholder="Cliente: nombre, DUI o teléfono" ariaLabel="Buscar la ficha del cliente" />
            {resultados.length > 0 && (
                <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
                    {resultados.map((c) => (
                        <li key={c.id}>
                            <button type="button" onClick={() => onElegir(c)}
                                className="w-full text-left px-3 py-2 min-h-[var(--tap-min)] hover:bg-surface-card-hover active:scale-[0.99]">
                                <span className="block text-body-sm font-semibold text-content truncate">{shortEmployeeName(c.name)}</span>
                                <span className="block text-caption text-content-3">{[c.dui, c.phone].filter(Boolean).join(' · ') || 'Sin documento'}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
