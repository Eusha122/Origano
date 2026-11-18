/** `+8801711000001` becomes `+8801******001`, so logs never carry a whole phone number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return '*'.repeat(phone.length);
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 8)}${phone.slice(-3)}`;
}
