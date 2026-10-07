// Relógio injetável (facilita testes de prazos e reservas).
let fn = () => Date.now();
export const now = () => fn();
export const setClock = f => { fn = f || (() => Date.now()); };
