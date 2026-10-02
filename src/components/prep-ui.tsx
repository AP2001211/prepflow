import type { ReactNode } from 'react'

export const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm'
export const dateTime = (value: string) => new Date(value).toLocaleString()

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-border p-5"><h2 className="mb-4 text-xl font-semibold">{title}</h2>{children}</section>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-sm"><span>{label}</span>{children}</label>
}
