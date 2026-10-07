// Gerador de BR Code (PIX copia-e-cola) no padrão EMV — usado no modo de teste.

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

export function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const ascii = (s, max) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').slice(0, max).toUpperCase();

export function buildPixCode({ key, name, city = 'BRASIL', amountCents, txid }) {
  const merchant = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', key);
  const body =
    tlv('00', '01') + tlv('01', '12') + tlv('26', merchant) + tlv('52', '0000') + tlv('53', '986') +
    tlv('54', (amountCents / 100).toFixed(2)) + tlv('58', 'BR') + tlv('59', ascii(name, 25) || 'ARENAMASTER') +
    tlv('60', ascii(city, 15) || 'BRASIL') + tlv('62', tlv('05', ascii(txid, 25).replace(/ /g, '') || '***'));
  const withCrcId = body + '6304';
  return withCrcId + crc16(withCrcId);
}
