const pad = n => String(n).padStart(2, '0');
/** Date → "YYYY-MM-DD" (fuso local) */
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
