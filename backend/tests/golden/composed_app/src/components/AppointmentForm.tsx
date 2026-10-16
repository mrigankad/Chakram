import { useId, useState, type FormEvent } from 'react';
import { Button, Checkbox, FormRow, Panel, Select, StatusBadge, TextArea, TextField } from '../chronos';
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
        <FormRow label="Patient" htmlFor={`${formId}-patient`} required>
          <TextField id={`${formId}-patient`} name="patient" type="text" value={String(values.patient)} onChange={(e) => set("patient", e.target.value)} />
        </FormRow>
        <FormRow label="Doctor" htmlFor={`${formId}-doctor`} required>
          <Select id={`${formId}-doctor`} name="doctor" value={String(values.doctor)} onChange={(e) => set("doctor", e.target.value)} placeholder="Select…">{doctors.map((r) => <option key={r.id} value={r.id}>{String(r.name)}</option>)}</Select>
        </FormRow>
        <FormRow label="Start" htmlFor={`${formId}-start`} required>
          <TextField id={`${formId}-start`} name="start" type="datetime-local" value={String(values.start)} onChange={(e) => set("start", e.target.value)} />
        </FormRow>
        <FormRow label="Status" htmlFor={`${formId}-status`}>
          <Select id={`${formId}-status`} name="status" value={String(values.status)} onChange={(e) => set("status", e.target.value)}><option value="scheduled">scheduled</option><option value="done">done</option><option value="cancelled">cancelled</option></Select>
        </FormRow>
        <FormRow label="Fee" htmlFor={`${formId}-fee`}>
          <TextField id={`${formId}-fee`} name="fee" type="number" step="0.01" value={values.fee === '' ? '' : Number(values.fee)} onChange={(e) => set("fee", e.target.value === '' ? '' : Number(e.target.value))} />
        </FormRow>
        <FormRow label="Notes" htmlFor={`${formId}-notes`}>
          <TextArea id={`${formId}-notes`} name="notes" value={String(values.notes)} onChange={(e) => set("notes", e.target.value)} />
        </FormRow>
        <div className="flex items-end">
          <Checkbox id={`${formId}-paid`} name="paid" label="Paid" checked={Boolean(values.paid)} onChange={(e) => set("paid", e.target.checked)} />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? 'Saving…' : "Book"}
          </Button>
          {message ? <StatusBadge tone={message.tone}>{message.text}</StatusBadge> : null}
        </div>
      </form>
    </Panel>
  );
}
