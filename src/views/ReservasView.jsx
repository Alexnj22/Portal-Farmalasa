import React from 'react';
import { ShoppingBag } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import WidgetReservas from './dashboard/WidgetReservas';
import { useAuth } from '@nucleo/context/AuthContext';

// ═══════════════════════════════════════════════════════════════════════════
// Reservas — la pantalla del menú, en Comercial (2026-10-21).
//
// Pedido del dueño: «las reservas que estén en Comercial, como pantalla
// principal». Hasta ese día vivían en dos sitios: el widget del Inicio (la sala
// propia) y una pestaña de Ofertas para clientes (todas las salas), que es la
// vitrina de la app y no el lugar donde se trabaja una venta por terminar.
//
// El contenido es el MISMO componente del widget, sin la baldosa: apartar,
// entregar, recetas por revisar, saldos a favor y encargos están escritos una
// sola vez. Dos copias de esa lógica terminarían diciendo cosas distintas de la
// misma reserva.
//
// ── El alcance decide qué salas ────────────────────────────────────────────
// Con alcance «todas» se ven las de toda la red; con «su sala» (o sin alcance
// declarado), sólo la propia. Sin pestañas a propósito: abiertas, saldos a
// favor y encargos son una sola lista de trabajo y el buscador por código
// cruza las tres —partirlas obligaría a saber de antemano en cuál está el
// código que el cliente muestra en el teléfono—.
//
// ── Ver y editar ───────────────────────────────────────────────────────────
// `reservas.can_view` deja mirar; `can_edit` deja apartar, entregar, cancelar y
// aplicar un saldo a favor. Sin editar, la lista sale sin esos botones. La
// receta de la app tiene su propio permiso (`recetas_app`) y no cambia acá.
// ═══════════════════════════════════════════════════════════════════════════
export default function ReservasView() {
    const { hasPermission, getScope } = useAuth();
    const todas = getScope('reservas') === 'ALL';
    const puedeEditar = hasPermission('reservas', 'can_edit');

    return (
        <GlassViewLayout icon={ShoppingBag} title="Reservas" transparentBody>
            <div className="p-4 md:p-6">
                <WidgetReservas todas={todas} completa soloLectura={!puedeEditar} />
            </div>
        </GlassViewLayout>
    );
}
