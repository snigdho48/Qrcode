import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/app-shell"
import { ProtectedRoute } from "@/components/protected-route"
import { LoginPage } from "@/pages/login-page"
import { QRCodesPage } from "@/pages/qr-codes-page"
import { ReportPage } from "@/pages/report-page"
// import { RegisterPage } from "@/pages/register-page"

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* <Route path="/register" element={<RegisterPage />} /> */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="qr-codes" replace />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="qr-codes" element={<QRCodesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
