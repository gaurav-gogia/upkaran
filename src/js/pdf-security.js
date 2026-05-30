const LOCK_PRESETS = {
  quick: {
    label: "Quick",
    minLength: 6,
    checks: []
  },
  balanced: {
    label: "Balanced",
    minLength: 10,
    checks: ["uppercase", "lowercase", "digit"]
  },
  strong: {
    label: "Strong",
    minLength: 14,
    checks: ["uppercase", "lowercase", "digit", "symbol"]
  }
};

const CHECK_LABELS = {
  uppercase: "an uppercase letter",
  lowercase: "a lowercase letter",
  digit: "a number",
  symbol: "a symbol"
};

function normalizePreset(preset) {
  return LOCK_PRESETS[preset] ? preset : "balanced";
}

export function lockPresetMinLength(preset) {
  return LOCK_PRESETS[normalizePreset(preset)].minLength;
}

export function lockPresetLabel(preset) {
  return LOCK_PRESETS[normalizePreset(preset)].label;
}

export function lockPresetRequirementsText(preset) {
  const normalized = normalizePreset(preset);
  const policy = LOCK_PRESETS[normalized];
  const parts = [`at least ${policy.minLength} characters`];
  if (policy.checks.length) {
    parts.push(...policy.checks.map((check) => CHECK_LABELS[check]));
  }
  return parts.join(", ");
}

function runChecks(password, checks) {
  const failures = [];
  if (checks.includes("uppercase") && !/[A-Z]/.test(password)) {
    failures.push({ code: "missing_uppercase", message: "Password must include at least one uppercase letter." });
  }
  if (checks.includes("lowercase") && !/[a-z]/.test(password)) {
    failures.push({ code: "missing_lowercase", message: "Password must include at least one lowercase letter." });
  }
  if (checks.includes("digit") && !/[0-9]/.test(password)) {
    failures.push({ code: "missing_digit", message: "Password must include at least one number." });
  }
  if (checks.includes("symbol") && !/[^A-Za-z0-9]/.test(password)) {
    failures.push({ code: "missing_symbol", message: "Password must include at least one symbol." });
  }
  return failures;
}

export function validateLockPassword(password, preset = "balanced") {
  const normalized = normalizePreset(preset);
  const policy = LOCK_PRESETS[normalized];
  const value = `${password ?? ""}`;
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      ok: false,
      code: "empty",
      message: "Enter a password to lock this PDF.",
      policy
    };
  }

  if (trimmed.length < policy.minLength) {
    return {
      ok: false,
      code: "too_short",
      message: `${policy.label} preset requires at least ${policy.minLength} characters.`,
      policy
    };
  }

  const failures = runChecks(trimmed, policy.checks);
  if (failures.length > 0) {
    return {
      ok: false,
      code: failures[0].code,
      message: failures[0].message,
      policy
    };
  }

  return {
    ok: true,
    code: "ok",
    message: "Password policy checks passed.",
    policy,
    value: trimmed
  };
}

export function validateLockConfirmation(password, confirmation) {
  if (`${password ?? ""}` !== `${confirmation ?? ""}`) {
    return {
      ok: false,
      code: "mismatch",
      message: "Password and confirmation do not match."
    };
  }

  return {
    ok: true,
    code: "ok",
    message: "Password confirmation matches."
  };
}

export function classifyUnlockError(error) {
  const message = `${error?.message || "Unlock failed."}`;
  const lower = message.toLowerCase();

  if (error?.needsPassword) {
    return { kind: "password_required", code: "unlock_password_required", message };
  }
  if (lower.includes("incorrect password")) {
    return { kind: "incorrect_password", code: "unlock_incorrect_password", message };
  }
  if (lower.includes("could not open pdf") || lower.includes("runtime unavailable") || lower.includes("document is not defined")) {
    return {
      kind: "open_failed",
      code: "unlock_open_failed",
      message: "Could not unlock this PDF with the current runtime. Try another file or refresh and retry."
    };
  }

  return { kind: "other", code: "unlock_other", message };
}
