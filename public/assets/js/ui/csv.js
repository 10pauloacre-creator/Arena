// Exportação CSV compatível com Excel em português (separador ";" e BOM UTF-8; protege contra injeção de fórmulas).
const cell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita que o Excel interprete como fórmula
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
}
export function downloadCsv(filename, header, rows) {
  const blob = new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
