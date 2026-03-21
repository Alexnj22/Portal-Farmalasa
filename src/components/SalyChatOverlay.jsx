import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { X, Send, Sparkles, CircleUserRound, Loader2, Bot, Hexagon, Activity, CheckCircle2, Megaphone, Flame, Globe, Building2, Users } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';

const SalyChatOverlay = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    // 🚀 ESTADOS PARA EL FLUJO DE APROBACIÓN
    const [publishedDrafts, setPublishedDrafts] = useState({});
    const [publishingId, setPublishingId] = useState(null);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const employees = useStaff((state) => state.employees);
    const branches = useStaff((state) => state.branches);

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    useEffect(() => { if (isOpen) scrollToBottom(); }, [messages, isOpen, isTyping]);
    useEffect(() => { if (isOpen) setTimeout(() => inputRef.current?.focus(), 300); }, [isOpen]);

    // 🧬 Mensaje de Bienvenida
    useEffect(() => {
        if (isOpen && messages.length === 0) {
            const hour = new Date().getHours();
            const time = hour < 12 ? 'mañana' : hour < 19 ? 'tarde' : 'noche';
            const userName = user?.name?.split(' ')[0] || 'equipo';
            setMessages([{ id: 1, role: 'saly', text: `Excelente ${time}, ${userName}. Telemetría operativa en línea. Detecto **${employees?.length || 0} colaboradores activos** en la matriz. \n\n¿Cuál es el diagnóstico operativo que revisaremos hoy? ✨` }]);
        }
    }, [isOpen, messages.length, user, employees]);

    useEffect(() => {
        const handleEsc = (e) => { if (e.key === 'Escape' && isOpen) setIsOpen(false); };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen]);

    const handleSendMessage = async (e) => {
        e?.preventDefault();
        const userMsg = inputValue.trim();
        if (!userMsg) return;

        setInputValue('');
        const chatHistory = messages.map(m => `${m.role === 'saly' ? 'Saly' : 'Usuario'}: ${m.text}`).join('\n');

        setMessages(prev => [...prev, { id: Date.now(), role: 'user', text: userMsg }]);
        setIsTyping(true);

        try {
            const timeOfDay = new Date().getHours() < 12 ? 'mañana' : new Date().getHours() < 19 ? 'tarde' : 'noche';
            const { data, error } = await supabase.functions.invoke('saly-ai', {
                body: { action: 'chat', payload: { history: chatHistory, question: userMsg }, userContext: { name: user?.name, role: user?.role, timeOfDay } }
            });

            if (error) throw error;
            if (data && data.success === false) throw new Error(data.error || "Anomalía en el enlace de datos.");

            setMessages(prev => [...prev, { id: Date.now() + 1, role: 'saly', text: data.result }]);
        } catch (error) {
            console.error("Error contactando a Saly:", error);
            setMessages(prev => [...prev, { id: Date.now() + 1, role: 'saly', text: `⚠️ **Interferencia detectada** en la matriz de datos.\nCódigo: *${error.message || "Timeout"}*\n\nPor favor, verifica tus signos vitales de red e inténtalo de nuevo.` }]);
        } finally {
            setIsTyping(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    };

    // 🚀 EJECUTA LA INSERCIÓN EN LA BASE DE DATOS
    const executePublishAnnouncement = async (draftData, msgId) => {
        setPublishingId(msgId);
        try {
            const { error } = await supabase.from('announcements').insert({
                title: draftData.title,
                message: draftData.message,
                target_type: draftData.target_type || 'GLOBAL',
                target_value: draftData.target_value || null,
                priority: draftData.priority || 'NORMAL',
                read_by: [],
                is_archived: false
            });

            if (error) throw error;

            setPublishedDrafts(prev => ({ ...prev, [msgId]: true }));
            window.dispatchEvent(new CustomEvent('force-history-refresh'));
        } catch (err) {
            console.error(err);
            alert("Saly informa: Hubo un error de sincronización al intentar publicar. Inténtalo de nuevo.");
        } finally {
            setPublishingId(null);
        }
    };

    // 🚀 FORMATEADOR INTELIGENTE (DETECTA EL BORRADOR Y RENDERIZA LA TARJETA)
    const renderFormattedText = (text, role, msgId) => {
        if (!text) return null;

        // 1. Detección de Tarjeta de Borrador
        const draftMatch = text.match(/\[\[CARD_DRAFT_AVISO:(.*?)\]\]/);
        let cleanText = text;
        let draftObj = null;

        if (draftMatch) {
            cleanText = text.replace(draftMatch[0], '').trim();
            try { draftObj = JSON.parse(draftMatch[1]); } catch (e) { console.error("Error parseando JSON de borrador", e); }
        }

        const lines = cleanText.split('\n');

        return (
            <div className="space-y-2 flex flex-col">
                {lines.map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={i} className="h-1"></div>;

                    const isListItem = trimmed.startsWith('* ') || trimmed.startsWith('- ');
                    let content = trimmed.replace(/^[\*\-]\s/, '');

                    const parts = content.split(/\*\*(.*?)\*\*/g);
                    const formattedParts = parts.map((part, j) => {
                        if (j % 2 === 1) return <strong key={j} className={`font-black ${role === 'saly' ? 'text-slate-800' : 'text-white'}`}>{part}</strong>;
                        return part;
                    });

                    if (isListItem) {
                        return (
                            <div key={i} className="flex items-start gap-2.5 ml-1 mt-1">
                                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${role === 'saly' ? 'bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.6)]' : 'bg-white/80'}`}></div>
                                <span className="flex-1 leading-snug">{formattedParts}</span>
                            </div>
                        );
                    }
                    return <p key={i} className="leading-snug">{formattedParts}</p>;
                })}

                {/* 🚨 RENDER DE LA TARJETA INTERACTIVA DE BORRADOR */}
                {draftObj && (
                    <div className="mt-4 animate-in slide-in-from-bottom-2 duration-500">
                        {publishedDrafts[msgId] ? (
                            // ✅ ESTADO: PUBLICADO
                            <div className="bg-emerald-50/80 border border-emerald-200 rounded-[16px] p-4 shadow-[0_4px_15px_rgba(16,185,129,0.15)] flex flex-col gap-2.5">
                                <div className="flex items-center gap-2 text-emerald-600">
                                    <CheckCircle2 size={18} strokeWidth={2.5} />
                                    <span className="text-[12px] font-black uppercase tracking-widest leading-none mt-0.5">Aviso Operativo Publicado</span>
                                </div>
                                <button
                                    onClick={() => {
                                        setIsOpen(false);
                                        navigate('/announcements');
                                        setTimeout(() => {
                                            const menuButtons = Array.from(document.querySelectorAll('button, a, div'));
                                            const avisosBtn = menuButtons.find(el =>
                                                el.textContent &&
                                                (el.textContent.trim() === 'Avisos' || el.textContent.trim() === 'Comunicaciones')
                                            );
                                            if (avisosBtn) avisosBtn.click();
                                        }, 100);
                                    }}
                                    className="mt-1 w-full py-2 bg-emerald-50 hover:bg-emerald-500 hover:text-white text-emerald-700 text-[10.5px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95"
                                >
                                    Ir al Módulo de Avisos
                                </button>
                            </div>
                        ) : (
                            // 📝 ESTADO: BORRADOR PARA APROBACIÓN
                            <div className="bg-white/80 backdrop-blur-md border border-cyan-200/50 rounded-[18px] p-4 shadow-md flex flex-col gap-3">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <span className="text-[10px] font-black text-cyan-600 uppercase tracking-widest flex items-center gap-1.5"><Sparkles size={12} /> Borrador Saly AI</span>

                                    {/* Badge Dinámico de Prioridad */}
                                    {draftObj.priority === 'URGENT' ? (
                                        <span className="flex items-center gap-1 text-white bg-red-500 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest animate-pulse"><Flame size={10} strokeWidth={2.5} /> Urgente</span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest"><Megaphone size={10} strokeWidth={2.5} /> Normal</span>
                                    )}
                                </div>

                                <div>
                                    <h4 className="font-black text-slate-800 text-[14px] leading-tight mb-1.5">{draftObj.title}</h4>
                                    <p className="text-slate-600 text-[12px] leading-relaxed font-medium">{draftObj.message}</p>
                                </div>

                                {/* Badge Dinámico de Destinatarios */}
                                <div className="flex items-center gap-2 pt-2">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Para:</span>
                                    {draftObj.target_type === 'GLOBAL' && <span className="flex items-center gap-1 text-[#007AFF] bg-[#007AFF]/10 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border border-[#007AFF]/20"><Globe size={10} strokeWidth={2.5} /> Todos</span>}
                                    {draftObj.target_type === 'BRANCH' && <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border border-emerald-200"><Building2 size={10} strokeWidth={2.5} /> {branches?.find(b => String(b.id) === String(draftObj.target_value))?.name || 'Sucursal Específica'}</span>}
                                    {draftObj.target_type === 'ROLE' && <span className="flex items-center gap-1 text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border border-purple-200"><Users size={10} strokeWidth={2.5} /> {draftObj.target_value}</span>}
                                </div>

                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        onClick={() => executePublishAnnouncement(draftObj, msgId)}
                                        disabled={publishingId === msgId}
                                        className="flex-1 py-2.5 bg-[#007AFF] hover:bg-blue-600 text-white text-[11px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {publishingId === msgId ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : <><Send size={14} strokeWidth={2.5} /> Aprobar y Publicar</>}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <style>{`
                .saly-no-scrollbar::-webkit-scrollbar { display: none; }
                .saly-no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>

            {/* 🚨 El fondo difuminado recibe eventos (para cerrar) si el chat está abierto */}
            {isOpen && <div className="fixed inset-0 z-[9998] bg-slate-900/20 backdrop-blur-[2px] pointer-events-auto" onClick={() => setIsOpen(false)} />}

            {/* 🚨 El contenedor maestro ya no bloquea los clics invisibles (pointer-events-none) */}
            <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-4 font-sans pointer-events-none">

                <div className={`w-[340px] sm:w-[380px] h-[600px] max-h-[calc(100vh-100px)] relative flex flex-col overflow-hidden transition-all duration-300 ease-out origin-bottom-right shadow-[0_20px_60px_-15px_rgba(4,22,54,0.3)] rounded-[24px] border border-white/60 bg-white/70 backdrop-blur-3xl ${isOpen ? 'scale-100 opacity-100 translate-y-0 pointer-events-auto' : 'scale-95 opacity-0 translate-y-4 pointer-events-none'}`}>

                    {/* ✨ HEADER */}
                    <div className="relative z-20 bg-gradient-to-r from-[#041636] to-[#0a234f] p-4 flex items-center justify-between shrink-0 border-b border-white/10 shadow-sm overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/20 rounded-full blur-[40px] pointer-events-none"></div>
                        <div className="flex items-center gap-3 relative z-10">
                            <div className="relative flex items-center justify-center w-10 h-10 bg-gradient-to-tr from-sky-500 via-cyan-400 to-teal-300 rounded-[10px] shadow-[0_0_15px_rgba(6,182,212,0.3)] border border-white/20">
                                <Hexagon size={20} className="text-white drop-shadow-sm" strokeWidth={2.5} />
                                <div className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 duration-1000"></span>
                                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-[#041636]"></span>
                                </div>
                            </div>
                            <div className="flex flex-col justify-center">
                                <h3 className="text-white font-black text-[15px] tracking-tight flex items-center gap-1.5 leading-none mb-1">
                                    SALY AI <Sparkles size={12} className="text-cyan-400" />
                                </h3>
                                <p className="text-cyan-200 text-[9px] font-black uppercase tracking-[0.15em] leading-none flex items-center gap-1">
                                    <Activity size={10} className="text-emerald-400" /> Sistemas Nominales
                                </p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="relative z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-rose-500 hover:text-white transition-colors active:scale-95">
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* 💬 ÁREA DE MENSAJES */}
                    <div className="flex-1 overflow-y-auto saly-no-scrollbar p-4 space-y-5 relative z-10 bg-gradient-to-b from-slate-50/50 to-white/30">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`w-full flex relative z-10 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>

                                {msg.role === 'saly' && (
                                    <div className="w-8 h-8 rounded-[10px] bg-gradient-to-tr from-cyan-50 to-teal-50 flex items-center justify-center shrink-0 shadow-sm border border-cyan-200 mt-1 mr-2 relative overflow-hidden">
                                        <Bot size={16} className="text-cyan-700" strokeWidth={2} />
                                    </div>
                                )}

                                <div className={`max-w-[85%] p-3.5 text-[13px] md:text-[13.5px] font-medium shadow-sm backdrop-blur-md ${msg.role === 'user'
                                        ? 'bg-[#007AFF] text-white rounded-[18px] rounded-tr-[4px] border border-blue-400/30 shadow-[0_4px_15px_rgba(0,122,255,0.2)]'
                                        : 'bg-white text-slate-600 border border-slate-200/80 rounded-[18px] rounded-tl-[4px] shadow-[0_2px_10px_rgba(0,0,0,0.02)]'
                                    }`}>
                                    {renderFormattedText(msg.text, msg.role, msg.id)}
                                </div>

                                {msg.role === 'user' && (
                                    <div className="w-8 h-8 rounded-[10px] bg-white flex items-center justify-center shrink-0 border border-slate-200 mt-1 ml-2 overflow-hidden shadow-sm relative">
                                        {user?.photo ? <img src={user.photo} className="w-full h-full object-cover" alt="User" /> : <CircleUserRound size={16} className="text-slate-400" />}
                                    </div>
                                )}
                            </div>
                        ))}

                        {isTyping && (
                            <div className="w-full flex justify-start relative z-10">
                                <div className="w-8 h-8 rounded-[10px] bg-white flex items-center justify-center shrink-0 shadow-sm border border-slate-200 mt-1 mr-2">
                                    <Loader2 size={14} className="text-cyan-600 animate-spin" strokeWidth={2.5} />
                                </div>
                                <div className="bg-white border border-slate-200/80 px-4 py-3.5 rounded-[18px] rounded-tl-[4px] shadow-sm flex items-center gap-1.5 mt-1">
                                    <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
                                    <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} className="h-1" />
                    </div>

                    {/* ⌨️ ÁREA DE TEXTO */}
                    <div className="p-3 bg-white/90 backdrop-blur-3xl border-t border-slate-200 shrink-0 z-20 relative">
                        <form onSubmit={handleSendMessage} className="flex items-center gap-2 relative">
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                placeholder="Ingresar parámetro operativo..."
                                className="flex-1 bg-slate-100/80 border border-slate-200 text-slate-800 text-[13px] md:text-[14px] font-medium rounded-full py-3 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400 transition-all placeholder:text-slate-400 shadow-inner"
                            />
                            <button
                                type="submit"
                                disabled={!inputValue.trim() || isTyping}
                                className="absolute right-1.5 w-9 h-9 bg-gradient-to-r from-[#007AFF] to-[#005CE6] text-white flex items-center justify-center rounded-full shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                                {isTyping ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} className="ml-0.5" strokeWidth={2.5} />}
                            </button>
                        </form>
                    </div>
                </div>

                {/* 🚨 EL BOTÓN FLOTANTE SÍ PERMITE CLICS (pointer-events-auto) */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    title="Asistente Operativo Saly"
                    className={`pointer-events-auto relative flex items-center justify-center w-14 h-14 rounded-full shadow-[0_10px_25px_rgba(6,182,212,0.4)] hover:shadow-[0_15px_30px_rgba(6,182,212,0.5)] hover:-translate-y-1 active:scale-95 transition-all duration-300 ease-out z-50 overflow-hidden ${isOpen ? 'bg-[#041636] rotate-90 shadow-none hover:-translate-y-0' : 'bg-gradient-to-tr from-sky-500 via-cyan-400 to-teal-400 border border-white/30'}`}
                >
                    {isOpen ? (
                        <X size={24} strokeWidth={2.5} className="text-white -rotate-90 transition-transform duration-300" />
                    ) : (
                        <>
                            <Hexagon size={26} strokeWidth={2} className="text-white drop-shadow-sm relative z-10" />
                            <div className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 z-20">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-100 opacity-90 duration-1000"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400 border-2 border-cyan-500 m-auto mt-[1px]"></span>
                            </div>
                        </>
                    )}
                </button>
            </div>
        </>
    );
};

export default SalyChatOverlay;