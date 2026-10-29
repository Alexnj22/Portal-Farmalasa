import React, { useEffect, useState } from 'react';
import { Send, ScanSearch } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import PortalTextarea from '../common/PortalTextarea';
import BuscadorDeProducto from '../common/BuscadorDeProducto';
import Notice from '../common/Notice';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { crearConsultaExistencia, fetchSalasConInventario } from '@nucleo/data/consultasExistencia';

/**
 * Pedirle a una o varias salas que cuenten un producto.
 *
 * `producto` viene armado cuando se abre desde otra pantalla (Revisión de
 * factor); si no, se elige con el buscador. `salasIniciales` son
 * `erp_sucursal_id`. Se puede preguntar a todas, la propia incluida: preguntar
 * no mueve existencia.
 */
export default function NuevaConsultaExistencia({ producto: inicial = null, salasIniciales = [], origen = 'manual', motivoInicial = '', onCerrar, onCreada }) {
    const [producto, setProducto] = useState(inicial);
    const [salas, setSalas] = useState([]);
    const [elegidas, setElegidas] = useState(() => new Set(salasIniciales));
    const [motivo, setMotivo] = useState(motivoInicial);
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        let vivo = true;
        fetchSalasConInventario().then(({ data, error }) => {
            if (!vivo) return;
            if (error) useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
            setSalas(data);
        });
        return () => { vivo = false; };
    }, []);

    const alternar = (id) => setElegidas(prev => {
        const sig = new Set(prev);
        if (sig.has(id)) sig.delete(id); else sig.add(id);
        return sig;
    });
    const todas = salas.length > 0 && salas.every(s => elegidas.has(s.erp_sucursal_id));

    const enviar = async () => {
        setEnviando(true);
        const { error } = await crearConsultaExistencia({
            producto: producto.id, salas: [...elegidas], motivo: motivo.trim() || null, origen,
        });
        setEnviando(false);
        if (error) {
            useToastStore.getState().showToast('No se pidió', mensajeAmigable(error), 'error');
            return;
        }
        useToastStore.getState().showToast('Conteo pedido',
            `${elegidas.size === 1 ? 'La sala recibió' : `Las ${elegidas.size} salas recibieron`} el aviso para contar.`, 'success');
        onCreada?.();
        onCerrar();
    };

    return (
        <LiquidModal open onClose={enviando ? undefined : onCerrar} maxWidth="max-w-lg" ariaLabel="Pedir que cuenten">
            <LiquidModal.Header titulo="Pedir que cuenten" icono={ScanSearch} tono="brand"
                subtitulo="La sala cuenta sin ver lo que dice el sistema, y el portal le confirma si cuadra."
                onClose={enviando ? undefined : onCerrar} />
            <LiquidModal.Body className="space-y-4">
                {producto ? (
                    <div data-surface="card" className="px-3.5 py-3 flex items-center justify-between gap-2">
                        <p className="min-w-0 text-body-sm font-black text-content truncate" title={producto.nombre}>
                            {producto.nombre}
                        </p>
                        {!inicial && (
                            <Button variant="ghost" size="sm" onClick={() => setProducto(null)}>Cambiar</Button>
                        )}
                    </div>
                ) : (
                    <div className="h-72 flex flex-col">
                        <BuscadorDeProducto placeholder="¿Qué producto?" onElegir={setProducto} />
                    </div>
                )}

                <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-label font-black uppercase tracking-widest text-content-3">Salas</p>
                        <Button variant="ghost" size="sm" disabled={!salas.length}
                            onClick={() => setElegidas(todas ? new Set() : new Set(salas.map(s => s.erp_sucursal_id)))}>
                            {todas ? 'Ninguna' : 'Todas'}
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3">
                        {salas.map(s => (
                            <Checkbox key={s.erp_sucursal_id} name={`sala-${s.erp_sucursal_id}`}
                                checked={elegidas.has(s.erp_sucursal_id)}
                                onChange={() => alternar(s.erp_sucursal_id)}
                                label={s.nombre} />
                        ))}
                    </div>
                </div>

                <PortalTextarea label="Por qué (opcional)" rows={2} value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej.: cambió el tamaño de la caja" />

                <Notice variant="info">
                    Si no cuadra, la sala vuelve a contar una vez. Si tampoco cuadra, el ajuste lo hace quien
                    aprueba inventario, y el resumen le llega a Talento Humano y a Supervisión.
                </Notice>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
                <Button variant="primary" icon={Send} loading={enviando}
                    disabled={!producto || elegidas.size === 0} onClick={enviar}>
                    Pedir conteo
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
