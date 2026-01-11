import React, { useState } from 'react';

interface CustomCalendarProps {
    onSelect: (date: Date) => void;
    onCancel: () => void;
}

export const CustomCalendar: React.FC<CustomCalendarProps> = ({ onSelect, onCancel }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<number | null>(null);

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const daysShort = ["S", "M", "T", "W", "T", "F", "S"];

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const handlePrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
    const handleDateClick = (day: number) => setSelectedDate(day);
    const handleSet = () => {
        if (selectedDate) onSelect(new Date(year, month, selectedDate));
        else onSelect(new Date()); 
    };

    const renderDays = () => {
        const days = [];
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="p-2 pointer-events-none"></div>);
        }
        for (let i = 1; i <= daysInMonth; i++) {
            const isSelected = selectedDate === i;
            days.push(
                <div 
                    key={i} 
                    className={`p-2 cursor-pointer rounded-full transition-colors relative z-10 text-sm ${isSelected ? 'bg-[#0B2816] text-white font-semibold' : 'hover:bg-[#dcfce7]'}`} 
                    onClick={(e) => { e.stopPropagation(); handleDateClick(i); }}
                >
                    {i}
                </div>
            );
        }
        return days;
    };

    return (
        <div className="bg-[#F0FDF4] rounded-xl overflow-hidden font-sans shadow-2xl w-[300px] text-[#111]" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#0B2816] text-white p-6 flex flex-col gap-1">
                <div className="text-sm opacity-80 font-medium">{year}</div>
                <div className="text-3xl font-bold">
                    {monthNames[month].substring(0, 3)}, {selectedDate || currentDate.getDate()}
                </div>
            </div>
            <div className="flex justify-between items-center px-4 pt-4 font-semibold text-sm">
                <div className="cursor-pointer p-1 rounded-full hover:bg-gray-200" onClick={handlePrevMonth}>&lt;</div>
                <div>{monthNames[month]} {year}</div>
                <div className="cursor-pointer p-1 rounded-full hover:bg-gray-200" onClick={handleNextMonth}>&gt;</div>
            </div>
            <div className="grid grid-cols-7 px-4 pb-4 pt-2 text-center">
                {daysShort.map((d, i) => <div key={i} className="text-xs text-gray-600 py-2 font-medium">{d}</div>)}
                {renderDays()}
            </div>
            <div className="flex justify-between p-4 pt-0 items-center">
                <div className="text-[#0B2816] font-semibold text-sm cursor-pointer hover:bg-[#0B2816]/5 px-4 py-2 rounded" onClick={() => setSelectedDate(null)}>Clear</div>
                <div className="flex gap-2">
                    <div className="text-[#0B2816] font-semibold text-sm cursor-pointer hover:bg-[#0B2816]/5 px-4 py-2 rounded" onClick={onCancel}>Cancel</div>
                    <div className="text-[#0B2816] font-bold text-sm cursor-pointer hover:bg-[#0B2816]/5 px-4 py-2 rounded" onClick={handleSet}>Set</div>
                </div>
            </div>
        </div>
    );
};