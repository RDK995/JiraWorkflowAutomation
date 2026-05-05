import type { AuthBrokerHealthResponse, AuthPreflightResponse, AuthProvider, AuthSessionResponse } from "../types/api";
import { apiGet, apiPost } from "./setupApi";

export async function getAuthBrokerHealth() {
  return apiGet<AuthBrokerHealthResponse>("/api/auth/health");
}

export async function runAuthPreflight(provider: AuthProvider, context: Record<string, unknown> = {}) {
  return apiPost<AuthPreflightResponse>("/api/auth/preflight", { provider, context });
}

export async function startAuthSession(provider: AuthProvider, context: Record<string, unknown> = {}) {
  return apiPost<AuthSessionResponse>("/api/auth/sessions/start", { provider, context });
}

export async function getAuthSessionStatus(sessionId: string) {
  return apiGet<AuthSessionResponse>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`);
}

export async function submitAuthCode(sessionId: string, code: string) {
  return apiPost<AuthSessionResponse>(`/api/auth/sessions/${encodeURIComponent(sessionId)}/code`, { code });
}

export async function runAuthLogin(sessionId: string) {
  return apiPost<AuthSessionResponse>(`/api/auth/sessions/${encodeURIComponent(sessionId)}/login`, {});
}

export async function verifyAuthSession(sessionId: string) {
  return apiPost<AuthSessionResponse>(`/api/auth/sessions/${encodeURIComponent(sessionId)}/verify`, {});
}

export async function cancelAuthSession(sessionId: string) {
  return apiPost<AuthSessionResponse>(`/api/auth/sessions/${encodeURIComponent(sessionId)}/cancel`, {});
}
