import { useCallback, useEffect, useId, useRef, useState, type SVGProps } from "react"
import { Link } from "react-router-dom"

import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"

import { QrDesignPicker, QR_DESIGN_OPTIONS, type QRDesignId, isQRDesignId } from "@/components/qr-design-picker"
import { api } from "@/lib/api"

type QRCodeItem = {
  id: string
  design: QRDesignId
  module_color: string
  center_logo_url: string | null
  content_text: string
  redirect_url: string
  scan_url: string
  qr_image_url: string | null
  qr_image_base64: string
  created_at: string
  updated_at: string
}

function normalizeModuleColor(c: string | undefined): string {
  const s = (c ?? "#000000").trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) {
    return s.toUpperCase()
  }
  return "#000000"
}

function normalizeDesign(d: string | undefined): QRDesignId {
  if (d && isQRDesignId(d)) {
    return d
  }
  return "classic"
}

type PaginatedQRCodes = {
  count: number
  page: number
  page_size: number
  total_pages: number
  results: QRCodeItem[]
}

function truncate(s: string, max: number) {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}…`
}

function qrImageSrc(item: QRCodeItem): string {
  if (item.qr_image_url) {
    return item.qr_image_url
  }
  return `data:image/png;base64,${item.qr_image_base64}`
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function downloadQrPng(item: QRCodeItem) {
  const a = document.createElement("a")
  a.href = `data:image/png;base64,${item.qr_image_base64}`
  a.download = `qr-${item.id.slice(0, 8)}.png`
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  toast.success("QR image downloaded.")
}

async function copyQrImageLink(item: QRCodeItem) {
  const url = qrImageSrc(item)
  try {
    await navigator.clipboard.writeText(url)
    toast.success("QR image link copied to clipboard.")
  } catch {
    toast.error("Could not copy the link.")
  }
}

async function shareQr(item: QRCodeItem) {
  const pngUrl = `data:image/png;base64,${item.qr_image_base64}`
  try {
    const res = await fetch(pngUrl)
    const blob = await res.blob()
    const file = new File([blob], `qr-${item.id.slice(0, 8)}.png`, { type: "image/png" })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: item.content_text.slice(0, 80),
        text: item.content_text,
      })
      toast.success("Shared.")
      return
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({
        title: item.content_text.slice(0, 80),
        text: item.content_text,
        url: item.scan_url,
      })
      toast.success("Shared.")
      return
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return
      }
    }
  }
  try {
    await navigator.clipboard.writeText(item.scan_url)
    toast.message("Scan link copied — others open it to scan; use Download for the PNG file.")
  } catch {
    toast.error("Could not copy the link.")
  }
}

function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
    </svg>
  )
}

function IconLink(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconShare(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

export function QRCodesPage() {
  const [items, setItems] = useState<QRCodeItem[]>([])
  const [count, setCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [serverPage, setServerPage] = useState(1)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(10)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [reloadToken, setReloadToken] = useState(0)

  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"add" | "edit">("add")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalText, setModalText] = useState("")
  const [modalRedirect, setModalRedirect] = useState("https://")
  const [modalDesign, setModalDesign] = useState<QRDesignId>("classic")
  const [modalModuleColor, setModalModuleColor] = useState("#000000")
  const [modalLogoFile, setModalLogoFile] = useState<File | null>(null)
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(null)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null)
  const logoFileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  const [previewItem, setPreviewItem] = useState<QRCodeItem | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<QRCodeItem | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const titleId = useId()
  const descId = useId()
  const searchFieldId = useId()
  const previewTitleId = useId()
  const previewDescId = useId()
  const deleteTitleId = useId()
  const deleteDescId = useId()
  const designFieldId = useId()
  const moduleColorFieldId = useId()
  const logoFieldId = useId()

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput), 300)
    return () => window.clearTimeout(id)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (!modalLogoFile) {
      setLogoPreviewUrl(null)
      return
    }
    const u = URL.createObjectURL(modalLogoFile)
    setLogoPreviewUrl(u)
    return () => {
      URL.revokeObjectURL(u)
    }
  }, [modalLogoFile])

  useEffect(() => {
    if (modalDesign !== "dotted_teal") {
      setModalLogoFile(null)
      setLogoPreviewUrl(null)
      if (logoFileRef.current) {
        logoFileRef.current.value = ""
      }
    }
  }, [modalDesign])

  const load = useCallback(async () => {
    setError(null)
    setIsFetching(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      })
      const trimmed = search.trim()
      if (trimmed) {
        params.set("search", trimmed)
      }
      const data = await api<PaginatedQRCodes>(`/api/codes/?${params.toString()}`)
      setItems(data.results)
      setCount(data.count)
      setTotalPages(data.total_pages)
      setServerPage(data.page)
      if (data.results.length === 0 && data.page > 1 && data.count > 0) {
        setPage(data.page - 1)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load QR codes"
      setError(msg)
      toast.error(msg)
    } finally {
      setIsFetching(false)
    }
  }, [page, pageSize, search, reloadToken])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!modalOpen && !previewItem && !deleteTarget) {
      return undefined
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return
      }
      if (deletePending) {
        return
      }
      if (deleteTarget) {
        setDeleteTarget(null)
      } else if (previewItem) {
        setPreviewItem(null)
      } else if (modalOpen) {
        closeModal()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [modalOpen, previewItem, deleteTarget, deletePending])

  function openAddModal() {
    setModalMode("add")
    setEditingId(null)
    setModalText("")
    setModalRedirect("https://")
    setModalDesign("classic")
    setModalModuleColor("#000000")
    setModalLogoFile(null)
    setExistingLogoUrl(null)
    if (logoFileRef.current) {
      logoFileRef.current.value = ""
    }
    setModalOpen(true)
  }

  function openEditModal(item: QRCodeItem) {
    setModalMode("edit")
    setEditingId(item.id)
    setModalText(item.content_text)
    setModalRedirect(item.redirect_url)
    setModalDesign(normalizeDesign(item.design))
    setModalModuleColor(normalizeModuleColor(item.module_color))
    setModalLogoFile(null)
    setExistingLogoUrl(item.center_logo_url ?? null)
    if (logoFileRef.current) {
      logoFileRef.current.value = ""
    }
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }
    setModalOpen(false)
    setEditingId(null)
    setModalText("")
    setModalRedirect("https://")
    setModalDesign("classic")
    setModalModuleColor("#000000")
    setModalLogoFile(null)
    setExistingLogoUrl(null)
    if (logoFileRef.current) {
      logoFileRef.current.value = ""
    }
  }

  async function submitModal(e: React.FormEvent) {
    e.preventDefault()
    const text = modalText.trim()
    const redir = modalRedirect.trim()
    if (!text) {
      toast.error("Enter label text for this QR code.")
      return
    }
    if (!redir) {
      toast.error("Enter the redirect URL.")
      return
    }
    const modColor = normalizeModuleColor(modalModuleColor)
    if (modalDesign === "dotted_teal") {
      if (modalMode === "add" && !modalLogoFile) {
        toast.error("Upload a PNG logo for the “Dots + center logo” design.")
        return
      }
      if (modalMode === "edit" && !modalLogoFile && !existingLogoUrl) {
        toast.error("Upload a PNG logo for the “Dots + center logo” design.")
        return
      }
    }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append("content_text", text)
      fd.append("redirect_url", redir)
      fd.append("design", modalDesign)
      fd.append("module_color", modColor)
      if (modalLogoFile) {
        fd.append("center_logo", modalLogoFile)
      }
      if (modalMode === "add") {
        await api<QRCodeItem>("/api/codes/", {
          method: "POST",
          body: fd,
        })
        toast.success("QR code created.")
        setPage(1)
      } else if (editingId) {
        await api(`/api/codes/${editingId}/`, {
          method: "PATCH",
          body: fd,
        })
        toast.success("QR code updated.")
      }
      closeModal()
      setReloadToken((t) => t + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed"
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  function closeDeleteModal() {
    if (deletePending) {
      return
    }
    setDeleteTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return
    }
    setDeletePending(true)
    try {
      await api(`/api/codes/${deleteTarget.id}/`, { method: "DELETE" })
      toast.success("QR code deleted.")
      setDeleteTarget(null)
      setReloadToken((t) => t + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed"
      toast.error(msg)
    } finally {
      setDeletePending(false)
    }
  }

  const fromRow = count === 0 ? 0 : (serverPage - 1) * pageSize + 1
  const toRow = Math.min(serverPage * pageSize, count)

  return (
    <div className="flex w-full min-w-0 max-w-none flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">QR codes</h1>
          <p className="text-muted-foreground mt-1 max-w-none text-sm">
            Each QR encodes a tracking link; after a scan, visitors are sent to your redirect URL. PNG files are stored
            on the server when <code className="text-xs">PUBLIC_BASE_URL</code> is set.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" asChild className="shrink-0">
            <Link to="/report">Full report</Link>
          </Button>
          <Button type="button" onClick={openAddModal} className="shrink-0">
            Add QR code
          </Button>
        </div>
      </header>

      <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={searchFieldId} className="text-muted-foreground text-xs font-medium">
            Search
          </label>
          <input
            id={searchFieldId}
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Filter by text or redirect URL…"
            className="border-input bg-background focus-visible:ring-ring h-9 w-full min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-36">
          <span className="text-muted-foreground text-xs font-medium">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <div className="relative w-full min-w-0">
        <div
          className={`border-border w-full min-w-0 overflow-x-auto rounded-xl border transition-opacity ${isFetching ? "opacity-60" : ""}`}
        >
          <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/50 border-border border-b">
                <tr>
                  <th className="text-muted-foreground w-16 px-3 py-2.5 text-xs font-medium tracking-wide uppercase">
                    QR
                  </th>
                  <th className="text-muted-foreground px-3 py-2.5 text-xs font-medium tracking-wide uppercase">
                    Text
                  </th>
                  <th className="text-muted-foreground px-3 py-2.5 text-xs font-medium tracking-wide uppercase">
                    Redirect URL
                  </th>
                  <th className="text-muted-foreground px-3 py-2.5 text-xs font-medium tracking-wide uppercase">
                    Created
                  </th>
                  <th className="text-muted-foreground w-52 px-3 py-2.5 text-right text-xs font-medium tracking-wide uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {!isFetching && items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground px-3 py-10 text-center">
                      {search.trim()
                        ? "No QR codes match your search."
                        : "No QR codes yet. Click “Add QR code” to create one."}
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-border hover:bg-muted/30 border-b last:border-0">
                      <td className="px-3 py-2 align-middle">
                        <button
                          type="button"
                          className="border-border bg-background hover:bg-muted/50 focus-visible:ring-ring group relative size-12 overflow-hidden rounded border p-0 outline-none transition-colors focus-visible:ring-2"
                          onClick={() => setPreviewItem(item)}
                          aria-label="Open QR preview"
                        >
                          <img src={qrImageSrc(item)} alt="" className="size-full object-contain" />
                        </button>
                      </td>
                      <td className="max-w-[220px] px-3 py-2 align-middle md:max-w-xs">
                        <span className="line-clamp-2 whitespace-pre-wrap" title={item.content_text}>
                          {item.content_text}
                        </span>
                      </td>
                      <td className="text-muted-foreground hidden max-w-xs px-3 py-2 align-middle sm:table-cell">
                        <a
                          href={item.redirect_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 break-all text-xs text-primary underline-offset-2 hover:underline"
                          title={item.redirect_url}
                        >
                          {truncate(item.redirect_url, 56)}
                        </a>
                      </td>
                      <td className="text-muted-foreground whitespace-nowrap px-3 py-2 align-middle text-xs">
                        {new Date(item.created_at).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-3 py-2 align-middle text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button type="button" size="sm" variant="secondary" asChild>
                            <Link to={`/report?qr=${encodeURIComponent(item.id)}`}>Report</Link>
                          </Button>
                          <Button type="button" size="sm" variant="secondary" onClick={() => openEditModal(item)}>
                            Edit
                          </Button>
                          <Button type="button" size="sm" variant="destructive" onClick={() => setDeleteTarget(item)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
        </div>
        {isFetching ? (
          <div className="bg-background/40 pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl">
            <span className="text-muted-foreground text-sm">Loading…</span>
          </div>
        ) : null}
      </div>

      {count > 0 ? (
        <div className="text-muted-foreground flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing <span className="text-foreground font-medium tabular-nums">{fromRow}</span>–
            <span className="text-foreground font-medium tabular-nums">{toRow}</span> of{" "}
            <span className="text-foreground font-medium tabular-nums">{count}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching || serverPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-foreground px-1 tabular-nums">
              Page {serverPage} of {Math.max(totalPages, 1)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching || serverPage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close QR preview"
            onClick={() => setPreviewItem(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            aria-describedby={previewDescId}
            className="border-border bg-card text-card-foreground relative z-10 w-full max-w-sm rounded-xl border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={previewTitleId} className="text-lg font-semibold tracking-tight">
                  QR preview
                </h2>
                <p id={previewDescId} className="text-muted-foreground text-sm">
                  Scanning opens your tracking page, then redirects. Design:{" "}
                  {QR_DESIGN_OPTIONS.find((o) => o.id === normalizeDesign(previewItem.design))?.title ?? "Classic"}. Module
                  color: {normalizeModuleColor(previewItem.module_color)} (logo is not recolored).
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label="Close"
                onClick={() => setPreviewItem(null)}
              >
                <span className="text-lg leading-none">×</span>
              </Button>
            </div>
            <div className="border-border bg-background mt-4 flex justify-center rounded-lg border p-4">
              <img
                src={qrImageSrc(previewItem)}
                alt="QR code"
                className="max-h-64 w-full max-w-64 object-contain"
              />
            </div>
            <p className="text-foreground mt-3 line-clamp-4 text-sm">{previewItem.content_text}</p>
            <p className="text-muted-foreground mt-2 text-xs font-medium">Redirect</p>
            <a
              href={previewItem.redirect_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block break-all text-xs text-primary underline-offset-2 hover:underline"
            >
              {previewItem.redirect_url}
            </a>
            <p className="text-muted-foreground mt-2 text-xs">Tracking link (encoded in QR)</p>
            <p className="mt-0.5 break-all font-mono text-[11px] leading-relaxed">{previewItem.scan_url}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => downloadQrPng(previewItem)}
              >
                <IconDownload className="size-4" />
                Download PNG
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => void copyQrImageLink(previewItem)}
              >
                <IconLink className="size-4" />
                Copy QR image link
              </Button>
              {typeof navigator.share === "function" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void shareQr(previewItem)}
                >
                  <IconShare className="size-4" />
                  Share
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close delete confirmation"
            onClick={closeDeleteModal}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            aria-describedby={deleteDescId}
            className="border-border bg-card text-card-foreground relative z-10 w-full max-w-md rounded-xl border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={deleteTitleId} className="text-lg font-semibold tracking-tight">
              Delete QR code?
            </h2>
            <p id={deleteDescId} className="text-muted-foreground mt-2 text-sm">
              This removes the QR code and its analytics history. This cannot be undone.
            </p>
            <p className="border-border bg-muted/40 mt-3 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground text-xs font-medium uppercase">Text</span>
              <span className="mt-1 line-clamp-3 block whitespace-pre-wrap">
                {deleteTarget.content_text.trim() || "—"}
              </span>
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={deletePending} onClick={closeDeleteModal}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={deletePending} onClick={() => void confirmDelete()}>
                {deletePending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close dialog"
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="border-border bg-card text-card-foreground relative z-10 my-auto max-h-[min(90dvh,calc(100vh-2rem))] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {modalMode === "add" ? "New QR code" : "Edit QR code"}
            </h2>
            <p id={descId} className="text-muted-foreground mt-1 text-sm">
              The QR image encodes a tracking link. After the scan is recorded, the browser opens your redirect URL.
            </p>
            <form onSubmit={submitModal} className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Text</span>
                <textarea
                  required
                  rows={4}
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  placeholder="e.g. Summer campaign — booth 4"
                  className="border-input bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Redirect URL</span>
                <input
                  type="url"
                  required
                  value={modalRedirect}
                  onChange={(e) => setModalRedirect(e.target.value)}
                  placeholder="https://example.com/landing"
                  className="border-input bg-background focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
                />
              </label>
              <QrDesignPicker id={designFieldId} value={modalDesign} onChange={setModalDesign} disabled={saving} />
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={moduleColorFieldId} className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">QR module color</span>
                  <span className="text-muted-foreground text-xs">
                    Applies to dots and squares only. Center logo keeps its original colors.
                  </span>
                  <input
                    id={moduleColorFieldId}
                    type="color"
                    value={modalModuleColor}
                    onChange={(e) => setModalModuleColor(e.target.value)}
                    disabled={saving}
                    className="border-input h-10 w-full max-w-32 cursor-pointer rounded-md border bg-transparent p-1"
                  />
                </label>
              </div>
              {modalDesign === "dotted_teal" ? (
                <div className="flex flex-col gap-2">
                  <span id={logoFieldId} className="text-sm font-medium">
                    Center logo (PNG) <span className="text-destructive">*</span>
                  </span>
                  <p className="text-muted-foreground text-xs">
                    Required for this design. Use a PNG with transparency for best results.
                  </p>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png"
                    className="text-muted-foreground text-sm file:me-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                    disabled={saving}
                    onChange={(e) => setModalLogoFile(e.target.files?.[0] ?? null)}
                  />
                  {logoPreviewUrl || existingLogoUrl ? (
                    <div className="border-border bg-muted/30 flex items-center gap-3 rounded-md border p-2">
                      <img
                        src={logoPreviewUrl ?? existingLogoUrl ?? ""}
                        alt="Logo preview"
                        className="size-14 shrink-0 rounded object-contain"
                      />
                      <p className="text-muted-foreground text-xs">
                        {modalLogoFile ? "New logo selected." : "Current logo on server."}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" disabled={saving} onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : modalMode === "add" ? "Create" : "Save changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
