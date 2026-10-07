export interface BchEngine { readonly __brand: 'BchEngine' }
export interface BchDecodeResult { bitflips: number; valid: boolean; data_binary?: string }
export function BCH(t: number, polynomial: number): BchEngine;
/** Data bits in, parity bytes out. */
export function BCH_Encode(engine: BchEngine, data: boolean[]): number[];
export function BCH_Decode(engine: BchEngine, data: boolean[], ecc: boolean[]): BchDecodeResult;
