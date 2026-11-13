// Se precarga con NODE_OPTIONS solo en playwright.visual.config.ts: fija el reloj del servidor demo
// para que las capturas no dependan de la hora en que se corren.
const FIXED_TIME = Date.parse("2026-11-10T15:00:00-03:00");
const RealDate = Date;

class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED_TIME);
    else super(...args);
  }

  static now() {
    return FIXED_TIME;
  }

  // Propios y no heredados: Next copia los estáticos de Date con getOwnPropertyDescriptors.
  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
}

globalThis.Date = FrozenDate;
