import { type ReactNode, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { toast } from "sonner"
import "leaflet/dist/leaflet.css"

import { api } from "@/lib/api"

function formatWhenBD(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const datePart = new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d)
  const timePart = new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d)
  return `${datePart}, ${timePart}`
}

type ReportData = {
  count: number
  page: number
  page_size: number
  total_pages: number
  total_scans: number
  unique_visitors: number
  scans_by_day: { date: string | null; count: number }[]
  by_os: { name: string; count: number }[]
  by_device_type: { name: string; count: number }[]
  by_browser: { name: string; count: number }[]
  map_points: {
    latitude: number
    longitude: number
    scans: number
    city: string
    country: string
    created_at: string
  }[]
  recent_scans: {
    id: number
    qrcode_text: string
    country: string
    city: string
    browser: string
    os: string
    device_type: string
    ip_address: string | null
    created_at: string
  }[]
}

export function ReportPage() {
  const [searchParams] = useSearchParams()
  const qrId = searchParams.get("qr")?.trim() ?? ""
  const [page, setPage] = useState(1)
  const pageSize = 10

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setPage(1)
  }, [qrId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (qrId) params.set("qrcode_ids", qrId)
        params.set("page", String(page))
        params.set("page_size", String(pageSize))
        const q = `?${params.toString()}`
        const data = await api<ReportData>(`/api/analytics/report/${q}`)
        if (!cancelled) {
          setReport(data)
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Failed to load report")
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [qrId, page])

  const chartColors = ["#3b82f6", "#06b6d4", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6"]
  const mapPoints = report?.map_points ?? []
  const mapCenter: [number, number] =
    mapPoints.length > 0 ? [mapPoints[0].latitude, mapPoints[0].longitude] : [23.8103, 90.4125]

  return (
    <div className="flex w-full min-w-0 max-w-none flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Report</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {qrId
            ? "Analytics for the selected QR code."
            : "Analytics across all your QR codes. Unique visitors use device fingerprint when available, otherwise IP + browser."}
        </p>
      </header>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : report ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="border-border bg-card rounded-xl border p-5">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">Total scans</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{report.total_scans}</p>
            </div>
            <div className="border-border bg-card rounded-xl border p-5">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">Unique visitors</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{report.unique_visitors}</p>
            </div>
            <div className="border-border bg-card rounded-xl border p-5 sm:col-span-2 lg:col-span-1">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">Avg. scans / visitor</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {report.unique_visitors > 0
                  ? (report.total_scans / report.unique_visitors).toFixed(2)
                  : "—"}
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium">Scans by day</h2>
            <div className="border-border bg-card h-72 rounded-xl border p-4">
              {report.scans_by_day.length === 0 ? (
                <p className="text-muted-foreground text-sm">No scan data in this range.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={report.scans_by_day}>
                    <defs>
                      <linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="date" tickFormatter={(v) => (v ? String(v).slice(5) : "—")} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value) => [value, "Scans"]}
                      labelFormatter={(label) => `Date: ${label ?? "—"}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      fillOpacity={1}
                      fill="url(#scanGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="OS">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={report.by_os} dataKey="count" nameKey="name" innerRadius={55} outerRadius={95} label>
                    {report.by_os.map((entry, idx) => (
                      <Cell key={entry.name} fill={chartColors[idx % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Device type">
              <ResponsiveContainer width="100%" height={260}>
                <RadialBarChart
                  cx="50%"
                  cy="50%"
                  innerRadius="20%"
                  outerRadius="90%"
                  barSize={16}
                  data={report.by_device_type}
                >
                  <PolarAngleAxis dataKey="name" type="category" tick={{ fontSize: 12 }} />
                  <RadialBar background dataKey="count">
                    {report.by_device_type.map((entry, idx) => (
                      <Cell key={entry.name} fill={chartColors[idx % chartColors.length]} />
                    ))}
                  </RadialBar>
                  <Tooltip />
                </RadialBarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Browser">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={report.by_browser.slice(0, 8)}
                  layout="horizontal"
                  margin={{ left: 8, right: 8, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis type="category" dataKey="name" interval={0} angle={-15} textAnchor="end" height={56} />
                  <YAxis type="number" allowDecimals={false} />
                  <Tooltip formatter={(value) => [value, "Scans"]} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {report.by_browser.slice(0, 8).map((entry, idx) => (
                      <Cell key={entry.name} fill={chartColors[idx % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Scan locations map">
              <div className="h-[240px] overflow-hidden rounded-md">
                {mapPoints.length === 0 ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                    No latitude/longitude data yet.
                  </div>
                ) : (
                  <MapContainer center={mapCenter} zoom={3} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {mapPoints.map((p) => (
                      <CircleMarker
                        key={`${p.latitude},${p.longitude}`}
                        center={[p.latitude, p.longitude]}
                        radius={Math.min(12, 5 + Math.log2(Math.max(1, p.scans)))}
                        pathOptions={{ color: "#2563eb", fillColor: "#60a5fa", fillOpacity: 0.75 }}
                      >
                        <Popup>
                          <div className="text-xs">
                            <div>{[p.city, p.country].filter(Boolean).join(", ") || "Unknown location"}</div>
                            <div>Scans: {p.scans}</div>
                            <div>{formatWhenBD(p.created_at)}</div>
                            <div>
                              {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                )}
              </div>
            </ChartCard>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Recent scans</h2>
              <div className="text-muted-foreground text-xs">
                Page {report.page} of {Math.max(1, report.total_pages)} ({report.count} total)
              </div>
            </div>
            <div className="border-border overflow-hidden rounded-xl border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-muted/50 border-border border-b">
                    <tr>
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">QR text</th>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Device</th>
                      <th className="px-3 py-2 font-medium">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.recent_scans.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-muted-foreground px-3 py-6 text-center">
                          No scans yet.
                        </td>
                      </tr>
                    ) : (
                      report.recent_scans.map((s) => (
                        <tr key={s.id} className="border-border border-b last:border-0">
                          <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                            {formatWhenBD(s.created_at)}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-xs" title={s.qrcode_text}>
                            {s.qrcode_text}
                          </td>
                          <td className="px-3 py-2">
                            {[s.city, s.country].filter(Boolean).join(", ") || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span className="block">{s.browser}</span>
                            <span className="text-muted-foreground text-xs">
                              {s.os} · {s.device_type}
                            </span>
                          </td>
                          <td className="text-muted-foreground px-3 py-2 font-mono text-xs">{s.ip_address ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="border-border bg-card disabled:text-muted-foreground rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={report.page <= 1 || loading}
              >
                Prev
              </button>
              <button
                type="button"
                className="border-border bg-card disabled:text-muted-foreground rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed"
                onClick={() => setPage((p) => Math.min(report.total_pages || 1, p + 1))}
                disabled={report.page >= report.total_pages || loading}
              >
                Next
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <div className="border-border bg-card rounded-xl border p-3">{children}</div>
    </div>
  )
}
