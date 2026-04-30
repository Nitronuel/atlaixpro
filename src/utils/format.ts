// Shared utility helpers for Atlaix application behavior.
export const formatCompactNumber = (num: number | undefined | null, prefix: string = '', decimals: number = 1): string => {
    if (num === undefined || num === null || isNaN(num)) return 'N/A';
    if (num === 0) return `${prefix}0`;

    const absNum = Math.abs(num);

    if (absNum < 1) {
        // For low values, display up to 6 decimal places, trimming trailing zeros for clarity.
        return prefix + num.toLocaleString(undefined, { maximumFractionDigits: 6 });
    }

    const formatter = Intl.NumberFormat('en-US', {
        notation: "compact",
        maximumFractionDigits: decimals,
    });

    return prefix + formatter.format(num);
};
