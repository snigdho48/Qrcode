const base = () => (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""

function getAccessToken(): string | null {
  return localStorage.getItem("access_token")
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth, ...init } = options
  const headers = new Headers(init.headers)
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  /** Snapshot at send time so a late 401 from an old request cannot wipe tokens from a new login. */
  const tokenUsed = !skipAuth ? getAccessToken() : null
  if (tokenUsed && !skipAuth) {
    headers.set("Authorization", `Bearer ${tokenUsed}`)
  }
  const res = await fetch(`${base()}${path}`, { ...init, headers })
  if (res.status === 401 && !skipAuth) {
    const tokenNow = getAccessToken()
    if (tokenUsed != null && tokenUsed !== tokenNow) {
      throw new Error("Unauthorized")
    }
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login")
    }
    throw new Error("Unauthorized")
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      detail?: string | Record<string, unknown>
      [k: string]: unknown
    }
    let msg: string
    if (typeof err.detail === "string") {
      msg = err.detail
    } else if (Array.isArray(err.detail)) {
      msg = JSON.stringify(err.detail)
    } else if (err.detail && typeof err.detail === "object") {
      msg = JSON.stringify(err.detail)
    } else {
      const flat = Object.entries(err)
        .filter(([k]) => k !== "detail")
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("; ")
      msg = flat || JSON.stringify(err) || res.statusText
    }
    throw new Error(msg)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export async function loginRequest(username: string, password: string) {
  return api<{ access: string; refresh: string }>("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    skipAuth: true,
  })
}

export async function registerRequest(body: {
  username: string
  password: string
  email?: string
}) {
  return api<{ id: number; username: string }>("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(body),
    skipAuth: true,
  })
}
