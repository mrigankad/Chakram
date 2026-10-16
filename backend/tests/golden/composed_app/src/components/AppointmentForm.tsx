import { useId, useState, type FormEvent } from 'react';
import { Panel, StatusBadge } from '../chronos';
import { api, useAppData } from '../data/store';
import type { Appointment } from '../data/types';

const initial = { patient: "", doctor: "", start: "", status: "scheduled", fee: 0, notes: "", paid: false };

export default function AppointmentForm() {
  const { ready, doctors } = useAppData();
  const formId = useId();
  const [values, setValues] = useState<Record<string, string | number | boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const set = (field: string, value: string | number | boolean) => setValues((v) => ({ ...v, [field]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const missing = ["patient", "doctor", "start"].filter((f) => String(values[f as keyof typeof values] ?? '').trim() === '');
    if (missing.length) {
      setMessage({ tone: 'error', text: `Required: ${missing.join(', ')}` });
      return;
    }
    const data: Omit<Appointment, 'id'> = {
      patient: String(values.patient),
      doctor: String(values.doctor),
      start: values.start ? new Date(String(values.start)).toISOString() : '',
      status: String(values.status) as Appointment['status'],
      fee: Number(values.fee) || 0,
      notes: String(values.notes),
      paid: Boolean(values.paid),
      satisfaction: 0,
    };
    setBusy(true);
    try {
      await api.appointments.create(data);
      setValues(initial);
      setMessage({ tone: 'success', text: "Appointment saved" });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Book appointment">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="Book appointment">
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Patient *</span>
          <input id={`${formId}-patient`} name="patient" type="text" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" value={String(values.patient)} onChange={(e) => set("patient", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Doctor *</span>
          <select id={`${formId}-doctor`} name="doctor" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" value={String(values.doctor)} onChange={(e) => set("doctor", e.target.value)}><option value="">Select…</option>{doctors.map((r) => <option key={r.id} value={r.id}>{String(r.name)}</option>)}</select>
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Start *</span>
          <input id={`${formId}-start`} name="start" type="datetime-local" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" value={String(values.start)} onChange={(e) => set("start", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Status</span>
          <select id={`${formId}-status`} name="status" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" value={String(values.status)} onChange={(e) => set("status", e.target.value)}><option value="scheduled">scheduled</option><option value="done">done</option><option value="cancelled">cancelled</option></select>
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Fee</span>
          <input id={`${formId}-fee`} name="fee" type="number" step="0.01" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" value={values.fee === '' ? '' : Number(values.fee)} onChange={(e) => set("fee", e.target.value === '' ? '' : Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Notes</span>
          <textarea id={`${formId}-notes`} name="notes" className="w-full rounded-lg border border-muted bg-container px-3 py-2 text-body-md text-primary placeholder:text-quaternary focus-visible:ring-2 ring-active" rows={3} value={String(values.notes)} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-label-sm text-secondary">Paid</span>
          <input id={`${formId}-paid`} name="paid" type="checkbox" className="size-4 rounded border-muted" checked={Boolean(values.paid)} onChange={(e) => set("paid", e.target.checked)} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={busy || !ready} className="rounded-full bg-action-primary px-3 py-1.5 text-label-sm text-on-color hover:bg-action-primary-hover disabled:opacity-60">
            {busy ? 'Saving…' : "Book"}
          </button>
          {message ? <StatusBadge tone={message.tone}>{message.text}</StatusBadge> : null}
        </div>
      </form>
    </Panel>
  );
}
