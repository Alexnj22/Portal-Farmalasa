import React, { useEffect, useState } from 'react';
import { UserPlus, UserRound, ChevronRight } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import ListRow from '../../components/common/ListRow';
import SearchInput from '../../components/common/SearchInput';
import Notice from '../../components/common/Notice';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { useAuth } from '@nucleo/context/AuthContext';
import { datosDeLoBuscado } from '@nucleo/utils/clienteValidacion';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { buscarClientes, mensajeDeError } from '@nucleo/data/customers';

// Crear o corregir un cliente sin salir del Inicio (2026-11-15, lo pidió el
// usuario). Es la misma ficha de Clientes —el mismo modal `editCliente`, con
// las mismas reglas y el mismo alta automática en la caja—, sólo que se llega
// buscando: quien atiende en el mostrador tiene a la persona enfrente y lo que
// sabe es su nombre, su DUI o su teléfono.
//
// Si lo buscado no aparece, el botón ofrece crearla con eso ya escrito: un DUI
// va al DUI, un teléfono al teléfono y lo demás al nombre. Es el atajo que
// ahorra volver a teclear lo mismo.

const TOPE = 6;

/** Lo buscado, puesto en el campo que le toca. */
export default function WidgetClientes({ openModal }) {
    const { hasPermission } = useAuth();
    const canCrear = hasPermission('clientes_crear');
    const canEdit = hasPermission('clientes', 'can_edit');
    const [q, setQ] = useState('');
    const [res, setRes] = useState(null);       // null = sin buscar
    const [parecidos, setParecidos] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const texto = q.trim();
        if (texto.length < 2) return undefined;
        let vivo = true;
        const t = setTimeout(async () => {
            const { data, error: e, aproximado } = await buscarClientes(texto, {
                select: 'id, name, dui, nit, phone, erp_id, categoria', limite: TOPE,
            });
            if (!vivo) return;
            if (e) { setError(mensajeDeError(e)); setRes([]); return; }
            setError('');
            setRes(data ?? []);
            setParecidos(!!aproximado);
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);

    const buscando = q.trim().length >= 2;
    const filas = buscando ? res : null;

    const abrir = (c) => {
        openModal?.('editCliente', { id: c.id, nombre: c.name, canEdit });
        useStaff.getState().appendAuditLog('CLIENTES_VER_FICHA', String(c.id), { nombre: c.name, desde: 'inicio' });
    };
    const nuevo = () => {
        openModal?.('editCliente', {
            nombre: 'Nuevo cliente', canEdit: true, inicial: datosDeLoBuscado(q),
            onSaved: () => setQ(''),
        });
    };

    return (
        <div className="flex flex-col gap-2 h-full min-h-0 p-3 pt-1">
            <SearchInput value={q} onChange={setQ}
                placeholder="Nombre, DUI, NIT o teléfono"
                ariaLabel="Buscar un cliente para ver sus datos" />
            {error && <Notice variant="danger" compact>{error}</Notice>}
            {parecidos && filas?.length > 0 && <AvisoParecidos texto={q} />}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1">
                {filas?.map(c => (
                    <ListRow key={c.id} density="sm" icon={UserRound}
                        title={c.name}
                        subtitle={[c.dui || c.nit, c.phone].filter(Boolean).join(' · ') || c.categoria || 'Sin DUI ni NIT'}
                        trailing={<span className="flex items-center gap-1.5">
                            {!c.erp_id && <Badge variant="warning">Sin número</Badge>}
                            <ChevronRight size={14} className="text-content-3" />
                        </span>}
                        onClick={() => abrir(c)} />
                ))}
                {filas?.length === 0 && !error && (
                    <p className="text-caption text-content-3 px-1 py-2">
                        No hay ningún cliente con «{q.trim()}».
                    </p>
                )}
                {!buscando && (
                    <p className="text-caption text-content-3 px-1 py-2">
                        Busca un cliente para ver o corregir sus datos{canCrear ? ', o crea uno nuevo' : ''}.
                    </p>
                )}
            </div>
            {canCrear && (
                <Button size="sm" variant={filas?.length === 0 ? 'primary' : 'secondary'} icon={UserPlus} onClick={nuevo}>
                    {filas?.length === 0 && Object.keys(datosDeLoBuscado(q)).length ? 'Crearlo con esto' : 'Nuevo cliente'}
                </Button>
            )}
        </div>
    );
}
