import { cn } from "@workspace/ui/lib/utils"

export type QRDesignId = "classic" | "dotted_maroon" | "dotted_teal"

export const QR_DESIGN_OPTIONS: {
  id: QRDesignId
  title: string
  hint: string
  sampleSrc: string
}[] = [
  {
    id: "classic",
    title: "Classic",
    hint: "Square modules; pick any module color below",
    sampleSrc: "/qr-design-samples/classic.png",
  },
  {
    id: "dotted_maroon",
    title: "Dots (no logo)",
    hint: "Round dots; pick any module color below",
    sampleSrc: "/qr-design-samples/maroon.png",
  },
  {
    id: "dotted_teal",
    title: "Dots + center logo",
    hint: "Round dots + PNG logo in the middle (logo keeps its colors)",
    sampleSrc: "/qr-design-samples/teal.png",
  },
]

export function isQRDesignId(v: string): v is QRDesignId {
  return v === "classic" || v === "dotted_maroon" || v === "dotted_teal"
}

export function QrDesignPicker({
  value,
  onChange,
  disabled,
  id: groupId,
}: {
  value: QRDesignId
  onChange: (v: QRDesignId) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <fieldset className="flex flex-col gap-2" id={groupId}>
      <legend className="text-sm font-medium">QR design</legend>
      <p className="text-muted-foreground text-xs">
        Samples are illustrative. Module color is set separately and does not affect your logo image.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {QR_DESIGN_OPTIONS.map((opt) => {
          const selected = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.id)}
              className={cn(
                "border-input flex flex-col items-stretch gap-2 rounded-lg border p-3 text-left transition-colors outline-none",
                selected ? "border-primary bg-primary/5 ring-ring ring-2" : "hover:bg-muted/50",
                disabled && "pointer-events-none opacity-60",
              )}
            >
              <div className="bg-background flex justify-center rounded-md border p-2">
                <img
                  src={opt.sampleSrc}
                  alt=""
                  width={112}
                  height={112}
                  className="size-28 object-contain"
                  loading="lazy"
                />
              </div>
              <span className="text-sm font-medium">{opt.title}</span>
              <span className="text-muted-foreground text-xs leading-snug">{opt.hint}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
