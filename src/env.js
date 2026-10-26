// Environment variables: APIZIE_* is the current name, ZIE_* (pre-rebrand) still works.
// withEnvAliases() returns a copy where every APIZIE_X is also visible as ZIE_X.
export function withEnvAliases(env = process.env) {
  const out = { ...env };
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("APIZIE_") && v !== undefined) out["ZIE_" + k.slice(7)] = v;
  }
  return out;
}

/** Apply the aliases to process.env in place (for code that reads process.env directly). */
export function applyEnvAliases() {
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("APIZIE_") && v !== undefined) process.env["ZIE_" + k.slice(7)] = v;
  }
}
