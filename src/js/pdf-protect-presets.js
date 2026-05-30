const PROTECT_PRESETS = {
  balanced: {
    label: "Balanced",
    permissions: { print: true, copy: false, edit: false }
  },
  print_friendly: {
    label: "Print friendly",
    permissions: { print: true, copy: true, edit: false }
  },
  locked_down: {
    label: "Locked down",
    permissions: { print: false, copy: false, edit: false }
  },
  custom: {
    label: "Custom",
    permissions: { print: true, copy: true, edit: true }
  }
};

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  return `${value}`.toLowerCase() === "true";
}

export function resolveProtectPresetConfig(options = {}) {
  const preset = PROTECT_PRESETS[options.preset] ? options.preset : "balanced";
  const presetPermissions = PROTECT_PRESETS[preset].permissions;

  const requested = {
    print: normalizeBool(options.permissions?.print, presetPermissions.print),
    copy: normalizeBool(options.permissions?.copy, presetPermissions.copy),
    edit: normalizeBool(options.permissions?.edit, presetPermissions.edit)
  };

  if (preset !== "custom" && options.permissions) {
    const mismatch = ["print", "copy", "edit"].find((key) => requested[key] !== presetPermissions[key]);
    if (mismatch) {
      const err = new Error(`Preset conflict: ${PROTECT_PRESETS[preset].label} does not allow overriding ${mismatch} permission.`);
      err.code = "protect_preset_conflict";
      throw err;
    }
  }

  const hasRestriction = !requested.print || !requested.copy || !requested.edit;
  if (!hasRestriction) {
    const err = new Error("Invalid permission combination: at least one of print/copy/edit must be restricted.");
    err.code = "protect_invalid_permissions";
    throw err;
  }

  return {
    preset,
    label: PROTECT_PRESETS[preset].label,
    permissions: requested
  };
}

export function validateUnlockPresetStrategy(options = {}) {
  const strategy = ["auto", "password_required", "restrictions_only"].includes(options.strategy)
    ? options.strategy
    : "auto";
  const password = `${options.password ?? ""}`.trim();

  if (strategy === "password_required" && !password) {
    const err = new Error("Unlock strategy conflict: password-required mode needs a password.");
    err.code = "unlock_strategy_conflict";
    throw err;
  }

  return {
    strategy,
    hasPassword: Boolean(password)
  };
}
