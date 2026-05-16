import type { MorningstarRow, ModelUniverseRow, ModelId, MappedSecurity, MsStyle } from "./types"

function indexFingerprint(name: string): string[] {
  const n = name.toLowerCase()
    .replace(/ishares|vanguard|schwab|spdr|invesco|fidelity|dimensional|avantis|jpmorgan|wisdomtree|first trust|blackrock|pimco|state street|columbia|pacer|global x|franklin|nuveen|abrdn|goldman sachs/gi, "")
    .replace(/etf|fund|trust|index|portfolio|series/gi, "")
    .trim()

  const signals: string[] = []

  if (/s&p\s*500|sp500/.test(n))           signals.push("sp500")
  if (/s&p\s*100/.test(n))                  signals.push("sp100")
  if (/total\s*(stock|market|us)/.test(n))  signals.push("total-us")
  if (/russell\s*2000|r2000/.test(n))       signals.push("russell2000")
  if (/russell\s*1000/.test(n))             signals.push("russell1000")
  if (/russell\s*3000/.test(n))             signals.push("russell3000")
  if (/nasdaq|qqq|100/.test(n))             signals.push("nasdaq100")
  if (/crsp\s*us\s*large/.test(n))          signals.push("crsp-large")
  if (/crsp\s*us\s*small/.test(n))          signals.push("crsp-small")
  if (/crsp\s*us\s*total/.test(n))          signals.push("crsp-total")
  if (/value/.test(n))                      signals.push("value")
  if (/growth/.test(n))                     signals.push("growth")
  if (/blend/.test(n))                      signals.push("blend")
  if (/equal\s*weight/.test(n))             signals.push("equal-weight")
  if (/min(imum)?\s*vol(atility)?|low\s*vol/.test(n)) signals.push("min-vol")
  if (/momentum/.test(n))                   signals.push("momentum")
  if (/quality/.test(n))                    signals.push("quality")
  if (/small[\s-]cap|small\s*co/.test(n))  signals.push("small-cap")
  if (/mid[\s-]cap/.test(n))               signals.push("mid-cap")
  if (/large[\s-]cap/.test(n))             signals.push("large-cap")
