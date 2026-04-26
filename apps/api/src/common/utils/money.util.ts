/** All monetary values stored as integers in paise. 1 INR = 100 paise. Never use float. */

export const inrToPaise = (inr: number): number => Math.round(inr * 100);
export const paiseToInr = (paise: number): number => paise / 100;
export const calculateBoqItemAmount = (quantity: number, ratePaise: number): number => Math.round(quantity * ratePaise);
export const formatInr = (paise: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
