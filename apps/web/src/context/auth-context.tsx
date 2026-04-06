import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"

import {
  clearStorageIfAccessTokenExpired,
  hasValidAccessToken,
  isAccessTokenExpired,
} from "@/lib/access-token"
import { loginRequest, registerRequest } from "@/lib/api"

type AuthContextValue = {
  username: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, email?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(() => {
    clearStorageIfAccessTokenExpired()
    return localStorage.getItem("username")
  })
  const [authEpoch, setAuthEpoch] = useState(0)

  useEffect(() => {
    function clearIfExpired() {
      const t = localStorage.getItem("access_token")
      if (t && isAccessTokenExpired(t)) {
        localStorage.removeItem("access_token")
        localStorage.removeItem("refresh_token")
        localStorage.removeItem("username")
        setUsername(null)
        setAuthEpoch((e) => e + 1)
      }
    }
    clearIfExpired()
    const id = window.setInterval(clearIfExpired, 60_000)
    window.addEventListener("focus", clearIfExpired)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("focus", clearIfExpired)
    }
  }, [])

  const login = useCallback(async (u: string, password: string) => {
    const tokens = await loginRequest(u, password)
    const access = tokens.access
    const refresh = tokens.refresh
    if (typeof access !== "string" || typeof refresh !== "string" || !access || !refresh) {
      throw new Error("Login response did not include valid tokens.")
    }
    flushSync(() => {
      localStorage.setItem("access_token", access)
      localStorage.setItem("refresh_token", refresh)
      localStorage.setItem("username", u)
      setUsername(u)
      setAuthEpoch((e) => e + 1)
    })
  }, [])

  const register = useCallback(async (u: string, password: string, email?: string) => {
    await registerRequest({ username: u, password, email })
    await login(u, password)
  }, [login])

  const logout = useCallback(() => {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    localStorage.removeItem("username")
    setUsername(null)
    setAuthEpoch((e) => e + 1)
  }, [])

  // authEpoch: recompute isAuthenticated from localStorage when login/logout/expiry and username unchanged
  const value = useMemo(() => {
    const authed = typeof window !== "undefined" && hasValidAccessToken()
    return {
      username,
      isAuthenticated: authed,
      login,
      register,
      logout,
    }
  }, [username, login, register, logout, authEpoch])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}
