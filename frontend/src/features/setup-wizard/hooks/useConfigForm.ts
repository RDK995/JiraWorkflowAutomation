import { useRef, useState } from "react";
import { apiPost } from "../api/setupApi";
import { STEP_FIELDS } from "../constants/steps";
import { DEFAULT_CONFIG, type Config, type ConfigField } from "../types/config";
import type { ValidationResponse } from "../types/api";

type UseConfigFormOptions = {
  onFieldChanged: (field: ConfigField) => void;
  onIntegrationChanged: () => void;
  onProviderAuthReset: () => void;
  onShowIntegrationLogin: () => void;
  onActivity: (message: string) => void;
};

export function useConfigForm(options: UseConfigFormOptions) {
  const { onActivity, onFieldChanged, onIntegrationChanged, onProviderAuthReset, onShowIntegrationLogin } = options;
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirtyFieldsRef = useRef<Set<ConfigField>>(new Set());

  const applyLoadedConfig = (loadedConfig: Partial<Config>) => {
    setConfig((current) => {
      const next = { ...DEFAULT_CONFIG, ...loadedConfig };
      for (const field of dirtyFieldsRef.current) {
        next[field] = current[field];
      }
      return next;
    });
  };

  const markConfigFieldsDirty = (...fields: ConfigField[]) => {
    for (const field of fields) {
      dirtyFieldsRef.current.add(field);
    }
  };

  const clearErrors = (...fields: ConfigField[]) => {
    setErrors((current) => {
      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }
      return next;
    });
  };

  const updateField = (field: ConfigField, value: string) => {
    markConfigFieldsDirty(field);
    setConfig((current) => ({ ...current, [field]: value }));
    onFieldChanged(field);
    clearErrors(field);
  };

  const updateCodexAuthMode = (mode: string) => {
    markConfigFieldsDirty("CODEX_BOOTSTRAP_LOGIN", "CODEX_DEVICE_LOGIN_ON_START", "CODEX_API_KEY", "OPENAI_API_KEY");
    setConfig((current) => ({
      ...current,
      CODEX_BOOTSTRAP_LOGIN: mode === "persisted" ? "false" : "true",
      CODEX_DEVICE_LOGIN_ON_START: mode === "persisted" ? "false" : "true",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: ""
    }));
    onIntegrationChanged();
    clearErrors("CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_BOOTSTRAP_LOGIN", "CODEX_DEVICE_LOGIN_ON_START");
  };

  const updateAiAgent = (agent: string) => {
    if (agent === "claude") {
      markConfigFieldsDirty("AI_AGENT", "CLAUDE_BOOTSTRAP_LOGIN", "CLAUDE_DEVICE_LOGIN_ON_START", "ANTHROPIC_API_KEY");
      setConfig((current) => ({
        ...current,
        AI_AGENT: "claude",
        CLAUDE_BOOTSTRAP_LOGIN: "true",
        CLAUDE_DEVICE_LOGIN_ON_START: "true",
        ANTHROPIC_API_KEY: ""
      }));
      onIntegrationChanged();
      onProviderAuthReset();
      onShowIntegrationLogin();
      clearErrors("AI_AGENT", "CLAUDE_BOOTSTRAP_LOGIN", "CLAUDE_DEVICE_LOGIN_ON_START", "ANTHROPIC_API_KEY");
      return;
    }

    markConfigFieldsDirty("AI_AGENT", "CODEX_BOOTSTRAP_LOGIN", "CODEX_DEVICE_LOGIN_ON_START", "CODEX_API_KEY", "OPENAI_API_KEY");
    setConfig((current) => ({
      ...current,
      AI_AGENT: "codex",
      CODEX_BOOTSTRAP_LOGIN: "true",
      CODEX_DEVICE_LOGIN_ON_START: "true",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: ""
    }));
    onIntegrationChanged();
    onProviderAuthReset();
    onShowIntegrationLogin();
    clearErrors(
      "AI_AGENT",
      "CODEX_API_KEY",
      "OPENAI_API_KEY",
      "CODEX_BOOTSTRAP_LOGIN",
      "CODEX_DEVICE_LOGIN_ON_START",
      "CLAUDE_BOOTSTRAP_LOGIN",
      "CLAUDE_DEVICE_LOGIN_ON_START",
      "ANTHROPIC_API_KEY"
    );
  };

  const updateClaudeAuthMode = (mode: string) => {
    markConfigFieldsDirty("CLAUDE_BOOTSTRAP_LOGIN", "CLAUDE_DEVICE_LOGIN_ON_START", "ANTHROPIC_API_KEY");
    setConfig((current) => ({
      ...current,
      CLAUDE_BOOTSTRAP_LOGIN: mode === "persisted" ? "false" : "true",
      CLAUDE_DEVICE_LOGIN_ON_START: mode === "persisted" ? "false" : "true",
      ANTHROPIC_API_KEY: ""
    }));
    onIntegrationChanged();
    clearErrors("CLAUDE_BOOTSTRAP_LOGIN", "CLAUDE_DEVICE_LOGIN_ON_START", "ANTHROPIC_API_KEY");
  };

  const validate = async () => {
    const result = await apiPost<ValidationResponse>("/api/config/validate", { config });
    setErrors(result.errors);
    return result.isValid;
  };

  const validateStep = async (stepId: string) => {
    const result = await apiPost<ValidationResponse>("/api/config/validate", { config });
    const fields = new Set(STEP_FIELDS[stepId] || []);
    const visibleErrors = Object.fromEntries(Object.entries(result.errors).filter(([field]) => fields.has(field)));
    setErrors((current) => {
      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }
      return { ...next, ...visibleErrors };
    });
    return Object.keys(visibleErrors).length === 0;
  };

  const saveConfig = async () => {
    const valid = await validate();
    if (!valid) {
      onActivity("Config validation failed. Fix the highlighted fields before launching PRonto.");
      return false;
    }

    const result = await apiPost<ValidationResponse & { saved: boolean }>("/api/config/save", { config });
    setErrors(result.errors);
    onActivity("Generated the PRonto environment configuration.");
    return result.saved;
  };

  return {
    applyLoadedConfig,
    config,
    errors,
    saveConfig,
    updateAiAgent,
    updateClaudeAuthMode,
    updateCodexAuthMode,
    updateField,
    validate,
    validateStep
  };
}
