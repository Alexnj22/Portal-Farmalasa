import React, { useState, useEffect } from 'react';

const TimePicker12 = ({ value, onChange, className = '', disabled, defaultMeridiem = 'AM' }) => {
    const [hour, setHour] = useState('');
    const [minute, setMinute] = useState('');
    const [ampm, setAmpm] = useState('');

    // Sincroniza el estado visual con el valor real del formulario
    useEffect(() => {
        if (value) {
            const [h, m] = value.split(':');
            let hInt = parseInt(h, 10);
            const isPm = hInt >= 12;
            setAmpm(isPm ? 'PM' : 'AM');
            hInt = hInt % 12;
            setHour(hInt === 0 ? '12' : hInt.toString().padStart(2, '0'));
            setMinute(m);
        } else {
            // Estado vacío visual
            setHour('');
            setMinute('');
            setAmpm('');
        }
    }, [value]);

    const updateTime = (h, m, ap) => {
        if (!h || !m || !ap) return;
        let hInt = parseInt(h, 10);
        if (hInt === 12) hInt = 0;
        if (ap === 'PM') hInt += 12;
        const timeStr = `${hInt.toString().padStart(2, '0')}:${m}`;
        onChange(timeStr);
    };

    const handleHourChange = (e) => {
        const val = e.target.value;
        const newMin = minute || '00';
        const newAp = ampm || defaultMeridiem;
        setHour(val);
        setMinute(newMin);
        setAmpm(newAp);
        updateTime(val, newMin, newAp);
    };

    const handleMinuteChange = (e) => {
        const val = e.target.value;
        const newHour = hour || '12';
        const newAp = ampm || defaultMeridiem;
        setMinute(val);
        setHour(newHour);
        setAmpm(newAp);
        updateTime(newHour, val, newAp);
    };

    const handleAmpmChange = (e) => {
        const val = e.target.value;
        const newHour = hour || '12';
        const newMin = minute || '00';
        setAmpm(val);
        setHour(newHour);
        setMinute(newMin);
        updateTime(newHour, newMin, val);
    };

    return (
        <div className={`flex items-center justify-center p-1 rounded-[1rem] bg-white/50 backdrop-blur-xl border border-white/80 shadow-[0_4px_12px_rgba(0,122,255,0.06),inset_0_2px_6px_rgba(255,255,255,0.9)] transition-all ${disabled ? 'opacity-50 pointer-events-none grayscale-[0.5]' : 'hover:shadow-[0_6px_16px_rgba(0,122,255,0.12)] hover:bg-white/70'} ${className}`}>
            
            <select
                disabled={disabled}
                className="w-10 p-1.5 outline-none text-[13px] font-black bg-transparent appearance-none text-center cursor-pointer text-slate-700 focus:text-[#007AFF] transition-colors rounded-lg hover:bg-black/5"
                value={hour}
                onChange={handleHourChange}
            >
                <option value="" disabled>--</option>
                {[...Array(12)].map((_, i) => (
                    <option key={i + 1} value={(i + 1).toString().padStart(2, '0')}>
                        {(i + 1).toString().padStart(2, '0')}
                    </option>
                ))}
            </select>

            <span className="text-slate-300 font-black px-0.5 animate-pulse">:</span>

            <select
                disabled={disabled}
                className="w-10 p-1.5 outline-none text-[13px] font-black bg-transparent appearance-none text-center cursor-pointer text-slate-700 focus:text-[#007AFF] transition-colors rounded-lg hover:bg-black/5"
                value={minute}
                onChange={handleMinuteChange}
            >
                <option value="" disabled>--</option>
                {['00', '15', '30', '45'].map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>

            <div className="w-[2px] h-5 bg-black/[0.04] mx-1 rounded-full"></div>

            <select
                disabled={disabled}
                className="w-12 p-1.5 outline-none text-[11px] font-black uppercase tracking-widest bg-transparent appearance-none text-center cursor-pointer text-[#007AFF] focus:text-[#005bb5] transition-colors rounded-lg hover:bg-[#007AFF]/10"
                value={ampm}
                onChange={handleAmpmChange}
            >
                <option value="" disabled>--</option>
                <option value="AM">AM</option>
                <option value="PM">PM</option>
            </select>
        </div>
    );
};

export default TimePicker12;