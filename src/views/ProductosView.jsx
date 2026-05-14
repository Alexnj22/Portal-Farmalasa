import React, { useState } from 'react';
import { Package, LayoutList, Boxes } from 'lucide-react';
import TabCatalogo from './productos/TabCatalogo';
import TabInventario from './productos/TabInventario';

const TABS = [
    { key: 'catalogo',   label: 'Catálogo',   icon: LayoutList },
    { key: 'inventario', label: 'Inventario',  icon: Boxes      },
];

export default function ProductosView() {
    const [activeTab, setActiveTab] = useState('catalogo');

    return (
        <div className="h-full flex flex-col bg-[#F2F2F7] rounded-[2.5rem] overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-6 pt-6 pb-4">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Productos</h1>
                        <p className="text-sm text-slate-400 mt-0.5">Catálogo, rentabilidad e inventario en tiempo real</p>
                    </div>
                </div>

                {/* Tab switcher */}
                <div className="flex items-center gap-1 mt-4 bg-white/60 backdrop-blur-sm border border-white/80 p-1 rounded-2xl w-fit shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
                    {TABS.map(({ key, label, icon: Icon }) => {
                        const isActive = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200
                                    ${isActive
                                        ? 'bg-white shadow-sm text-slate-800 border border-white/80'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-white/40'}`}
                            >
                                <Icon size={15} strokeWidth={isActive ? 2.5 : 1.8} />
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden min-h-0">
                {activeTab === 'catalogo'   && <TabCatalogo   />}
                {activeTab === 'inventario' && <TabInventario />}
            </div>
        </div>
    );
}
