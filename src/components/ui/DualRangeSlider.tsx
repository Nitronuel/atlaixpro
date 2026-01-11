import React, { useState, useEffect, useRef } from 'react';

interface DualRangeSliderProps {
    min: number;
    max: number;
    onChange: (min: number, max: number) => void;
}

export const DualRangeSlider: React.FC<DualRangeSliderProps> = ({ min, max, onChange }) => {
    const [minVal, setMinVal] = useState(min);
    const [maxVal, setMaxVal] = useState(max);
    const minRef = useRef<HTMLInputElement>(null);
    const maxRef = useRef<HTMLInputElement>(null);
    const range = useRef<HTMLDivElement>(null);

    const getPercent = (value: number) => Math.round(((value - 0) / (6 - 0)) * 100);

    useEffect(() => {
        if (maxRef.current) {
            const minPercent = getPercent(minVal);
            const maxPercent = getPercent(parseInt(maxRef.current.value));
            if (range.current) {
                range.current.style.left = `${minPercent}%`;
                range.current.style.width = `${maxPercent - minPercent}%`;
            }
        }
    }, [minVal]);

    useEffect(() => {
        if (minRef.current) {
            const minPercent = getPercent(parseInt(minRef.current.value));
            const maxPercent = getPercent(maxVal);
            if (range.current) {
                range.current.style.width = `${maxPercent - minPercent}%`;
            }
        }
    }, [maxVal]);

    return (
        <div className="relative w-full h-[40px] mt-[10px]">
            <input 
                type="range" min="0" max="6" value={minVal} ref={minRef} 
                onChange={(event) => { const value = Math.min(Number(event.target.value), maxVal - 1); setMinVal(value); onChange(value, maxVal); }} 
                className="absolute top-1/2 -translate-y-1/2 w-full appearance-none pointer-events-none bg-transparent z-[3] m-0 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-green [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card" 
            />
            <input 
                type="range" min="0" max="6" value={maxVal} ref={maxRef} 
                onChange={(event) => { const value = Math.max(Number(event.target.value), minVal + 1); setMaxVal(value); onChange(minVal, value); }} 
                className="absolute top-1/2 -translate-y-1/2 w-full appearance-none pointer-events-none bg-transparent z-[4] m-0 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-green [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card" 
            />
            <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 bg-border rounded-sm z-[1]"></div>
            <div ref={range} className="absolute top-1/2 -translate-y-1/2 h-1 bg-primary-green rounded-sm z-[2]"></div>
        </div>
    );
};