// Field-schema validator. Field shape matches the public schema endpoint (E21):
// { name, type, required, description, example, default, enum, in, min, max }
// type: string | number | integer | boolean | array | object

export function validateParams(fields = [], input = {}) {
  const errors = [];
  const out = {};
  for (const f of fields) {
    let v = input[f.name];
    if (v === undefined || v === null || v === "") {
      if (f.default !== undefined) out[f.name] = f.default;
      else if (f.required) errors.push({ path: f.name, message: "Required" });
      continue;
    }
    const r = coerce(f, v);
    if (r.error) {
      errors.push({ path: f.name, message: r.error });
      continue;
    }
    v = r.value;
    if (f.enum && !f.enum.includes(v)) {
      errors.push({ path: f.name, message: `Must be one of: ${f.enum.join(", ")}` });
      continue;
    }
    const size = typeof v === "string" || Array.isArray(v) ? v.length : typeof v === "number" ? v : null;
    if (size !== null && f.min !== undefined && size < f.min)
      errors.push({ path: f.name, message: typeof v === "number" ? `Must be ≥ ${f.min}` : `Must have at least ${f.min} characters/items` });
    else if (size !== null && f.max !== undefined && size > f.max)
      errors.push({ path: f.name, message: typeof v === "number" ? `Must be ≤ ${f.max}` : `Must have at most ${f.max} characters/items` });
    else if (f.pattern && typeof v === "string" && !new RegExp(f.pattern).test(v))
      errors.push({ path: f.name, message: `Does not match pattern ${f.pattern}` });
    else out[f.name] = v;
  }
  return { value: out, errors };
}

function coerce(f, v) {
  switch (f.type) {
    case "string":
      if (typeof v === "string") return { value: v };
      if (typeof v === "number" || typeof v === "boolean") return { value: String(v) };
      return { error: "Expected string" };
    case "number":
    case "integer": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (!Number.isFinite(n)) return { error: `Expected ${f.type}` };
      if (f.type === "integer" && !Number.isInteger(n)) return { error: "Expected integer" };
      return { value: n };
    }
    case "boolean":
      if (typeof v === "boolean") return { value: v };
      if (v === "true" || v === "1") return { value: true };
      if (v === "false" || v === "0") return { value: false };
      return { error: "Expected boolean" };
    case "array":
      if (Array.isArray(v)) return { value: v };
      if (typeof v === "string") {
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) return { value: p };
        } catch {}
        return { value: v.split(",").map((s) => s.trim()).filter(Boolean) };
      }
      return { error: "Expected array" };
    case "object":
      if (v && typeof v === "object" && !Array.isArray(v)) return { value: v };
      if (typeof v === "string") {
        try {
          const p = JSON.parse(v);
          if (p && typeof p === "object" && !Array.isArray(p)) return { value: p };
        } catch {}
      }
      return { error: "Expected object" };
    default:
      return { value: v };
  }
}
