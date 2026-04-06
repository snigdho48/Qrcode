import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { Button } from "@workspace/ui/components/button"

import { useAuth } from "@/context/auth-context"

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await register(username.trim(), password, email.trim() || undefined)
      navigate("/qr-codes", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="border-border bg-card text-card-foreground w-full max-w-sm rounded-xl border p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Create account</h1>
        <p className="text-muted-foreground mt-1 text-sm">Choose a username and password (min. 8 characters).</p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Username</span>
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Email (optional)</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Password</span>
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <Button type="submit" disabled={pending} className="mt-1 w-full">
            {pending ? "Creating…" : "Register"}
          </Button>
        </form>
        <p className="text-muted-foreground mt-4 text-center text-xs">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
