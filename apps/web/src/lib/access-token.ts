/** Client-side JWT exp check (no signature verify). Used only for UX / routing. */
export function isAccessTokenExpired(token: string | null): boolean {
  if (!token) {
    return true
  }
  try {
    const parts = token.split(".")
    if (parts.length < 2) {
      return false
    }
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as { exp?: number }
    if (typeof payload.exp !== "number") {
      return false
    }
    return payload.exp * 1000 <= Date.now()
  } catch {
    return false
  }
}

/** Clears storage if the saved access token is past ``exp`` (first load). */
export function clearStorageIfAccessTokenExpired(): void {
  const t = localStorage.getItem("access_token")
  if (t && isAccessTokenExpired(t)) {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    localStorage.removeItem("username")
  }
}

export function hasValidAccessToken(): boolean {
  const t = localStorage.getItem("access_token")
  return !!t && !isAccessTokenExpired(t)
}
